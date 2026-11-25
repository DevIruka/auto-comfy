import { mkdir, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import type { ComfyService, ComfyWorkflow } from "./comfy.service.js";
import { comfyManager } from "./comfy-manager.service.js";
import {
  createFrameInterpolateWorkflow,
  createMinimaxH3Workflow,
} from "../utils/workflow-helpers.js";
import { sshTunnelService } from "./ssh-tunnel.service.js";
import { runPodService } from "./runpod.service.js";
import { podUsageTracker } from "./pod-usage-tracker.service.js";
import { instanceQueueManager } from "./instance-queue-manager.service.js";
import {
  appendInterpolationFailureReport,
  writeBatchV1FailureReport,
  type BatchV2Failure,
} from "../utils/batch-v2-error-report.js";
import { generateWanI2VToFile } from "./mulerouter-wan-i2v.service.js";
import { readBatchVideoSettings } from "./batch-video-settings.service.js";
import {
  countRoutedTasks,
  generateVideoFilename,
  getMinimaxPosePrompt,
  listExistingVideoNumbers,
  loadMinimaxPromptConfig,
  loadPoseConfig,
  parsePoseOutputNaming,
  planAdultVideoTasks,
  resolvePoseConfigKey,
  resolveWanVersionFromPose,
  routeAdultVideoTasks,
  scanAdultVideoFolder,
  sortPendingByEngine,
  sleep,
  wanLogLabel,
  type ImageTask,
  type PoseConfig,
} from "../utils/batch-folder-utils.js";

export type { ImageTask, PoseConfig };

const COMFY_INPUT_DIR = "/workspace/runpod-slim/ComfyUI/input";
const COMFY_OUTPUT_DIR = "/workspace/runpod-slim/ComfyUI/output";
const COMFY_OUTPUT_VIDEO_DIR = "/workspace/runpod-slim/ComfyUI/output/video";

function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

type ComfyMediaFile = {
  filename: string;
  subfolder?: string;
  type?: string;
};

const VIDEO_FILENAME_RE = /\.(mp4|webm|mov|mkv|avi)$/i;

function collectNodeMedia(node: unknown): ComfyMediaFile[] {
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const items: ComfyMediaFile[] = [];
  for (const key of ["videos", "gifs", "images", "animated", "files"]) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as ComfyMediaFile).filename === "string"
      ) {
        items.push(item as ComfyMediaFile);
      }
    }
  }
  return items;
}

function pickVideoFile(files: ComfyMediaFile[]): ComfyMediaFile | null {
  return (
    files.find((file) => VIDEO_FILENAME_RE.test(file.filename)) ??
    files[0] ??
    null
  );
}

function findInterpolatedVideo(
  outputs: Record<string, unknown> | undefined,
): ComfyMediaFile | null {
  if (!outputs) return null;
  const preferredIds = ["7", "16:5"];
  for (const nodeId of preferredIds) {
    const found = pickVideoFile(collectNodeMedia(outputs[nodeId]));
    if (found) return found;
  }
  for (const node of Object.values(outputs)) {
    const found = pickVideoFile(collectNodeMedia(node));
    if (found) return found;
  }
  return null;
}

function summarizeHistoryOutputs(
  outputs: Record<string, unknown> | undefined,
): string {
  if (!outputs) return "(no outputs)";
  const summary = Object.fromEntries(
    Object.entries(outputs).map(([nodeId, node]) => {
      const keys =
        node && typeof node === "object" ? Object.keys(node) : [];
      const files = collectNodeMedia(node).map((file) => file.filename);
      return [nodeId, { keys, files }];
    }),
  );
  return JSON.stringify(summary);
}

export interface BatchJob {
  id: string;
  folderPath: string;
  outputFolderPath: string;
  prefixPrompt: string;
  autoStopPod: boolean;
  comfyInstanceId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "stopped";
  currentImageIndex: number;
  totalImages: number;
  currentVideoIndex: number;
  totalVideos: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  logs: string[];
}

export interface VideoTask {
  imageTask: ImageTask;
  seed: number;
  isRandom: boolean;
  index: number;
}

class BatchService {
  private jobs: Map<string, BatchJob> = new Map();
  private isPaused: Map<string, boolean> = new Map();
  private isStopped: Map<string, boolean> = new Map();
  private failures = new Map<string, BatchV2Failure[]>();
  private interpolationReportPath = new Map<string, string>();
  private minimaxConfig: PoseConfig = loadMinimaxPromptConfig();
  private poseConfig: PoseConfig = loadPoseConfig();
  private broadcastCallback?: (jobId: string, data: any) => void;

  /**
   * Set broadcast callback for progress updates
   */
  setBroadcastCallback(callback: (jobId: string, data: any) => void) {
    this.broadcastCallback = callback;
  }

  /**
   * Broadcast progress update
   */
  private broadcast(jobId: string, data: any) {
    if (this.broadcastCallback) {
      this.broadcastCallback(jobId, data);
    }
  }

  /**
   * Add log to job
   */
  private addLog(jobId: string, message: string) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.logs.push(`[${new Date().toISOString()}] ${message}`);
      console.log(`[Job ${jobId}] ${message}`);
    }
  }

  private recordFailure(jobId: string, failure: BatchV2Failure) {
    const list = this.failures.get(jobId) ?? [];
    list.push(failure);
    this.failures.set(jobId, list);
  }

  private async recordInterpolationFailure(
    jobId: string,
    failure: BatchV2Failure,
    cause?: unknown,
  ): Promise<void> {
    const interpolFailure: BatchV2Failure = {
      ...failure,
      stage: failure.stage || "interpolation",
    };
    this.recordFailure(jobId, interpolFailure);
    console.error(
      `❌ [interpolation] Job ${jobId} ${interpolFailure.imageName} → ${interpolFailure.targetFilename}: ${interpolFailure.error}`,
      cause ?? interpolFailure.error,
    );

    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      const filePath = await appendInterpolationFailureReport({
        filePath: this.interpolationReportPath.get(jobId),
        failure: interpolFailure,
        inputPath: job.folderPath,
        outputPath: job.outputFolderPath,
      });
      this.interpolationReportPath.set(jobId, filePath);
      this.addLog(jobId, `Interpolation error logged: ${filePath}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.addLog(jobId, `Failed to write interpolation error log: ${msg}`);
      console.error(
        `❌ [interpolation] Failed to write error log for job ${jobId}:`,
        error,
      );
    }
  }

  /**
   * Scan folder for images and assign V2-style filenames / skip flags.
   */
  async scanFolder(
    folderPath: string,
    outputFolderPath?: string,
  ): Promise<ImageTask[]> {
    try {
      const { preferMinimax } = await readBatchVideoSettings();
      const images = await scanAdultVideoFolder(folderPath);
      const planned = await planAdultVideoTasks(images, outputFolderPath);
      return routeAdultVideoTasks(planned, {
        preferMinimax,
        mode: "v1",
        minimaxConfig: this.minimaxConfig,
        poseConfig: this.poseConfig,
      });
    } catch (error: any) {
      console.error("❌ Failed to scan folder:", error);
      throw new Error(`Failed to scan folder: ${error.message}`);
    }
  }

  /**
   * Create batch job
   */
  async createBatchJob(
    folderPath: string,
    outputFolderPath: string,
    prefixPrompt: string = "",
    autoStopPod: boolean = false,
    comfyInstanceId?: string,
  ): Promise<BatchJob> {
    const jobId = uuidv4();
    const instanceId =
      comfyInstanceId || comfyManager.getDefaultInstanceId();
    const resolvedOutput =
      outputFolderPath ||
      process.env.DEFAULT_OUTPUT_FOLDER_PATH ||
      "./output";

    const imageTasks = await this.scanFolder(folderPath, resolvedOutput);
    const pending = sortPendingByEngine(imageTasks);
    const counts = countRoutedTasks(imageTasks);

    const job: BatchJob = {
      id: jobId,
      folderPath,
      outputFolderPath: resolvedOutput,
      prefixPrompt,
      autoStopPod,
      comfyInstanceId: instanceId,
      status: "pending",
      currentImageIndex: 0,
      totalImages: pending.length,
      currentVideoIndex: 0,
      totalVideos: pending.length,
      createdAt: new Date(),
      logs: [],
    };

    this.jobs.set(jobId, job);
    this.isPaused.set(jobId, false);
    this.isStopped.set(jobId, false);
    this.failures.set(jobId, []);
    this.interpolationReportPath.delete(jobId);

    this.addLog(
      jobId,
      `Created hybrid batch job: ${counts.pending} to generate (MiniMax ${counts.minimax} · WAN ${counts.wan}), ${counts.skipped} skipped (${counts.noPrompt} no prompt)`,
    );

    return job;
  }

  /**
   * Start batch processing via the unified queue manager
   */
  async startBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status === "running") {
      throw new Error(`Job ${jobId} is already running`);
    }

    instanceQueueManager.enqueue({
      jobId,
      serviceType: "batch",
      label: `Video batch: ${job.totalImages} images`,
      instanceId: job.comfyInstanceId,
      onStart: () => this.runBatchJob(jobId),
    });
  }

  private async runBatchJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = "running";
    this.addLog(jobId, "Starting batch processing");

    const comfyInstance = comfyManager.getInstance(job.comfyInstanceId);
    const podId = runPodService.extractPodIdFromUrl(comfyInstance.getApiUrl());
    if (podId && job.autoStopPod) {
      podUsageTracker.acquire(podId);
    }

    try {
      await this.processBatch(jobId);
    } catch (error: any) {
      console.error(`Batch job ${jobId} failed:`, error);
      job.status = "failed";
      job.error = error.message;
      this.addLog(jobId, `Failed: ${error.message}`);
      if (podId && job.autoStopPod) {
        podUsageTracker.release(podId);
      }
    }
  }

  private async writeFailureReportIfNeeded(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    const failures = this.failures.get(jobId) ?? [];
    if (!job || failures.length === 0) return;

    try {
      const filePath = await writeBatchV1FailureReport({
        failures,
        inputPath: job.folderPath,
        outputPath: job.outputFolderPath,
      });
      if (filePath) {
        this.addLog(jobId, `Failure report written: ${filePath}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.addLog(jobId, `Failed to write error report: ${msg}`);
    }
  }

  /**
   * Main batch processing loop
   */
  private async processBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const comfyInstance = comfyManager.getInstance(job.comfyInstanceId);

    try {
      const imageTasks = await this.scanFolder(
        job.folderPath,
        job.outputFolderPath,
      );
      const pending = sortPendingByEngine(imageTasks);
      const counts = countRoutedTasks(imageTasks);
      job.totalImages = pending.length;
      job.totalVideos = pending.length;

      if (counts.noPrompt > 0) {
        this.addLog(
          jobId,
          `Skipped ${counts.noPrompt} images with no MiniMax or WAN prompt`,
        );
      }
      if (counts.existing > 0) {
        this.addLog(jobId, `Skipped ${counts.existing} existing .mp4 files`);
      }
      if (pending.length === 0) {
        this.addLog(jobId, "Nothing to generate");
      } else {
        this.addLog(
          jobId,
          `Queue: MiniMax ${counts.minimax} first, then WAN ${counts.wan}`,
        );
      }

      let lastMinimaxIndex = -1;
      for (let i = 0; i < pending.length; i++) {
        if ((pending[i].engine ?? "minimax") === "minimax") {
          lastMinimaxIndex = i;
        }
      }

      for (let i = 0; i < pending.length; i++) {
        while (this.isPaused.get(jobId)) {
          await sleep(1000);
        }

        if (this.isStopped.get(jobId)) {
          job.status = "stopped";
          this.addLog(jobId, "Batch processing stopped by user");
          return;
        }

        const imageTask = pending[i];
        job.currentImageIndex = i + 1;
        job.currentVideoIndex = i + 1;

        this.addLog(
          jobId,
          `Processing image ${i + 1}/${pending.length}: ${
            imageTask.imageName
          } → ${imageTask.targetFilename}`,
        );

        await this.processImageTask(jobId, imageTask, comfyInstance, i);

        if (i === lastMinimaxIndex && !this.isStopped.get(jobId)) {
          await this.clearComfyInputAndOutputVideo(
            jobId,
            job.comfyInstanceId,
          );
        }
      }

      if (this.isStopped.get(jobId)) {
        job.status = "stopped";
        this.addLog(jobId, "Batch processing stopped by user");
        return;
      }

      job.status = "completed";
      job.completedAt = new Date();
      this.addLog(jobId, "Batch processing completed successfully");

      if (job.autoStopPod) {
        const comfyUrl = comfyInstance.getApiUrl();
        const podId = runPodService.extractPodIdFromUrl(comfyUrl);

        if (podId) {
          const canStop = podUsageTracker.release(podId);

          if (canStop) {
            this.addLog(jobId, "🛑 Auto-stopping RunPod...");
            const stopped = await runPodService.stopPodByComfyUrl(comfyUrl);
            if (stopped) {
              this.addLog(jobId, "✅ RunPod stopped successfully");
            } else {
              this.addLog(jobId, "⚠️ Failed to stop RunPod (check logs)");
            }
          } else {
            this.addLog(
              jobId,
              "⚠️ RunPod still in use by other jobs - NOT stopping",
            );
          }
        }
      }

      this.broadcast(jobId, {
        type: "batch_completed",
        jobId,
      });
    } catch (error: any) {
      job.status = "failed";
      job.error = error.message;
      this.addLog(jobId, `Error: ${error.message}`);
      throw error;
    } finally {
      await this.writeFailureReportIfNeeded(jobId);
    }
  }

  /**
   * Process one image → one Comfy video. Skip if matching .mp4 already exists.
   */
  private async processImageTask(
    jobId: string,
    imageTask: ImageTask,
    comfyInstance: ComfyService,
    pendingIndex: number,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const naming = parsePoseOutputNaming(imageTask.poseName);
    const outputFolderName = imageTask.outputFolder || naming.folder;
    const sequenceNumber =
      imageTask.sequenceNumber ?? naming.variant * 10000 + 1;
    const targetFilename =
      imageTask.targetFilename ||
      generateVideoFilename(outputFolderName, sequenceNumber);
    const poseOutputFolder = join(job.outputFolderPath, outputFolderName);

    try {
      const existing = await listExistingVideoNumbers(
        poseOutputFolder,
        outputFolderName,
      );
      if (existing.has(sequenceNumber)) {
        this.addLog(jobId, `Skip existing ${targetFilename}`);
        return;
      }

      const engine = imageTask.engine ?? "minimax";
      await mkdir(poseOutputFolder, { recursive: true });

      if (engine === "wan") {
        await this.processWanImageTask(
          jobId,
          imageTask,
          poseOutputFolder,
          targetFilename,
          pendingIndex,
        );
        return;
      }

      const resolved = getMinimaxPosePrompt(
        imageTask.poseName,
        this.minimaxConfig,
      );
      if (!resolved) {
        const error = `No minimax prompt for ${imageTask.poseName}`;
        this.addLog(jobId, error);
        this.recordFailure(jobId, {
          poseName: imageTask.poseName,
          imageName: imageTask.imageName,
          targetFilename,
          error,
        });
        return;
      }
      if (resolved.key !== imageTask.poseName) {
        this.addLog(jobId, `${imageTask.poseName} → ${resolved.key}`);
      }

      this.addLog(jobId, `Uploading image: ${imageTask.imageName}`);
      const imageBuffer = await import("fs/promises").then((fs) =>
        fs.readFile(imageTask.imagePath),
      );
      const uploadResult = await comfyInstance.uploadImage(
        imageBuffer as Buffer,
        imageTask.imageName,
      );
      const uploadedImageName = uploadResult.name;

      this.addLog(jobId, `Image uploaded: ${uploadedImageName}`);
      this.addLog(jobId, `Generating MiniMax H3 ${targetFilename}`);

      const workflow = createMinimaxH3Workflow(
        uploadedImageName,
        resolved.prompt,
      );

      const result = await this.executeWorkflowWithRetries(
        jobId,
        comfyInstance,
        workflow,
      );

      const videoFile =
        result.outputs["2568"]?.videos?.[0] ||
        result.outputs["2568"]?.gifs?.[0];
      if (!videoFile) {
        throw new Error("Workflow output missing node 2568 video");
      }
      const mp4OutputPath = join(poseOutputFolder, targetFilename);

      this.addLog(jobId, `Interpolating ${videoFile.filename}...`);
      try {
        await this.interpolateMinimaxVideo(
          jobId,
          comfyInstance,
          job.comfyInstanceId,
          videoFile,
          mp4OutputPath,
        );
        this.addLog(jobId, `Replaced with interpolated MP4: ${targetFilename}`);
      } catch (interpError: any) {
        const interpMsg = interpError.message || String(interpError);
        this.addLog(
          jobId,
          `⚠️ Interpolation failed (${interpMsg}), saving raw MiniMax`,
        );
        await this.recordInterpolationFailure(
          jobId,
          {
            poseName: imageTask.poseName,
            imageName: imageTask.imageName,
            targetFilename,
            error: `Interpolation failed, saved raw MiniMax: ${interpMsg}`,
          },
          interpError,
        );
        try {
          await comfyInstance.downloadAndSaveVideo(
            videoFile.filename,
            mp4OutputPath,
            videoFile.subfolder,
            videoFile.type,
          );
        } catch (rawError: any) {
          const rawMsg = rawError.message || String(rawError);
          throw new Error(
            `Interpolation failed (${interpMsg}); also failed to save raw MiniMax: ${rawMsg}`,
          );
        }
      }

      this.broadcast(jobId, {
        type: "batch_progress",
        jobId,
        currentImage: imageTask.imageName,
        currentImageIndex: job.currentImageIndex,
        totalImages: job.totalImages,
        currentVideoIndex: pendingIndex + 1,
        totalVideos: job.totalVideos,
        overallProgress: Math.round(
          ((pendingIndex + 1) / job.totalVideos) * 100,
        ),
        status: job.status,
      });

      this.addLog(jobId, `Completed processing ${imageTask.imageName}`);
    } catch (error: any) {
      const msg = error.message || String(error);
      this.addLog(jobId, `Error processing ${imageTask.imageName}: ${msg}`);
      this.recordFailure(jobId, {
        poseName: imageTask.poseName,
        imageName: imageTask.imageName,
        targetFilename,
        error: msg,
      });
      console.error(`Error processing image ${imageTask.imageName}:`, error);
    }
  }

  private async processWanImageTask(
    jobId: string,
    imageTask: ImageTask,
    poseOutputFolder: string,
    targetFilename: string,
    pendingIndex: number,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const configKey = resolvePoseConfigKey(imageTask.poseName, this.poseConfig);
    if (!configKey) {
      const error = `No pose-config for ${imageTask.poseName}`;
      this.addLog(jobId, error);
      this.recordFailure(jobId, {
        poseName: imageTask.poseName,
        imageName: imageTask.imageName,
        targetFilename,
        error,
      });
      return;
    }
    if (configKey !== imageTask.poseName) {
      this.addLog(jobId, `${imageTask.poseName} → ${configKey}`);
    }

    this.addLog(jobId, `Reading image: ${imageTask.imageName}`);
    const posePrompt = this.poseConfig[configKey].prompt || "";
    const negativePrompt = this.poseConfig[configKey].negativePrompt || "";
    const prefix = (job.prefixPrompt || "").trim();
    const fullPrompt = prefix ? `${prefix}, ${posePrompt}` : posePrompt;
    const taskVersion = resolveWanVersionFromPose(
      "json",
      configKey,
      this.poseConfig,
    );

    this.addLog(jobId, `${wanLogLabel("json", taskVersion)} ${targetFilename}`);

    const outputPath = join(poseOutputFolder, targetFilename);
    await generateWanI2VToFile({
      version: taskVersion,
      prompt: fullPrompt,
      imagePath: imageTask.imagePath,
      outputPath,
      negativePrompt,
      onLog: (message) => this.addLog(jobId, message),
      onPoll: (status, attempt) => {
        if (attempt === 1 || attempt % 6 === 0) {
          this.addLog(jobId, `WAN task status: ${status}`);
        }
      },
    });
    this.addLog(jobId, `Saved MP4: ${targetFilename}`);

    this.broadcast(jobId, {
      type: "batch_progress",
      jobId,
      currentImage: imageTask.imageName,
      currentImageIndex: job.currentImageIndex,
      totalImages: job.totalImages,
      currentVideoIndex: pendingIndex + 1,
      totalVideos: job.totalVideos,
      overallProgress: Math.round(
        ((pendingIndex + 1) / job.totalVideos) * 100,
      ),
      status: job.status,
    });
    this.addLog(jobId, `Completed processing ${imageTask.imageName}`);
  }

  /**
   * Pause batch
   */
  async pauseBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== "running") {
      throw new Error(`Job ${jobId} is not running`);
    }

    this.isPaused.set(jobId, true);
    job.status = "paused";
    this.addLog(jobId, "Batch processing paused");
  }

  /**
   * Resume batch
   */
  async resumeBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status !== "paused") {
      throw new Error(`Job ${jobId} is not paused`);
    }

    this.isPaused.set(jobId, false);
    job.status = "running";
    this.addLog(jobId, "Batch processing resumed");
  }

  private async executeWorkflowWithRetries(
    jobId: string,
    comfyInstance: ComfyService,
    workflow: ComfyWorkflow,
  ): Promise<{ prompt_id: string; outputs: any }> {
    let result: { prompt_id: string; outputs: any } | undefined;
    let workflowRetries = 0;
    const maxWorkflowRetries = 3;

    while (workflowRetries < maxWorkflowRetries) {
      try {
        result = await comfyInstance.executeWorkflow(workflow);
        this.addLog(jobId, `Workflow executed: ${result.prompt_id}`);
        break;
      } catch (error: any) {
        workflowRetries++;
        const errorMessage = error.message || String(error);
        const isRetryable =
          errorMessage.includes("502") ||
          errorMessage.includes("503") ||
          errorMessage.includes("504") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("ECONNRESET");

        if (isRetryable && workflowRetries < maxWorkflowRetries) {
          const waitTime = Math.min(
            2000 * Math.pow(2, workflowRetries - 1),
            10000,
          );
          this.addLog(
            jobId,
            `⚠️ Workflow execution failed (${errorMessage}), retrying in ${
              waitTime / 1000
            }s (${workflowRetries}/${maxWorkflowRetries})...`,
          );
          await sleep(waitTime);
        } else {
          this.addLog(
            jobId,
            `❌ Workflow execution failed after ${maxWorkflowRetries} attempts: ${errorMessage}`,
          );
          throw error;
        }
      }
    }

    if (!result) {
      throw new Error("Workflow execution failed after retries");
    }
    return result;
  }

  private remoteComfyPath(
    root: string,
    subfolder: string | undefined,
    filename: string,
  ): string {
    const parts = [root];
    if (subfolder) {
      parts.push(...subfolder.split(/[/\\]+/).filter(Boolean));
    }
    parts.push(filename);
    return parts.join("/");
  }

  private async stageMinimaxVideoForInterpolate(
    jobId: string,
    comfyInstance: ComfyService,
    instanceId: string,
    videoFile: ComfyMediaFile,
  ): Promise<string> {
    const filename = videoFile.filename;
    if (sshTunnelService.isTunnelInstance(instanceId)) {
      const typeFolder = videoFile.type || "output";
      const srcRoot =
        typeFolder === "input"
          ? COMFY_INPUT_DIR
          : typeFolder === "temp"
            ? "/workspace/runpod-slim/ComfyUI/temp"
            : COMFY_OUTPUT_DIR;
      const src = this.remoteComfyPath(srcRoot, videoFile.subfolder, filename);
      const dest = `${COMFY_INPUT_DIR}/${filename}`;
      await sshTunnelService.execRemote(
        instanceId,
        `mkdir -p ${shSingleQuote(COMFY_INPUT_DIR)} && cp ${shSingleQuote(src)} ${shSingleQuote(dest)}`,
      );
      this.addLog(jobId, `Copied MiniMax output to Comfy input: ${filename}`);
      return filename;
    }

    const tmpPath = join(tmpdir(), `minimax-raw-${uuidv4()}.mp4`);
    try {
      await comfyInstance.downloadAndSaveVideo(
        filename,
        tmpPath,
        videoFile.subfolder,
        videoFile.type,
      );
      const buffer = await readFile(tmpPath);
      const uploaded = await comfyInstance.uploadImage(buffer, filename);
      return uploaded.name || filename;
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
  }

  private async interpolateMinimaxVideo(
    jobId: string,
    comfyInstance: ComfyService,
    instanceId: string,
    videoFile: ComfyMediaFile,
    outputPath: string,
  ): Promise<void> {
    const inputFilename = await this.stageMinimaxVideoForInterpolate(
      jobId,
      comfyInstance,
      instanceId,
      videoFile,
    );
    const workflow = createFrameInterpolateWorkflow(inputFilename);
    const result = await this.executeWorkflowWithRetries(
      jobId,
      comfyInstance,
      workflow,
    );
    let interpFile = findInterpolatedVideo(result.outputs);
    if (!interpFile) {
      const snapshot = summarizeHistoryOutputs(result.outputs);
      this.addLog(jobId, `Interpolation history had no video: ${snapshot}`);
      if (sshTunnelService.isTunnelInstance(instanceId)) {
        try {
          interpFile = await this.findNewestRemoteInterpolVideo(instanceId);
          if (interpFile) {
            this.addLog(
              jobId,
              `Using newest remote interpol file: ${interpFile.subfolder || ""}/${interpFile.filename}`,
            );
          }
        } catch (remoteError: any) {
          this.addLog(
            jobId,
            `Failed to look up remote interpol file: ${remoteError.message || String(remoteError)}`,
          );
          console.error(
            `❌ [interpolation] Job ${jobId} remote interpol lookup failed:`,
            remoteError,
          );
        }
      }
    }
    if (!interpFile) {
      throw new Error(
        `Interpolation workflow output missing video (history: ${summarizeHistoryOutputs(result.outputs)})`,
      );
    }
    await comfyInstance.downloadAndSaveVideo(
      interpFile.filename,
      outputPath,
      interpFile.subfolder,
      interpFile.type,
    );
  }

  private async findNewestRemoteInterpolVideo(
    instanceId: string,
  ): Promise<ComfyMediaFile | null> {
    const command = [
      `find ${shSingleQuote(COMFY_OUTPUT_VIDEO_DIR)} -type f`,
      `\\( -iname 'ComfyUI*.mp4' -o -iname 'ComfyUI*.webm' -o -iname 'ComfyUI*.mov' \\)`,
      `-printf '%T@ %p\\n' | sort -n | tail -1 | cut -d' ' -f2-`,
    ].join(" ");
    const { stdout } = await sshTunnelService.execRemote(instanceId, command);
    const remotePath = stdout.trim();
    if (!remotePath) return null;

    const prefix = `${COMFY_OUTPUT_DIR}/`;
    const relative = remotePath.startsWith(prefix)
      ? remotePath.slice(prefix.length)
      : remotePath.replace(/^.*\/output\//, "");
    const parts = relative.split("/").filter(Boolean);
    const filename = parts.pop();
    if (!filename) return null;
    return {
      filename,
      subfolder: parts.join("/"),
      type: "output",
    };
  }

  private async clearComfyInputAndOutputVideo(
    jobId: string,
    instanceId: string,
  ): Promise<void> {
    if (!sshTunnelService.isTunnelInstance(instanceId)) {
      this.addLog(jobId, "SSH cleanup skipped (not an SSH-tunnel instance)");
      return;
    }
    try {
      await sshTunnelService.execRemote(
        instanceId,
        `mkdir -p ${shSingleQuote(COMFY_OUTPUT_VIDEO_DIR)} ${shSingleQuote(COMFY_INPUT_DIR)} && find ${shSingleQuote(COMFY_OUTPUT_VIDEO_DIR)} ${shSingleQuote(COMFY_INPUT_DIR)} -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
      );
      this.addLog(jobId, "Cleared Comfy input and output/video");
    } catch (error: any) {
      this.addLog(
        jobId,
        `⚠️ Failed to clear Comfy folders: ${error.message || String(error)}`,
      );
      console.error(
        `❌ [interpolation] Job ${jobId} failed to clear Comfy input/output/video:`,
        error,
      );
    }
  }

  /**
   * Stop batch
   */
  async stopBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    this.isStopped.set(jobId, true);
    this.isPaused.set(jobId, false);
    job.status = "stopped";
    this.addLog(jobId, "Batch processing stopped");
  }

  /**
   * Get batch status
   */
  getBatchStatus(jobId: string): BatchJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): BatchJob[] {
    return Array.from(this.jobs.values());
  }

}

export const batchService = new BatchService();
