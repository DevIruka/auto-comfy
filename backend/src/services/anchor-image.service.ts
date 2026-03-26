import { mkdir, writeFile } from "fs/promises";
import { join, resolve, relative, isAbsolute } from "path";
import { v4 as uuidv4 } from "uuid";
import { comfyManager } from "./comfy-manager.service.js";
import { instanceQueueManager } from "./instance-queue-manager.service.js";
import {
  createImageGenWorkflow,
  type LoraSlotConfig,
} from "../utils/workflow-helpers.js";

export interface AnchorImageJobParams {
  instanceId: string;
  loras: LoraSlotConfig[];
  positiveBlocks: {
    fixedPrefix: string;
    styleTrigger: string;
    character: string;
    outfit: string;
    backgroundPositive: string;
    fixedSuffix: string;
  };
  negativeBlocks: {
    fixedNegative: string;
    backgroundNegative: string;
  };
  batchSize: number;
  /** 감정별 이미지 폴더 — 라벨 저장 시에만 파일 쓰기 */
  outputPath: string;
  compositionPose: string;
  aspect: "portrait" | "landscape";
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1e15);
}

/** Allowed filenames when saving from the UI (without .png) */
export const ANCHOR_IMAGE_LABELS = [
  "sit_neutral",
  "sit_neutral_nude",
  "stand_neutral",
  "stand_neutral_nude",
] as const;
export type AnchorImageLabel = (typeof ANCHOR_IMAGE_LABELS)[number];

export interface AnchorImageJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  totalTasks: number;
  completedTasks: number;
  currentTask: string;
  logs: string[];
  createdAt: string;
  error?: string;
  /** Placeholder names for preview count (images kept in RAM only until label save) */
  resultFiles?: string[];
}

type BroadcastCallback = (jobId: string, data: unknown) => void;

const LYING_DOWN_WIDTH = 1536;
const LYING_DOWN_HEIGHT = 1024;
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1536;

function isPathInsideDir(filePath: string, dir: string): boolean {
  const resolvedFile = resolve(filePath);
  const resolvedDir = resolve(dir);
  const rel = relative(resolvedDir, resolvedFile);
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

class AnchorImageService {
  private jobs = new Map<string, AnchorImageJob>();
  private jobParams = new Map<string, AnchorImageJobParams>();
  private stopRequested = new Map<string, boolean>();
  /** In-memory PNG buffers per job (no disk write until label save) */
  private resultBuffersByJob = new Map<string, Buffer[]>();
  private broadcastCallback: BroadcastCallback | null = null;

  setBroadcastCallback(cb: BroadcastCallback) {
    this.broadcastCallback = cb;
  }

  private addLog(jobId: string, message: string) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      this.broadcast(jobId);
    }
    console.log(`[AnchorImage ${jobId.slice(0, 8)}] ${message}`);
  }

  private broadcast(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job && this.broadcastCallback) {
      this.broadcastCallback(jobId, {
        type: "anchor_image_progress",
        data: { jobId, ...job },
      });
    }
    this.broadcastQueueState();
  }

  private broadcastQueueState() {
    if (this.broadcastCallback) {
      this.broadcastCallback("", {
        type: "anchor_image_queue",
        data: this.getQueueState(),
      });
    }
  }

  getQueueState(): {
    queue: string[];
    currentJobId: string | null;
    currentJobIds: string[];
    jobs: AnchorImageJob[];
  } {
    const jobs = Array.from(this.jobs.values());
    const pendingJobs = jobs.filter((j) => j.status === "pending").map((j) => j.id);
    const runningJobs = jobs.filter((j) => j.status === "running").map((j) => j.id);
    return {
      queue: pendingJobs,
      currentJobId: runningJobs[0] ?? null,
      currentJobIds: runningJobs,
      jobs: jobs.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    };
  }

  getJob(jobId: string): AnchorImageJob | undefined {
    return this.jobs.get(jobId);
  }

  private canPreview(jobId: string, imageIndex: number): boolean {
    const job = this.jobs.get(jobId);
    const buffers = this.resultBuffersByJob.get(jobId);
    return Boolean(
      job &&
        job.status === "completed" &&
        buffers &&
        imageIndex >= 0 &&
        imageIndex < buffers.length,
    );
  }

  /**
   * Write chosen buffer to outputPath/{label}.png (only persistence for anchor batch)
   */
  async saveResultWithLabel(
    jobId: string,
    imageIndex: number,
    label: string,
  ): Promise<{ savedPath: string; fileName: string }> {
    if (!(ANCHOR_IMAGE_LABELS as readonly string[]).includes(label)) {
      throw new Error(`Invalid label: ${label}`);
    }
    const job = this.jobs.get(jobId);
    const params = this.jobParams.get(jobId);
    const buffers = this.resultBuffersByJob.get(jobId);
    if (
      !job ||
      !params ||
      !buffers ||
      job.status !== "completed" ||
      imageIndex < 0 ||
      imageIndex >= buffers.length
    ) {
      throw new Error("Job not found, not completed, or invalid image index");
    }
    const dest = join(params.outputPath, `${label}.png`);
    if (!isPathInsideDir(dest, params.outputPath)) {
      throw new Error("Invalid output path");
    }
    await mkdir(params.outputPath, { recursive: true });
    await writeFile(dest, buffers[imageIndex]);
    this.addLog(jobId, `Saved: ${label}.png (from preview #${imageIndex})`);
    return { savedPath: dest, fileName: `${label}.png` };
  }

  async readPreviewBuffer(
    jobId: string,
    imageIndex: number,
  ): Promise<Buffer | null> {
    if (!this.canPreview(jobId, imageIndex)) return null;
    const buffers = this.resultBuffersByJob.get(jobId);
    if (!buffers) return null;
    return buffers[imageIndex];
  }

  createJob(params: AnchorImageJobParams): string {
    const jobId = uuidv4();
    const job: AnchorImageJob = {
      id: jobId,
      status: "pending",
      totalTasks: 1,
      completedTasks: 0,
      currentTask: "",
      logs: [],
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);
    this.jobParams.set(jobId, params);
    this.stopRequested.set(jobId, false);

    instanceQueueManager.enqueue({
      jobId,
      serviceType: "anchor-image",
      label: "Anchor image (single seed)",
      instanceId: params.instanceId,
      onStart: () => this.startJob(jobId),
    });
    this.broadcastQueueState();

    return jobId;
  }

  async startJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    const params = this.jobParams.get(jobId);
    if (!job || !params) throw new Error("Job not found");

    job.status = "running";
    this.addLog(jobId, "Anchor job started: 1 random seed, batchSize from request");

    const comfy = comfyManager.getInstance(params.instanceId);
    const isLandscape = params.aspect === "landscape";
    const width = isLandscape ? LYING_DOWN_WIDTH : DEFAULT_WIDTH;
    const height = isLandscape ? LYING_DOWN_HEIGHT : DEFAULT_HEIGHT;

    try {
      if (this.stopRequested.get(jobId)) {
        job.status = "stopped";
        this.addLog(jobId, "Batch stopped by user");
        this.broadcast(jobId);
        return;
      }

      const positive = this.buildPositivePrompt(
        params.positiveBlocks,
        params.compositionPose,
      );
      const negative = this.buildNegativePrompt(params.negativeBlocks);
      const seed = randomSeed();

      job.currentTask = `anchor seed ${seed}`;
      this.addLog(
        jobId,
        `Generating: ${width}×${height}, batchSize ${params.batchSize}, seed ${seed}`,
      );
      this.broadcast(jobId);

      try {
        const workflow = createImageGenWorkflow({
          loras: params.loras,
          positivePrompt: positive,
          negativePrompt: negative,
          seed,
          batchSize: params.batchSize,
          width,
          height,
        });

        const queueResponse = await comfy.queuePrompt(workflow);
        const promptId = queueResponse.prompt_id;

        if (
          queueResponse.node_errors &&
          Object.keys(queueResponse.node_errors).length > 0
        ) {
          this.addLog(jobId, "⚠️ Workflow validation error, skipping");
          job.completedTasks = 1;
          job.status = "failed";
          this.broadcast(jobId);
          return;
        }

        const result = await this.pollForCompletion(comfy, promptId);
        const images = result.outputs["212"]?.images || [];

        const buffers: Buffer[] = [];
        for (const img of images) {
          const imageBuffer = await comfy.getImage(
            img.filename,
            img.subfolder,
            img.type,
          );
          buffers.push(imageBuffer);
        }

        this.resultBuffersByJob.set(jobId, buffers);
        job.resultFiles = buffers.map((_, i) => `preview_${i}.png`);

        this.addLog(
          jobId,
          `✅ Preview ready: ${buffers.length} image(s) in memory (disk save only via label buttons)`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.addLog(jobId, `❌ Failed: ${msg}`);
        job.status = "failed";
        job.error = msg;
        job.completedTasks = 1;
        this.broadcast(jobId);
        return;
      }

      job.completedTasks = 1;
      job.status = "completed";
      this.addLog(jobId, "✅ Anchor job completed");
      this.broadcast(jobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.error = msg;
      this.addLog(jobId, `❌ Job failed: ${msg}`);
      this.broadcast(jobId);
    }
  }

  stopJob(jobId: string) {
    this.stopRequested.set(jobId, true);
  }

  private buildPositivePrompt(
    blocks: AnchorImageJobParams["positiveBlocks"],
    compositionPose: string,
  ): string {
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return [
      s(blocks.fixedPrefix),
      s(blocks.styleTrigger),
      s(blocks.character),
      s(blocks.outfit),
      s(compositionPose),
      s(blocks.backgroundPositive),
      s(blocks.fixedSuffix),
    ]
      .filter((b) => b.trim())
      .join("\n\n");
  }

  private buildNegativePrompt(
    blocks: AnchorImageJobParams["negativeBlocks"],
  ): string {
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return [s(blocks.fixedNegative), s(blocks.backgroundNegative)]
      .filter((b) => b.trim())
      .join("\n\n");
  }

  private async pollForCompletion(
    comfy: ReturnType<typeof comfyManager.getInstance>,
    promptId: string,
  ): Promise<{ outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }> {
    const maxAttempts = 120;
    let attempts = 0;

    return new Promise((resolve, reject) => {
      const check = async () => {
        attempts++;
        try {
          const history = await comfy.getHistory(promptId);
          if (history[promptId]) {
            const { status, outputs } = history[promptId];

            if (status.status_str === "error") {
              reject(new Error("Workflow execution failed"));
              return;
            }

            if (status.completed && (outputs?.["212"]?.images?.length ?? 0) > 0) {
              resolve({ outputs });
              return;
            }
          }

          if (attempts >= maxAttempts) {
            reject(new Error("Image generation timeout (10 min)"));
            return;
          }

          setTimeout(check, 5000);
        } catch (err) {
          reject(err);
        }
      };
      setTimeout(check, 3000);
    });
  }
}

export const anchorImageService = new AnchorImageService();
