import { readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { comfyManager } from "./comfy-manager.service.js";
import { instanceQueueManager } from "./instance-queue-manager.service.js";
import {
  createImageGenWorkflow,
  type LoraSlotConfig,
} from "../utils/workflow-helpers.js";

export interface BannerConfig {
  pose: Record<string, string>;
  gesture: Record<string, string>;
}

export interface BannerBatchJobParams {
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
  /** Runs per combination (default 3). */
  runsPerCombo?: number;
  outputPath: string;
}

interface BannerTask {
  poseKey: string;
  gestureKey: string | null;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1e15);
}

export interface BannerBatchJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  totalTasks: number;
  completedTasks: number;
  currentTask: string;
  logs: string[];
  createdAt: string;
  error?: string;
}

type BroadcastCallback = (jobId: string, data: unknown) => void;

const LYING_DOWN_WIDTH = 1536;
const LYING_DOWN_HEIGHT = 1024;
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1536;

class BannerBatchService {
  private config: BannerConfig = { pose: {}, gesture: {} };
  private jobs: Map<string, BannerBatchJob> = new Map();
  private jobParams: Map<string, BannerBatchJobParams> = new Map();
  private stopRequested: Map<string, boolean> = new Map();
  private broadcastCallback: BroadcastCallback | null = null;

  constructor() {
    this.loadConfig();
  }

  setBroadcastCallback(cb: BroadcastCallback) {
    this.broadcastCallback = cb;
  }

  private loadConfig() {
    try {
      const configPath = join(process.cwd(), "..", "banner-config.json");
      this.config = JSON.parse(readFileSync(configPath, "utf-8"));
      const poseKeys = Object.keys(this.config.pose || {});
      const gestureKeys = Object.keys(this.config.gesture || {});
      console.log(
        `✅ Loaded banner config: poses [${poseKeys.join(", ")}], gestures [${gestureKeys.join(", ")}]`,
      );
    } catch (err) {
      console.error("❌ Failed to load banner-config.json:", err);
    }
  }

  getConfig(): BannerConfig {
    return this.config;
  }

  private buildTasks(): BannerTask[] {
    const poseKeys = Object.keys(this.config.pose || {});
    const gestureKeys = Object.keys(this.config.gesture || {});
    const poseOnly: BannerTask[] = poseKeys.map((p) => ({ poseKey: p, gestureKey: null }));
    const poseAndGesture: BannerTask[] = poseKeys.flatMap((p) =>
      gestureKeys.map((g) => ({ poseKey: p, gestureKey: g })),
    );
    return [...poseOnly, ...poseAndGesture];
  }

  private addLog(jobId: string, message: string) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      this.broadcast(jobId);
    }
    console.log(`[BannerBatch ${jobId.slice(0, 8)}] ${message}`);
  }

  private broadcast(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job && this.broadcastCallback) {
      this.broadcastCallback(jobId, {
        type: "banner_batch_progress",
        data: { jobId, ...job },
      });
    }
    this.broadcastQueueState();
  }

  private broadcastQueueState() {
    if (this.broadcastCallback) {
      this.broadcastCallback("", {
        type: "banner_batch_queue",
        data: this.getQueueState(),
      });
    }
  }

  getQueueState(): {
    queue: string[];
    currentJobId: string | null;
    currentJobIds: string[];
    jobs: BannerBatchJob[];
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

  getJob(jobId: string): BannerBatchJob | undefined {
    return this.jobs.get(jobId);
  }

  createJob(params: BannerBatchJobParams): string {
    const jobId = uuidv4();
    const tasks = this.buildTasks();
    const runsPerCombo = Math.max(1, params.runsPerCombo ?? 3);
    const totalTasks = tasks.length * runsPerCombo;

    const job: BannerBatchJob = {
      id: jobId,
      status: "pending",
      totalTasks,
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
      serviceType: "banner-batch",
      label: `Banner batch: ${totalTasks} tasks`,
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
    const tasks = this.buildTasks();
    const runsPerCombo = Math.max(1, params.runsPerCombo ?? 3);
    this.addLog(
      jobId,
      `Batch started: ${tasks.length} combinations × ${runsPerCombo} runs = ${job.totalTasks} tasks`,
    );

    const comfy = comfyManager.getInstance(params.instanceId);

    try {
      await mkdir(params.outputPath, { recursive: true });

      for (const task of tasks) {
        const posePrompt = this.config.pose?.[task.poseKey] ?? "";
        const gesturePrompt = task.gestureKey
          ? this.config.gesture?.[task.gestureKey] ?? ""
          : "";
        const taskLabel = task.gestureKey
          ? `${task.poseKey} + ${task.gestureKey}`
          : task.poseKey;

        const positive = this.buildPositivePrompt(
          params.positiveBlocks,
          posePrompt,
          gesturePrompt,
        );
        const negative = this.buildNegativePrompt(params.negativeBlocks);

        const isLyingDown =
          task.poseKey.toLowerCase().replace(/\s+/g, " ") === "lying down";
        const width = isLyingDown ? LYING_DOWN_WIDTH : DEFAULT_WIDTH;
        const height = isLyingDown ? LYING_DOWN_HEIGHT : DEFAULT_HEIGHT;

        for (let run = 0; run < runsPerCombo; run++) {
          if (this.stopRequested.get(jobId)) {
            job.status = "stopped";
            this.addLog(jobId, "Batch stopped by user");
            this.broadcast(jobId);
            return;
          }

          job.currentTask = `${taskLabel} (${run + 1}/${runsPerCombo})`;
          this.addLog(
            jobId,
            `Generating: ${taskLabel} run ${run + 1}/${runsPerCombo} (${job.completedTasks + 1}/${job.totalTasks})`,
          );
          this.broadcast(jobId);

          const seed = randomSeed();

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
              this.addLog(jobId, `⚠️ Workflow validation error for ${taskLabel} run ${run + 1}, skipping`);
              job.completedTasks++;
              this.broadcast(jobId);
              continue;
            }

            const result = await this.pollForCompletion(comfy, promptId);
            const images = result.outputs["212"]?.images || [];

            for (const img of images) {
              const imageBuffer = await comfy.getImage(
                img.filename,
                img.subfolder,
                img.type,
              );
              const saveName = `${task.poseKey}${task.gestureKey ? `_${task.gestureKey}` : "_pose_only"}_run${run + 1}_seed${seed}_${img.filename}`.replace(
                /[<>:"/\\|?*]/g,
                "_",
              );
              const savePath = join(params.outputPath, saveName);
              await writeFile(savePath, imageBuffer);
            }

            this.addLog(
              jobId,
              `✅ ${taskLabel} run ${run + 1}: ${images.length} images saved`,
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.addLog(jobId, `❌ Failed: ${taskLabel} run ${run + 1}: ${msg}`);
          }

          job.completedTasks++;
          this.broadcast(jobId);
        }
      }

      job.status = "completed";
      this.addLog(
        jobId,
        `✅ Batch completed: ${job.completedTasks}/${job.totalTasks} tasks`,
      );
      this.broadcast(jobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      job.status = "failed";
      job.error = msg;
      this.addLog(jobId, `❌ Batch failed: ${msg}`);
      this.broadcast(jobId);
    }
  }

  stopJob(jobId: string) {
    this.stopRequested.set(jobId, true);
  }

  private buildPositivePrompt(
    blocks: BannerBatchJobParams["positiveBlocks"],
    posePrompt: string,
    gesturePrompt: string,
  ): string {
    return [
      blocks.fixedPrefix,
      blocks.styleTrigger,
      blocks.character,
      blocks.outfit,
      posePrompt,
      gesturePrompt,
      blocks.backgroundPositive,
      blocks.fixedSuffix,
    ]
      .filter((b) => b.trim())
      .join("\n\n");
  }

  private buildNegativePrompt(
    blocks: BannerBatchJobParams["negativeBlocks"],
  ): string {
    return [blocks.fixedNegative, blocks.backgroundNegative]
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

export const bannerBatchService = new BannerBatchService();
