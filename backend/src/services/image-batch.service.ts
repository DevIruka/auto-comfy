import { readFileSync } from "fs";
import { mkdir, writeFile, readdir, copyFile } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { comfyManager } from "./comfy-manager.service.js";
import { instanceQueueManager } from "./instance-queue-manager.service.js";
import {
  createImageGenWorkflow,
  type LoraSlotConfig,
} from "../utils/workflow-helpers.js";

export interface PoseExpressionConfig {
  prompt: string;
  negativePrompt: string;
}

export interface PoseLoraConfig {
  loraName: string;
  strengthModel: number;
  strengthClip: number;
}

export interface PoseConfig {
  loras?: PoseLoraConfig[];
  [key: string]: PoseExpressionConfig | PoseLoraConfig[] | undefined;
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
  /** shortform = 720×1280 (default), portrait = 1024×1536, custom = width/height */
  aspect?: "portrait" | "shortform" | "custom";
  width?: number;
  height?: number;
  /** Request-time pose prompt patch. Never writes img-pose-config.json. */
  promptPatch?: {
    enabled: boolean;
    addText?: string;
    removeText?: string;
    addPosition?: "prepend" | "append";
  };
}

const RUNS_PER_POSE = 3; // 포즈당 완전 랜덤 시드로 3번 요청
const MAX_LORA_SLOTS = 7;
const PORTRAIT_WIDTH = 1024;
const PORTRAIT_HEIGHT = 1536;
const SHORTFORM_WIDTH = 720;
const SHORTFORM_HEIGHT = 1280;

function normalizeCustomDimension(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(2048, Math.max(256, n));
  return Math.round(clamped / 8) * 8;
}

function resolveImageBatchSize(params: ImageBatchJobParams): {
  width: number;
  height: number;
} {
  if (params.aspect === "portrait") {
    return { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT };
  }
  if (params.aspect === "custom") {
    return {
      width: normalizeCustomDimension(params.width, SHORTFORM_WIDTH),
      height: normalizeCustomDimension(params.height, SHORTFORM_HEIGHT),
    };
  }
  return { width: SHORTFORM_WIDTH, height: SHORTFORM_HEIGHT };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1e15);
}

function splitPromptTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Copy-only patch of a pose expression prompt. The config file is never modified.
 * Remove matches comma-separated tags (case-insensitive). Add prepends or appends.
 */
export function applyPosePromptPatch(
  prompt: string,
  patch?: ImageBatchJobParams["promptPatch"],
): string {
  if (!patch?.enabled) return prompt;

  const removeSet = new Set(
    splitPromptTags(patch.removeText ?? "").map((tag) => tag.toLowerCase()),
  );
  let tags = splitPromptTags(prompt);
  if (removeSet.size > 0) {
    tags = tags.filter((tag) => !removeSet.has(tag.toLowerCase()));
  }

  const addTags = splitPromptTags(patch.addText ?? "");
  if (addTags.length > 0) {
    tags =
      patch.addPosition === "prepend"
        ? [...addTags, ...tags]
        : [...tags, ...addTags];
  }

  if (tags.length === 0) return "";
  return `${tags.join(", ")},`;
}

function isExpressionConfig(value: unknown): value is PoseExpressionConfig {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as PoseExpressionConfig).prompt === "string" &&
    typeof (value as PoseExpressionConfig).negativePrompt === "string"
  );
}

function getPoseLoras(pose: PoseConfig | undefined): PoseLoraConfig[] {
  if (!pose || !Array.isArray(pose.loras)) return [];
  return pose.loras.filter(
    (l) => !!l && typeof l.loraName === "string" && l.loraName.trim().length > 0,
  );
}

function mergeLorasForPose(
  uiLoras: LoraSlotConfig[],
  pose: PoseConfig | undefined,
): { loras: LoraSlotConfig[]; truncated: boolean; poseLoraNames: string[] } {
  const ui = uiLoras.filter((s) => s.enabled && s.loraName);
  const poseSlots: LoraSlotConfig[] = getPoseLoras(pose).map((l) => ({
    enabled: true,
    loraName: l.loraName,
    strengthModel: l.strengthModel,
    strengthClip: l.strengthClip,
  }));
  const merged = [...ui, ...poseSlots];
  return {
    loras: merged.slice(0, MAX_LORA_SLOTS),
    truncated: merged.length > MAX_LORA_SLOTS,
    poseLoraNames: poseSlots.map((l) => l.loraName),
  };
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
    if (!pose) return [];
    return Object.keys(pose).filter(
      (k) => k !== "loras" && isExpressionConfig(pose[k]),
    );
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

    instanceQueueManager.enqueue({
      jobId,
      serviceType: "image-batch",
      label: `Image batch: ${params.poses.length} poses`,
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
    const { width, height } = resolveImageBatchSize(params);
    this.addLog(
      jobId,
      `Batch started: ${params.poses.length} poses x ${RUNS_PER_POSE} random seeds = ${job.totalTasks} tasks (${width}×${height})`,
    );

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
        const poseEntry = this.poseConfig[pose.poseName];
        const rawExpr = poseEntry?.[pose.expression];
        if (!isExpressionConfig(rawExpr)) {
          this.addLog(jobId, `⚠️ Config not found: ${pose.poseName}/${pose.expression}, skipping`);
          const skipCount = RUNS_PER_POSE * (pose.handFix ? 2 : 1);
          job.completedTasks += skipCount;
          this.broadcast(jobId);
          continue;
        }
        const poseData = rawExpr;
        const compositionPrompt = applyPosePromptPatch(
          poseData.prompt,
          params.promptPatch,
        );
        if (
          params.promptPatch?.enabled &&
          compositionPrompt !== poseData.prompt
        ) {
          this.addLog(
            jobId,
            `Pose prompt patched for ${pose.poseName} [${pose.expression}] (config file unchanged)`,
          );
        }
        const merged = mergeLorasForPose(params.loras, poseEntry);
        if (merged.poseLoraNames.length > 0) {
          this.addLog(
            jobId,
            `Pose LoRA: ${pose.poseName} + [${merged.poseLoraNames.join(", ")}]`,
          );
        }
        if (merged.truncated) {
          this.addLog(
            jobId,
            `⚠️ pose LoRA truncated: ${pose.poseName} (max ${MAX_LORA_SLOTS} slots)`,
          );
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
                    compositionPrompt,
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
                    compositionPrompt,
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
                    compositionPrompt,
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
                loras: merged.loras,
                positivePrompt: run.positive,
                negativePrompt: run.negative,
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

        if (pose.poseName === "Masturbation") {
          try {
            const srcDir = join(params.outputPath, "Masturbation");
            const destDir = join(params.outputPath, "Cunnilingus");
            await mkdir(destDir, { recursive: true });
            const files = await readdir(srcDir);
            for (const file of files) {
              await copyFile(join(srcDir, file), join(destDir, file));
            }
            this.addLog(jobId, `📋 Masturbation → Cunnilingus: ${files.length} files copied`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.addLog(jobId, `⚠️ Failed to copy Masturbation → Cunnilingus: ${msg}`);
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
