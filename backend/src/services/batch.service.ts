import { readdir, stat, mkdir } from "fs/promises";
import { join, basename, extname } from "path";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import type { ComfyService } from "./comfy.service.js";
import { comfyManager } from "./comfy-manager.service.js";
import { createWanWorkflow } from "../utils/workflow-helpers.js";
import { runPodService } from "./runpod.service.js";
import { podUsageTracker } from "./pod-usage-tracker.service.js";
import { instanceQueueManager } from "./instance-queue-manager.service.js";
import { readBatchVideoSettings } from "./batch-video-settings.service.js";

// Fixed seeds for batch processing (use first N by persisted fixedSeedCount)
const FIXED_SEEDS = [625130800946143, 625130800946142, 625130800946144];

export interface BatchJob {
  id: string;
  folderPath: string;
  outputFolderPath: string;
  prefixPrompt: string;
  /** Number of fixed seeds per image (2 or 3); persisted server-side. */
  fixedSeedCount: 2 | 3;
  includeRandomSeeds: boolean;
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

export interface ImageTask {
  poseName: string;
  imagePath: string;
  imageName: string;
  outputFolder: string;
}

export interface VideoTask {
  imageTask: ImageTask;
  seed: number;
  isRandom: boolean;
  index: number;
}

export interface PoseConfig {
  [poseName: string]: {
    prompt: string;
    negativePrompt: string;
  };
}

class BatchService {
  private jobs: Map<string, BatchJob> = new Map();
  private isPaused: Map<string, boolean> = new Map();
  private isStopped: Map<string, boolean> = new Map();
  private poseConfig: PoseConfig = {};
  private broadcastCallback?: (jobId: string, data: any) => void;

  constructor() {
    this.loadPoseConfig();
  }

  /**
   * Load pose configuration from pose-config.json
   */
  private loadPoseConfig() {
    try {
      const configPath = join(process.cwd(), "..", "pose-config.json");
      const configData = readFileSync(configPath, "utf-8");
      this.poseConfig = JSON.parse(configData);
      console.log(
        "✅ Loaded pose configuration:",
        Object.keys(this.poseConfig),
      );
    } catch (error) {
      console.error("❌ Failed to load pose-config.json:", error);
      this.poseConfig = {};
    }
  }

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

  /**
   * Scan folder for images
   */
  async scanFolder(folderPath: string): Promise<ImageTask[]> {
    const imageTasks: ImageTask[] = [];

    try {
      // Read all subdirectories (pose folders)
      const entries = await readdir(folderPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const poseName = entry.name;
          const poseFolder = join(folderPath, poseName);

          // Read all files in pose folder
          const files = await readdir(poseFolder);

          for (const file of files) {
            const ext = extname(file).toLowerCase();
            if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
              imageTasks.push({
                poseName,
                imagePath: join(poseFolder, file),
                imageName: file,
                outputFolder: "", // Will be set when processing
              });
            }
          }
        }
      }

      console.log(`✅ Scanned ${imageTasks.length} images from ${folderPath}`);
      return imageTasks;
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
    prefixPrompt: string,
    includeRandomSeeds: boolean = false,
    autoStopPod: boolean = false,
    comfyInstanceId?: string,
  ): Promise<BatchJob> {
    const jobId = uuidv4();
    const instanceId =
      comfyInstanceId || comfyManager.getDefaultInstanceId();

    // Scan folder to get image count
    const imageTasks = await this.scanFolder(folderPath);

    const { fixedSeedCount } = await readBatchVideoSettings();
    const videosPerImage =
      fixedSeedCount + (includeRandomSeeds ? 2 : 0);

    const job: BatchJob = {
      id: jobId,
      folderPath,
      outputFolderPath:
        outputFolderPath ||
        process.env.DEFAULT_OUTPUT_FOLDER_PATH ||
        "./output",
      prefixPrompt,
      fixedSeedCount,
      includeRandomSeeds,
      autoStopPod,
      comfyInstanceId: instanceId,
      status: "pending",
      currentImageIndex: 0,
      totalImages: imageTasks.length,
      currentVideoIndex: 0,
      totalVideos: imageTasks.length * videosPerImage,
      createdAt: new Date(),
      logs: [],
    };

    this.jobs.set(jobId, job);
    this.isPaused.set(jobId, false);
    this.isStopped.set(jobId, false);

    this.addLog(jobId, `Created batch job for ${imageTasks.length} images`);

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

  /**
   * Main batch processing loop
   */
  private async processBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const comfyInstance = comfyManager.getInstance(job.comfyInstanceId);

    try {
      // Scan folder again to get fresh list
      const imageTasks = await this.scanFolder(job.folderPath);

      for (let i = 0; i < imageTasks.length; i++) {
        // Check if paused
        while (this.isPaused.get(jobId)) {
          await this.sleep(1000);
        }

        // Check if stopped
        if (this.isStopped.get(jobId)) {
          job.status = "stopped";
          this.addLog(jobId, "Batch processing stopped by user");
          return;
        }

        const imageTask = imageTasks[i];
        job.currentImageIndex = i + 1;

        this.addLog(
          jobId,
          `Processing image ${i + 1}/${imageTasks.length}: ${
            imageTask.imageName
          }`,
        );

        await this.processImageTask(jobId, imageTask, comfyInstance);
      }

      // All done
      job.status = "completed";
      job.completedAt = new Date();
      this.addLog(jobId, "Batch processing completed successfully");

      // Auto-stop RunPod if enabled (and no other jobs using it)
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
    }
  }

  /**
   * Process single image: fixedSeedCount fixed seeds + optional 2 random seeds.
   */
  private async processImageTask(
    jobId: string,
    imageTask: ImageTask,
    comfyInstance: ComfyService,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      // Map pose name to output folder name (some poses share the same folder)
      const outputFolderName = this.mapPoseToFolderName(imageTask.poseName);

      // Create output folder for this pose
      const poseOutputFolder = join(job.outputFolderPath, outputFolderName);
      await mkdir(poseOutputFolder, { recursive: true });

      // Upload image to ComfyUI
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

      // Get pose-specific prompt
      const posePrompt = this.poseConfig[imageTask.poseName]?.prompt || "";
      const negativePrompt =
        this.poseConfig[imageTask.poseName]?.negativePrompt || "";
      const fullPrompt = `${job.prefixPrompt}, ${posePrompt}`.trim();

      // Count existing videos in output folder to determine starting number
      const existingFiles = await import("fs/promises")
        .then((fs) => fs.readdir(poseOutputFolder))
        .catch(() => []);
      const existingVideoCount = existingFiles.filter((f) =>
        f.endsWith(".mkv"),
      ).length;

      const fixedCount = job.fixedSeedCount;
      const videosToGenerate =
        fixedCount + (job.includeRandomSeeds ? 2 : 0);
      for (let i = 0; i < videosToGenerate; i++) {
        // Check pause/stop
        while (this.isPaused.get(jobId)) {
          await this.sleep(1000);
        }
        if (this.isStopped.get(jobId)) {
          return;
        }

        job.currentVideoIndex = i + 1;

        const seed =
          i < fixedCount ? FIXED_SEEDS[i] : this.generateRandomSeed();
        const seedType = i < fixedCount ? "fixed" : "random";

        this.addLog(
          jobId,
          `Generating video ${
            i + 1
          }/${videosToGenerate} with ${seedType} seed: ${seed}`,
        );

        // Create workflow
        const workflow = createWanWorkflow(
          fullPrompt,
          negativePrompt,
          uploadedImageName,
          uploadedImageName,
          seed,
        );

        // Execute workflow with retry logic
        let result;
        let workflowRetries = 0;
        const maxWorkflowRetries = 3;

        while (workflowRetries < maxWorkflowRetries) {
          try {
            result = await comfyInstance.executeWorkflow(workflow);
            this.addLog(jobId, `Workflow executed: ${result.prompt_id}`);
            break; // Success, exit retry loop
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
              ); // 2s, 4s, 8s
              this.addLog(
                jobId,
                `⚠️ Workflow execution failed (${errorMessage}), retrying in ${
                  waitTime / 1000
                }s (${workflowRetries}/${maxWorkflowRetries})...`,
              );
              await this.sleep(waitTime);
            } else {
              this.addLog(
                jobId,
                `❌ Workflow execution failed after ${maxWorkflowRetries} attempts: ${errorMessage}`,
              );
              throw error; // Re-throw to be caught by outer try-catch
            }
          }
        }

        if (!result) {
          throw new Error("Workflow execution failed after retries");
        }

        // Download videos
        const videoSequenceNumber = existingVideoCount + i + 1;
        const videoFilename = this.generateVideoFilename(
          outputFolderName,
          videoSequenceNumber,
        );

        // Download MKV only (node 828)
        if (result.outputs["828"]?.gifs?.[0]) {
          const mkvFile = result.outputs["828"].gifs[0];
          const mkvFilename = videoFilename.replace(".mp4", ".mkv");
          const mkvOutputPath = join(poseOutputFolder, mkvFilename);
          await comfyInstance.downloadAndSaveVideo(
            mkvFile.filename,
            mkvOutputPath,
            mkvFile.subfolder,
            mkvFile.type,
          );
          this.addLog(jobId, `Saved MKV: ${mkvFilename}`);
        }

        // Broadcast progress
        this.broadcast(jobId, {
          type: "batch_progress",
          jobId,
          currentImage: imageTask.imageName,
          currentImageIndex: job.currentImageIndex,
          totalImages: job.totalImages,
          currentVideoIndex: i + 1,
          totalVideos: videosToGenerate,
          overallProgress: Math.round(
            (((job.currentImageIndex - 1) * videosToGenerate + (i + 1)) /
              job.totalVideos) *
              100,
          ),
          status: job.status,
        });
      }

      this.addLog(
        jobId,
        `Completed processing ${imageTask.imageName} (${videosToGenerate} videos generated)`,
      );
    } catch (error: any) {
      this.addLog(
        jobId,
        `Error processing ${imageTask.imageName}: ${error.message}`,
      );
      // Continue to next image instead of stopping entire batch
      console.error(`Error processing image ${imageTask.imageName}:`, error);
    }
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

  /**
   * Generate random seed
   */
  private generateRandomSeed(): number {
    return Math.floor(Math.random() * 999999999999999);
  }

  /**
   * Map pose name to output folder name
   * Some pose variations should be saved to the same folder
   */
  private mapPoseToFolderName(poseName: string): string {
    const poseMapping: Record<string, string> = {
      SingleFootjob: "Footjob",
      DoubleFootjob: "Footjob",
      PaizuriNoTongue: "Paizuri",
    };

    return poseMapping[poseName] || poseName;
  }

  /**
   * Generate video filename
   */
  private generateVideoFilename(
    poseName: string,
    sequentialNumber: number,
  ): string {
    return `${poseName}_${sequentialNumber.toString().padStart(5, "0")}.mp4`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const batchService = new BatchService();
