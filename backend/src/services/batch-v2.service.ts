import { mkdir } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { generateWanI2VToFile } from "./mulerouter-wan-i2v.service.js";
import { readBatchVideoSettings } from "./batch-video-settings.service.js";
import {
  writeBatchV2FailureReport,
  type BatchV2Failure,
} from "../utils/batch-v2-error-report.js";
import {
  countRoutedTasks,
  listExistingVideoNumbers,
  loadMinimaxPromptConfig,
  loadPoseConfig,
  parsePoseOutputNaming,
  planAdultVideoTasks,
  resolvePoseConfigKey,
  resolveWanVersionFromPose,
  routeAdultVideoTasks,
  scanAdultVideoFolder,
  sleep,
  wanLogLabel,
  type ImageTask,
  type PoseConfig,
  type WanMode,
} from "../utils/batch-folder-utils.js";

export type { ImageTask, PoseConfig, WanMode };

export interface BatchV2Job {
  id: string;
  folderPath: string;
  outputFolderPath: string;
  prefixPrompt: string;
  wanVersion: WanMode;
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

class BatchV2Service {
  private jobs = new Map<string, BatchV2Job>();
  private isPaused = new Map<string, boolean>();
  private isStopped = new Map<string, boolean>();
  private failures = new Map<string, BatchV2Failure[]>();
  private minimaxConfig: PoseConfig = loadMinimaxPromptConfig();
  private poseConfig: PoseConfig = loadPoseConfig();
  private broadcastCallback?: (jobId: string, data: unknown) => void;

  setBroadcastCallback(callback: (jobId: string, data: unknown) => void) {
    this.broadcastCallback = callback;
  }

  private broadcast(jobId: string, data: unknown) {
    this.broadcastCallback?.(jobId, data);
  }

  private addLog(jobId: string, message: string) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.logs.push(`[${new Date().toISOString()}] ${message}`);
      console.log(`[BatchV2 ${jobId}] ${message}`);
    }
  }

  private recordFailure(jobId: string, failure: BatchV2Failure) {
    const list = this.failures.get(jobId) ?? [];
    list.push(failure);
    this.failures.set(jobId, list);
  }

  async scanFolder(folderPath: string, outputFolderPath?: string): Promise<ImageTask[]> {
    try {
      const { preferMinimax } = await readBatchVideoSettings();
      const images = await scanAdultVideoFolder(folderPath);
      const planned = await planAdultVideoTasks(images, outputFolderPath);
      return routeAdultVideoTasks(planned, {
        preferMinimax,
        mode: "v2",
        minimaxConfig: this.minimaxConfig,
        poseConfig: this.poseConfig,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to scan folder: ${msg}`);
    }
  }

  async createBatchJob(
    folderPath: string,
    outputFolderPath: string,
    prefixPrompt: string,
    wanVersion: WanMode = "json",
  ): Promise<BatchV2Job> {
    const jobId = uuidv4();
    const resolvedOutput =
      outputFolderPath ||
      process.env.DEFAULT_OUTPUT_FOLDER_PATH ||
      "./output";
    const imageTasks = await this.scanFolder(folderPath, resolvedOutput);
    const pending = imageTasks.filter((task) => !task.skipped);
    const counts = countRoutedTasks(imageTasks);

    const job: BatchV2Job = {
      id: jobId,
      folderPath,
      outputFolderPath: resolvedOutput,
      prefixPrompt,
      wanVersion,
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
    this.addLog(
      jobId,
      `Created WAN ${wanVersion} batch job: ${counts.pending} to generate, ${counts.skipped} skipped (${counts.minimaxOwned} MiniMax-owned)`,
    );
    return job;
  }

  async startBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status === "running") throw new Error(`Job ${jobId} is already running`);

    job.status = "running";
    this.addLog(jobId, `Starting WAN ${job.wanVersion} batch processing`);

    void this.processBatch(jobId).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Batch V2 job ${jobId} failed:`, error);
      job.status = "failed";
      job.error = msg;
      this.addLog(jobId, `Failed: ${msg}`);
    });
  }

  private async writeFailureReportIfNeeded(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    const failures = this.failures.get(jobId) ?? [];
    if (!job || failures.length === 0) return;

    try {
      const filePath = await writeBatchV2FailureReport({
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

  private async processBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      const imageTasks = await this.scanFolder(job.folderPath, job.outputFolderPath);
      const pending = imageTasks.filter((task) => !task.skipped);
      const counts = countRoutedTasks(imageTasks);
      job.totalImages = pending.length;
      job.totalVideos = pending.length;

      if (counts.minimaxOwned > 0) {
        this.addLog(
          jobId,
          `Skipped ${counts.minimaxOwned} MiniMax-owned poses`,
        );
      }
      if (counts.existing > 0) {
        this.addLog(jobId, `Skipped ${counts.existing} existing .mp4 files`);
      }

      if (pending.length === 0) {
        job.status = "completed";
        job.completedAt = new Date();
        this.addLog(jobId, "Nothing to generate");
        this.broadcast(jobId, { type: "batch_v2_completed", jobId });
        return;
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
          `Processing image ${i + 1}/${pending.length}: ${imageTask.imageName} → ${imageTask.targetFilename}`,
        );
        await this.processImageTask(jobId, imageTask, i);
      }

      if (this.isStopped.get(jobId)) {
        job.status = "stopped";
        this.addLog(jobId, "Batch processing stopped by user");
        return;
      }

      job.status = "completed";
      job.completedAt = new Date();
      this.addLog(
        jobId,
        `WAN ${job.wanVersion} batch processing completed successfully`,
      );
      this.broadcast(jobId, { type: "batch_v2_completed", jobId });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      job.status = "failed";
      job.error = msg;
      this.addLog(jobId, `Error: ${msg}`);
      throw error;
    } finally {
      await this.writeFailureReportIfNeeded(jobId);
    }
  }

  private async processImageTask(
    jobId: string,
    imageTask: ImageTask,
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
      `${outputFolderName}_${sequenceNumber.toString().padStart(5, "0")}.mp4`;
    const poseOutputFolder = join(job.outputFolderPath, outputFolderName);
    const outputPath = join(poseOutputFolder, targetFilename);

    try {
      const existing = await listExistingVideoNumbers(poseOutputFolder, outputFolderName);
      if (existing.has(sequenceNumber)) {
        this.addLog(jobId, `Skip existing ${targetFilename}`);
        return;
      }

      if (imageTask.skipReason === "minimax_owned") {
        this.addLog(jobId, `Skip MiniMax-owned ${targetFilename}`);
        return;
      }

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

      await mkdir(poseOutputFolder, { recursive: true });

      this.addLog(jobId, `Reading image: ${imageTask.imageName}`);
      const posePrompt = this.poseConfig[configKey].prompt || "";
      const negativePrompt = this.poseConfig[configKey].negativePrompt || "";
      const fullPrompt = `${job.prefixPrompt}, ${posePrompt}`.trim();
      const taskVersion = resolveWanVersionFromPose(
        job.wanVersion,
        configKey,
        this.poseConfig,
      );

      this.addLog(
        jobId,
        `${wanLogLabel(job.wanVersion, taskVersion)} ${targetFilename}`,
      );

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
        type: "batch_v2_progress",
        jobId,
        currentImage: imageTask.imageName,
        currentImageIndex: job.currentImageIndex,
        totalImages: job.totalImages,
        currentVideoIndex: pendingIndex + 1,
        totalVideos: job.totalVideos,
        overallProgress: Math.round(((pendingIndex + 1) / job.totalVideos) * 100),
        status: job.status,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.addLog(jobId, `Error processing ${imageTask.imageName}: ${msg}`);
      console.error(`Batch V2 error processing ${imageTask.imageName}:`, error);
      this.recordFailure(jobId, {
        poseName: imageTask.poseName,
        imageName: imageTask.imageName,
        targetFilename,
        error: msg,
      });
    }
  }

  async pauseBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status !== "running") throw new Error(`Job ${jobId} is not running`);
    this.isPaused.set(jobId, true);
    job.status = "paused";
    this.addLog(jobId, "Batch processing paused");
  }

  async resumeBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status !== "paused") throw new Error(`Job ${jobId} is not paused`);
    this.isPaused.set(jobId, false);
    job.status = "running";
    this.addLog(jobId, "Batch processing resumed");
  }

  async stopBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    this.isStopped.set(jobId, true);
    this.isPaused.set(jobId, false);
    job.status = "stopped";
    this.addLog(jobId, "Batch processing stopped");
  }

  getBatchStatus(jobId: string): BatchV2Job | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): BatchV2Job[] {
    return Array.from(this.jobs.values());
  }
}

export const batchV2Service = new BatchV2Service();
