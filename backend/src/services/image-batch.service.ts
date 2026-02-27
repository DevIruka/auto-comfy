import { readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { comfyManager } from "./comfy-manager.service.js";
import {
  createImageGenWorkflow,
  type LoraSlotConfig,
} from "../utils/workflow-helpers.js";

export interface PoseExpressionConfig {
  prompt: string;
  negativePrompt: string;
}

export interface PoseConfig {
  [expression: string]: PoseExpressionConfig;
}

export interface ImgPoseConfig {
  [poseName: string]: PoseConfig;
}

export interface PoseSelection {
  poseName: string;
  expression: string;
  handFix: boolean;
}

export interface ImageBatchJobParams {
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
  handFixPositive: string;
  handFixNegative: string;
  poses: PoseSelection[];
  batchSize: number;
  outputPath: string;
}

const RUNS_PER_POSE = 3; // 포즈당 완전 랜덤 시드로 3번 요청

function randomSeed(): number {
  return Math.floor(Math.random() * 1e15);
}

export interface ImageBatchJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  totalTasks: number;
  completedTasks: number;
  currentPose: string;
  currentSeedIndex: number;
  logs: string[];
  createdAt: string;
  error?: string;
}

type BroadcastCallback = (jobId: string, data: unknown) => void;

class ImageBatchService {
  private poseConfig: ImgPoseConfig = {};
  private jobs: Map<string, ImageBatchJob> = new Map();
  private jobParams: Map<string, ImageBatchJobParams> = new Map();
  private stopRequested: Map<string, boolean> = new Map();
  private broadcastCallback: BroadcastCallback | null = null;
  /** Queue per ComfyUI instance: different ports run in parallel. */
  private jobQueueByInstance = new Map<string, string[]>();
  /** Current running job per instance (one at a time per port). */
  private currentJobByInstance = new Map<string, string>();

  constructor() {
    this.loadConfig();
  }

  setBroadcastCallback(cb: BroadcastCallback) {
    this.broadcastCallback = cb;
  }

  private loadConfig() {
    try {
      const configPath = join(process.cwd(), "..", "img-pose-config.json");
      this.poseConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      console.log(
        `✅ Loaded image pose config: [${Object.keys(this.poseConfig).join(", ")}]`,
      );
    } catch (err) {
      console.error("❌ Failed to load img-pose-config.json:", err);
    }
  }

  getPoseConfig(): ImgPoseConfig {
    return this.poseConfig;
  }

  getPoseList(): string[] {
    return Object.keys(this.poseConfig);
  }

  getExpressions(poseName: string): string[] {
    const pose = this.poseConfig[poseName];
    return pose ? Object.keys(pose) : [];
  }

  private addLog(jobId: string, message: string) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      this.broadcast(jobId);
    }
    console.log(`[ImageBatch ${jobId.slice(0, 8)}] ${message}`);
  }

  private broadcast(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job && this.broadcastCallback) {
      this.broadcastCallback(jobId, {
        type: "image_batch_progress",
        data: { jobId, ...job },
      });
    }
    this.broadcastQueueState();
  }

  private broadcastQueueState() {
    if (this.broadcastCallback) {
      this.broadcastCallback("", {
        type: "image_batch_queue",
        data: this.getQueueState(),
      });
    }
  }

  getQueueState(): {
    queue: string[];
    currentJobId: string | null;
    currentJobIds: string[];
    jobs: ImageBatchJob[];
  } {
    const jobs = Array.from(this.jobs.values());
    const queue = Array.from(this.jobQueueByInstance.values()).flat();
    const currentJobIds = Array.from(this.currentJobByInstance.values()).filter(
      Boolean,
    );
    return {
      queue,
      currentJobId: currentJobIds[0] ?? null,
      currentJobIds,
      jobs: jobs.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    };
  }

  private processQueue(): void {
    const instanceIds = new Set<string>([
      ...this.jobQueueByInstance.keys(),
      ...this.currentJobByInstance.keys(),
    ]);
    for (const instanceId of instanceIds) {
      if (this.currentJobByInstance.get(instanceId) != null) continue;
      const queue = this.jobQueueByInstance.get(instanceId);
      if (!queue?.length) continue;

      const nextId = queue.shift()!;
      this.jobQueueByInstance.set(instanceId, queue);
      this.currentJobByInstance.set(instanceId, nextId);
      this.broadcastQueueState();
      this.startJob(nextId)
        .finally(() => {
          this.currentJobByInstance.delete(instanceId);
          this.processQueue();
        })
        .catch((err) => {
          console.error(`Image batch job ${nextId} error:`, err);
        });
    }
  }

  getJob(jobId: string): ImageBatchJob | undefined {
    return this.jobs.get(jobId);
  }

  createJob(params: ImageBatchJobParams): string {
    const jobId = uuidv4();
    const totalTasks = params.poses.reduce(
      (acc, p) => acc + RUNS_PER_POSE * (p.handFix ? 2 : 1),
      0,
    );

    const job: ImageBatchJob = {
      id: jobId,
      status: "pending",
      totalTasks,
      completedTasks: 0,
      currentPose: "",
      currentSeedIndex: 0,
      logs: [],
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);
    this.jobParams.set(jobId, params);
    this.stopRequested.set(jobId, false);

    const instanceId = params.instanceId;
    if (!this.jobQueueByInstance.has(instanceId)) {
      this.jobQueueByInstance.set(instanceId, []);
    }
    this.jobQueueByInstance.get(instanceId)!.push(jobId);
    this.broadcastQueueState();
    this.processQueue();

    return jobId;
  }

  async startJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    const params = this.jobParams.get(jobId);
    if (!job || !params) throw new Error("Job not found");

    job.status = "running";
    this.addLog(jobId, `Batch started: ${params.poses.length} poses x ${RUNS_PER_POSE} random seeds = ${job.totalTasks} tasks`);

    const comfy = comfyManager.getInstance(params.instanceId);

    try {
      for (const pose of params.poses) {
        if (this.stopRequested.get(jobId)) {
          job.status = "stopped";
          this.addLog(jobId, "Batch stopped by user");
          this.broadcast(jobId);
          return;
        }

        job.currentPose = pose.poseName;
        const poseData = this.poseConfig[pose.poseName]?.[pose.expression];
        if (!poseData) {
          this.addLog(jobId, `⚠️ Config not found: ${pose.poseName}/${pose.expression}, skipping`);
          const skipCount = RUNS_PER_POSE * (pose.handFix ? 2 : 1);
          job.completedTasks += skipCount;
          this.broadcast(jobId);
          continue;
        }

        const outputDir = join(params.outputPath, pose.poseName);
        await mkdir(outputDir, { recursive: true });

        for (let si = 0; si < RUNS_PER_POSE; si++) {
          if (this.stopRequested.get(jobId)) {
            job.status = "stopped";
            this.addLog(jobId, "Batch stopped by user");
            this.broadcast(jobId);
            return;
          }

          const seed = randomSeed();
          job.currentSeedIndex = si;

          const runs: { positive: string; negative: string; suffix: string }[] = pose.handFix
            ? [
                {
                  positive: this.buildPositivePrompt(
                    params.positiveBlocks,
                    poseData.prompt,
                    "",
                  ),
                  negative: this.buildNegativePrompt(
                    params.negativeBlocks,
                    poseData.negativePrompt,
                    "",
                  ),
                  suffix: "nofix",
                },
                {
                  positive: this.buildPositivePrompt(
                    params.positiveBlocks,
                    poseData.prompt,
                    params.handFixPositive,
                  ),
                  negative: this.buildNegativePrompt(
                    params.negativeBlocks,
                    poseData.negativePrompt,
                    params.handFixNegative,
                  ),
                  suffix: "handfix",
                },
              ]
            : [
                {
                  positive: this.buildPositivePrompt(
                    params.positiveBlocks,
                    poseData.prompt,
                    "",
                  ),
                  negative: this.buildNegativePrompt(
                    params.negativeBlocks,
                    poseData.negativePrompt,
                    "",
                  ),
                  suffix: "",
                },
              ];

          for (const run of runs) {
            if (this.stopRequested.get(jobId)) {
              job.status = "stopped";
              this.addLog(jobId, "Batch stopped by user");
              this.broadcast(jobId);
              return;
            }

            const label = run.suffix ? ` ${run.suffix}` : "";
            this.addLog(jobId, `Generating: ${pose.poseName} [${pose.expression}] seed ${seed}${label} (${job.completedTasks + 1}/${job.totalTasks})`);
            this.broadcast(jobId);

            try {
              const workflow = createImageGenWorkflow({
                loras: params.loras,
                positivePrompt: run.positive,
                negativePrompt: run.negative,
                seed,
                batchSize: params.batchSize,
              });

              const queueResponse = await comfy.queuePrompt(workflow);
              const promptId = queueResponse.prompt_id;

              if (
                queueResponse.node_errors &&
                Object.keys(queueResponse.node_errors).length > 0
              ) {
                this.addLog(jobId, `⚠️ Workflow validation error for ${pose.poseName}${label}, skipping`);
                job.completedTasks++;
                this.broadcast(jobId);
                continue;
              }

              const result = await this.pollForCompletion(comfy, promptId);
              const images = result.outputs["212"]?.images || [];

              const nameSuffix = run.suffix ? `_${run.suffix}` : "";
              for (const img of images) {
                const imageBuffer = await comfy.getImage(
                  img.filename,
                  img.subfolder,
                  img.type,
                );
                const saveName = `${pose.poseName}_${pose.expression}_seed${seed}${nameSuffix}_${img.filename}`;
                const savePath = join(outputDir, saveName);
                await writeFile(savePath, imageBuffer);
              }

              this.addLog(jobId, `✅ ${pose.poseName} [${pose.expression}] seed ${seed}${label}: ${images.length} images saved`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              this.addLog(jobId, `❌ Failed: ${pose.poseName} seed ${seed}${label}: ${msg}`);
            }

            job.completedTasks++;
            this.broadcast(jobId);
          }
        }
      }

      job.status = "completed";
      this.addLog(jobId, `✅ Batch completed: ${job.completedTasks}/${job.totalTasks} tasks`);
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
    blocks: ImageBatchJobParams["positiveBlocks"],
    compositionPrompt: string,
    handFixPositive: string,
  ): string {
    return [
      blocks.fixedPrefix,
      blocks.styleTrigger,
      blocks.character,
      blocks.outfit,
      compositionPrompt,
      blocks.backgroundPositive,
      blocks.fixedSuffix,
      handFixPositive,
    ]
      .filter((b) => b.trim())
      .join("\n\n");
  }

  private buildNegativePrompt(
    blocks: ImageBatchJobParams["negativeBlocks"],
    nsfwNegative: string,
    handFixNegative: string,
  ): string {
    return [
      blocks.fixedNegative,
      handFixNegative,
      nsfwNegative,
      blocks.backgroundNegative,
    ]
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

export const imageBatchService = new ImageBatchService();
