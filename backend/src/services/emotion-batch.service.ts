import { readdir, readFile, mkdir } from "fs/promises";
import { join, basename, extname } from "path";
import { v4 as uuidv4 } from "uuid";
import { readFileSync } from "fs";
import { comfyManager } from "./comfy-manager.service.js";
import {
  createWanWorkflow,
  createEmotionWorkflow,
} from "../utils/workflow-helpers.js";
import {
  parseEmotionImage,
  generateEmotionFilename,
  type EmotionImageInfo,
  type VideoType,
} from "../utils/emotion-helpers.js";
import { runPodService } from "./runpod.service.js";
import { podUsageTracker } from "./pod-usage-tracker.service.js";

// Fixed seeds for batch processing (same as pose batch)
const FIXED_SEEDS = [625130800946143, 625130800946142, 625130800946144];

export interface EmotionBatchJob {
  id: string;
  folderPath: string;
  outputFolderPath: string;
  prefixPrompt: string;
  comfyInstanceId: string;
  includeSpeakNatural: boolean;
  autoStopPod: boolean; // NEW: Auto-stop RunPod after completion
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

export interface EmotionImageTask {
  pose: string;
  emotion: string;
  clothingType: string;
  imagePath: string;
  imageName: string;
  outputFolder: string;
}

interface EmotionConfig {
  [emotion: string]: {
    [pose: string]: {
      idle_0_prompt?: string;
      idle_0_negative_prompt?: string;
      idle_1_prompt?: string;
      idle_1_negative_prompt?: string;
      idle_2_prompt?: string;
      idle_2_negative_prompt?: string;
      idle_3_prompt?: string;
      idle_3_negative_prompt?: string;
      idle_4_prompt?: string;
      idle_4_negative_prompt?: string;
      speaknatural_same_prompt: string;
      speaknatural_same_negative_prompt: string;
      speaknatural_to_neutral_prompt: string;
      speaknatural_to_neutral_negative_prompt: string;
    };
  };
}

class EmotionBatchService {
  private jobs: Map<string, EmotionBatchJob> = new Map();
  private isPaused: Map<string, boolean> = new Map();
  private isStopped: Map<string, boolean> = new Map();
  private emotionConfig: EmotionConfig = {};
  private broadcastCallback?: (jobId: string, data: any) => void;
  /** 한 인스턴스에서 동시에 하나의 작업만 실행 (포트별 직렬화) */
  private runningJobByInstance: Map<string, string> = new Map();
  private instanceQueue: Map<string, string[]> = new Map();

  constructor() {
    this.loadEmotionConfig();
  }

  /**
   * Load emotion configuration from emotion-config.json
   */
  private loadEmotionConfig() {
    try {
      const configPath = join(process.cwd(), "..", "emotion-config.json");
      const configData = readFileSync(configPath, "utf-8");
      this.emotionConfig = JSON.parse(configData);
      console.log(
        "✅ Loaded emotion configuration:",
        Object.keys(this.emotionConfig),
      );
    } catch (error) {
      console.error("❌ Failed to load emotion-config.json:", error);
      this.emotionConfig = {};
    }
  }

  /**
   * Set broadcast callback for WebSocket
   */
  setBroadcastCallback(callback: (jobId: string, data: any) => void) {
    this.broadcastCallback = callback;
  }

  /**
   * Broadcast message to connected clients
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
      job.logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
      console.log(`[Job ${jobId}] ${message}`);
    }
  }

  /**
   * Scan folder for emotion images
   */
  async scanFolder(folderPath: string): Promise<EmotionImageTask[]> {
    const tasks: EmotionImageTask[] = [];

    try {
      // Read root folder
      const rootFiles = await readdir(folderPath, { withFileTypes: true });

      // Process files in root folder (clothed)
      for (const file of rootFiles) {
        if (file.isFile() && this.isImageFile(file.name)) {
          try {
            const imageInfo = parseEmotionImage(file.name, false);
            tasks.push({
              pose: imageInfo.pose,
              emotion: imageInfo.emotion,
              clothingType: imageInfo.clothingType,
              imagePath: join(folderPath, file.name),
              imageName: file.name,
              outputFolder: folderPath,
            });
          } catch (error) {
            console.warn(`⚠️  Skipping invalid filename: ${file.name}`);
          }
        }
      }

      // Check for nude subfolder
      const nudeFolder = join(folderPath, "nude");
      try {
        const nudeFiles = await readdir(nudeFolder);
        for (const file of nudeFiles) {
          if (this.isImageFile(file)) {
            try {
              const imageInfo = parseEmotionImage(file, true);
              tasks.push({
                pose: imageInfo.pose,
                emotion: imageInfo.emotion,
                clothingType: imageInfo.clothingType,
                imagePath: join(nudeFolder, file),
                imageName: file,
                outputFolder: nudeFolder,
              });
            } catch (error) {
              console.warn(`⚠️  Skipping invalid nude filename: ${file}`);
            }
          }
        }
      } catch (error) {
        // No nude folder or can't read it - that's okay
        console.log("ℹ️  No nude folder found or unable to read it");
      }

      console.log(
        `✅ Scanned ${tasks.length} emotion images from ${folderPath}`,
      );
      return tasks;
    } catch (error) {
      console.error("❌ Failed to scan folder:", error);
      throw new Error(`Failed to scan folder: ${error}`);
    }
  }

  /**
   * Check if file is an image
   */
  private isImageFile(filename: string): boolean {
    const ext = extname(filename).toLowerCase();
    return [".png", ".jpg", ".jpeg"].includes(ext);
  }

  /**
   * Create emotion batch job
   */
  async createEmotionBatchJob(
    folderPath: string,
    outputFolderPath: string,
    prefixPrompt: string,
    comfyInstanceId: string,
    includeSpeakNatural: boolean = true,
    autoStopPod: boolean = false,
  ): Promise<EmotionBatchJob> {
    const jobId = uuidv4();

    // Verify ComfyUI instance exists
    if (!comfyManager.hasInstance(comfyInstanceId)) {
      throw new Error(
        `ComfyUI instance '${comfyInstanceId}' not found. Available: ${comfyManager
          .getAllInstances()
          .map((i) => i.id)
          .join(", ")}`,
      );
    }

    // Scan folder to get image count
    const imageTasks = await this.scanFolder(folderPath);

    if (imageTasks.length === 0) {
      throw new Error("No valid emotion images found in folder");
    }

    // Calculate total videos based on emotions and includeSpeakNatural toggle
    // neutral (with speak): 18 videos (15 idle [5 prompts × 3 seeds] + 3 speaknatural_same)
    // neutral (idle only): 15 videos (15 idle [5 prompts × 3 seeds])
    // other emotions (with speak): 6 videos (0 idle + 3 speaknatural_same + 3 speaknatural_to_neutral)
    // other emotions (idle only): 0 videos (no idle for non-neutral emotions)
    const totalVideos = imageTasks.reduce((sum, task) => {
      if (task.emotion === "neutral") {
        return sum + (includeSpeakNatural ? 18 : 15);
      } else {
        return sum + (includeSpeakNatural ? 6 : 0);
      }
    }, 0);

    const job: EmotionBatchJob = {
      id: jobId,
      folderPath,
      outputFolderPath:
        outputFolderPath ||
        process.env.DEFAULT_OUTPUT_FOLDER_PATH ||
        "./output",
      prefixPrompt,
      comfyInstanceId,
      includeSpeakNatural,
      autoStopPod,
      status: "pending",
      currentImageIndex: 0,
      totalImages: imageTasks.length,
      currentVideoIndex: 0,
      totalVideos,
      createdAt: new Date(),
      logs: [],
    };

    this.jobs.set(jobId, job);
    this.isPaused.set(jobId, false);
    this.isStopped.set(jobId, false);

    this.addLog(
      jobId,
      `Created emotion batch job for ${imageTasks.length} images using ${comfyInstanceId}`,
    );

    return job;
  }

  /**
   * Release instance slot and start next job in queue for that instance
   */
  private releaseInstanceAndStartNext(instanceId: string): void {
    this.runningJobByInstance.delete(instanceId);
    const q = this.instanceQueue.get(instanceId);
    if (q && q.length > 0) {
      const nextJobId = q.shift()!;
      this.instanceQueue.set(instanceId, q);
      void this.startBatch(nextJobId);
    }
  }

  /**
   * Start batch processing (per-instance queue: only one job per port at a time)
   */
  async startBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status === "running") {
      throw new Error(`Job ${jobId} is already running`);
    }

    const instanceId = job.comfyInstanceId;
    if (this.runningJobByInstance.get(instanceId)) {
      const q = this.instanceQueue.get(instanceId) ?? [];
      q.push(jobId);
      this.instanceQueue.set(instanceId, q);
      this.addLog(jobId, `Queued for instance ${instanceId} (${q.length} ahead)`);
      return;
    }

    this.runningJobByInstance.set(instanceId, jobId);
    job.status = "running";
    this.addLog(jobId, "Starting emotion batch processing");

    const comfyInstance = comfyManager.getInstance(job.comfyInstanceId);
    const podId = runPodService.extractPodIdFromUrl(comfyInstance.getApiUrl());
    if (podId && job.autoStopPod) {
      podUsageTracker.acquire(podId);
    }

    this.processBatch(jobId)
      .catch((error) => {
        console.error(`Error in batch ${jobId}:`, error);
        job.status = "failed";
        job.error = error.message;
        this.addLog(jobId, `Batch failed: ${error.message}`);
        if (podId && job.autoStopPod) {
          podUsageTracker.release(podId);
        }
      })
      .finally(() => {
        this.releaseInstanceAndStartNext(instanceId);
      });
  }

  /**
   * Main batch processing loop
   */
  private async processBatch(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      // Scan folder again to get fresh list
      const imageTasks = await this.scanFolder(job.folderPath);

      for (let i = 0; i < imageTasks.length; i++) {
        // Check stop flag
        if (this.isStopped.get(jobId)) {
          job.status = "stopped";
          this.addLog(jobId, "Batch processing stopped by user");
          return;
        }

        // Check pause flag
        while (this.isPaused.get(jobId)) {
          await this.sleep(1000);
        }

        job.currentImageIndex = i + 1;
        const imageTask = imageTasks[i];

        this.addLog(
          jobId,
          `Processing image ${i + 1}/${imageTasks.length}: ${
            imageTask.imageName
          }`,
        );

        try {
          await this.processEmotionImageTask(jobId, imageTask);
        } catch (error: any) {
          this.addLog(
            jobId,
            `Error processing ${imageTask.imageName}: ${error.message}`,
          );
          console.error(
            `Error processing image ${imageTask.imageName}:`,
            error,
          );
          // Continue to next image
        }
      }

      job.status = "completed";
      job.completedAt = new Date();
      this.addLog(jobId, "Batch processing completed successfully");

      // Auto-stop RunPod if enabled (and no other jobs using it)
      if (job.autoStopPod) {
        try {
          const comfyInstance = comfyManager.getInstance(job.comfyInstanceId);
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
        } catch (error: any) {
          this.addLog(jobId, `⚠️ Failed to stop RunPod: ${error.message}`);
        }
      }

      this.broadcast(jobId, {
        type: "batch_completed",
        jobId,
      });
    } catch (error: any) {
      job.status = "failed";
      job.error = error.message;
      this.addLog(jobId, `Batch failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Find neutral image for the same pose and clothing type
   */
  private async findNeutralImage(
    imageTask: EmotionImageTask,
  ): Promise<string | null> {
    try {
      // Determine the folder where neutral image should be
      const isNude = imageTask.clothingType === "Naked";
      const baseFolder = isNude
        ? join(imageTask.outputFolder, "..") // Go up from nude folder
        : imageTask.outputFolder;

      const folder = isNude ? join(baseFolder, "nude") : baseFolder;

      // Construct neutral image filename
      const poseLower = imageTask.pose.toLowerCase();
      const neutralFileName = isNude
        ? `${poseLower}_nude_neutral.png`
        : `${poseLower}_neutral.png`;

      const neutralImagePath = join(folder, neutralFileName);

      // Check if neutral image exists
      try {
        await readFile(neutralImagePath);
        this.addLog("", `Found neutral image: ${neutralFileName}`);
        return neutralImagePath;
      } catch {
        console.warn(
          `⚠️ Neutral image not found: ${neutralFileName} in ${folder}`,
        );
        return null;
      }
    } catch (error) {
      console.error("Error finding neutral image:", error);
      return null;
    }
  }

  /**
   * Process single emotion image (generate 11 or 6 videos)
   */
  private async processEmotionImageTask(
    jobId: string,
    imageTask: EmotionImageTask,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      const comfyService = comfyManager.getInstance(job.comfyInstanceId);

      // Create output folder
      await mkdir(job.outputFolderPath, { recursive: true });

      // Upload main image to ComfyUI
      this.addLog(jobId, `Uploading image: ${imageTask.imageName}`);
      const imageBuffer = await readFile(imageTask.imagePath);
      const uploadResult = await comfyService.uploadImage(
        imageBuffer,
        imageTask.imageName,
      );
      const uploadedImageName = uploadResult.name;
      this.addLog(jobId, `Image uploaded: ${uploadedImageName}`);

      // Upload neutral image if needed (for speaknatural_to_neutral videos)
      let uploadedNeutralImageName: string | null = null;
      if (imageTask.emotion !== "neutral") {
        const neutralImagePath = await this.findNeutralImage(imageTask);
        if (neutralImagePath) {
          this.addLog(jobId, `Uploading neutral image for transitions`);
          const neutralImageBuffer = await readFile(neutralImagePath);
          const neutralImageFileName = basename(neutralImagePath);
          const neutralUploadResult = await comfyService.uploadImage(
            neutralImageBuffer,
            neutralImageFileName,
          );
          uploadedNeutralImageName = neutralUploadResult.name;
          this.addLog(
            jobId,
            `Neutral image uploaded: ${uploadedNeutralImageName}`,
          );
        } else {
          this.addLog(
            jobId,
            `⚠️ Neutral image not found for ${imageTask.pose} ${imageTask.clothingType}, using original for last frame`,
          );
        }
      }

      // Get emotion config for specific pose
      const emotionConfig = this.emotionConfig[imageTask.emotion];
      if (!emotionConfig) {
        throw new Error(
          `No configuration found for emotion: ${imageTask.emotion}`,
        );
      }

      // Get pose-specific prompts (sit or stand)
      const poseLowerCase = imageTask.pose.toLowerCase();
      const emotionPrompts = emotionConfig[poseLowerCase];
      if (!emotionPrompts) {
        throw new Error(
          `No configuration found for emotion: ${imageTask.emotion}, pose: ${
            imageTask.pose
          }. Available poses: ${Object.keys(emotionConfig).join(", ")}`,
        );
      }

      // Count existing videos to determine starting index
      const existingFiles = await readdir(job.outputFolderPath).catch(() => []);
      const existingVideoCount = existingFiles.filter((f) =>
        f.endsWith(".mkv"),
      ).length;

      // Generate videos based on emotion and includeSpeakNatural toggle
      // neutral (with speak): 18 videos (15 idle [5 prompts × 3 seeds] + 3 speaknatural_same)
      // neutral (idle only): 15 videos (15 idle [5 prompts × 3 seeds])
      // other emotions (with speak): 6 videos (0 idle + 3 speaknatural_same + 3 speaknatural_to_neutral)
      // other emotions (idle only): 0 videos (no idle for non-neutral)
      const videoTypes: VideoType[] = [];

      if (imageTask.emotion === "neutral") {
        // Neutral gets 15 idle videos (5 prompt types × 3 seeds)
        for (let promptType = 0; promptType < 5; promptType++) {
          for (let seed = 0; seed < 3; seed++) {
            videoTypes.push("idle");
          }
        }
        // Add SpeakNatural if enabled
        if (job.includeSpeakNatural) {
          videoTypes.push(
            "speaknatural_same",
            "speaknatural_same",
            "speaknatural_same",
          );
        }
      } else {
        // Other emotions only get speaknatural if enabled
        if (job.includeSpeakNatural) {
          videoTypes.push(
            "speaknatural_same",
            "speaknatural_same",
            "speaknatural_same",
            "speaknatural_to_neutral",
            "speaknatural_to_neutral",
            "speaknatural_to_neutral",
          );
        }
      }

      const totalVideosForThisImage = videoTypes.length;
      this.addLog(
        jobId,
        `Will generate ${totalVideosForThisImage} videos for ${imageTask.emotion} emotion`,
      );

      for (let i = 0; i < totalVideosForThisImage; i++) {
        // Check pause/stop
        while (this.isPaused.get(jobId)) {
          await this.sleep(1000);
        }
        if (this.isStopped.get(jobId)) {
          return;
        }

        job.currentVideoIndex = i + 1;

        const videoType = videoTypes[i];
        // For idle videos, use modulo 5 to cycle through idle types 0-4
        // For other videos, use modulo 3 for seeds
        let seedIndex: number;
        let idleTypeIndex: number | null = null;

        if (videoType === "idle") {
          // For idle: i goes from 0-14
          // i=0,1,2 → idleType=0, seed=0,1,2
          // i=3,4,5 → idleType=1, seed=0,1,2
          // i=6,7,8 → idleType=2, seed=0,1,2
          // etc.
          idleTypeIndex = Math.floor(i / 3) % 5; // 5 different idle types (0, 1, 2, 3, 4)
          seedIndex = i % 3; // 3 seeds per idle type
        } else {
          // For non-idle videos, adjust the index
          const nonIdleIndex = imageTask.emotion === "neutral" ? i - 5 : i;
          seedIndex = nonIdleIndex % 3; // 0, 1, 2 for each type
        }

        const seed = FIXED_SEEDS[seedIndex];

        this.addLog(
          jobId,
          `Generating video ${i + 1}/${totalVideosForThisImage} (${videoType}${
            idleTypeIndex !== null ? ` type ${idleTypeIndex}` : ""
          }) with seed: ${seed}`,
        );

        // Get appropriate prompt for this video type
        let prompt: string;
        let negativePrompt: string;

        switch (videoType) {
          case "idle":
            // Only neutral emotion should have idle prompts
            // Use specific idle type (0-4)
            const idlePromptKey =
              `idle_${idleTypeIndex}_prompt` as keyof typeof emotionPrompts;
            const idleNegativeKey =
              `idle_${idleTypeIndex}_negative_prompt` as keyof typeof emotionPrompts;

            if (
              !emotionPrompts[idlePromptKey] ||
              !emotionPrompts[idleNegativeKey]
            ) {
              throw new Error(
                `Idle prompts (type ${idleTypeIndex}) not configured for emotion: ${imageTask.emotion}. Only neutral emotion should generate idle videos.`,
              );
            }
            prompt = `${job.prefixPrompt}, ${emotionPrompts[idlePromptKey]}`;
            negativePrompt = emotionPrompts[idleNegativeKey] as string;
            break;
          case "speaknatural_same":
            prompt = `${job.prefixPrompt}, ${emotionPrompts.speaknatural_same_prompt}`;
            negativePrompt = emotionPrompts.speaknatural_same_negative_prompt;
            break;
          case "speaknatural_to_neutral":
            prompt = `${job.prefixPrompt}, ${emotionPrompts.speaknatural_to_neutral_prompt}`;
            negativePrompt =
              emotionPrompts.speaknatural_to_neutral_negative_prompt;
            break;
        }

        // Determine last frame image
        // For speaknatural_to_neutral, use neutral image if available
        let lastFrameImage = uploadedImageName;
        if (
          videoType === "speaknatural_to_neutral" &&
          uploadedNeutralImageName
        ) {
          lastFrameImage = uploadedNeutralImageName;
          this.addLog(
            jobId,
            `Using neutral image for last frame: ${uploadedNeutralImageName}`,
          );
        }

        // Create workflow (using emotion-specific workflow)
        const workflow = createEmotionWorkflow(
          prompt,
          negativePrompt,
          uploadedImageName, // First frame: original emotion
          lastFrameImage, // Last frame: neutral for transitions, original for same emotion
          seed,
        );

        // Execute workflow with retry logic
        let result;
        let workflowRetries = 0;
        const maxWorkflowRetries = 3;

        while (workflowRetries < maxWorkflowRetries) {
          try {
            result = await comfyService.executeWorkflow(workflow);
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
              await this.sleep(waitTime);
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

        // Generate filename
        const videoSequenceNumber = existingVideoCount + i + 1;
        const videoFilename = generateEmotionFilename(
          {
            pose: imageTask.pose,
            emotion: imageTask.emotion,
            clothingType: imageTask.clothingType,
          },
          videoType,
          videoSequenceNumber,
        );

        // Download MKV only (node 828)
        if (result.outputs["828"]?.gifs?.[0]) {
          const mkvFile = result.outputs["828"].gifs[0];
          const mkvOutputPath = join(job.outputFolderPath, videoFilename);
          await comfyService.downloadAndSaveVideo(
            mkvFile.filename,
            mkvOutputPath,
            mkvFile.subfolder,
            mkvFile.type,
          );
          this.addLog(jobId, `Saved: ${videoFilename}`);
        }

        // Increment currentVideoIndex for progress tracking
        job.currentVideoIndex++;

        // Broadcast progress
        this.broadcast(jobId, {
          type: "emotion_batch_progress",
          jobId,
          currentImage: imageTask.imageName,
          currentImageIndex: job.currentImageIndex,
          totalImages: job.totalImages,
          currentVideoIndex: job.currentVideoIndex,
          totalVideos: job.totalVideos,
          status: job.status,
          overallProgress: Math.round(
            (job.currentVideoIndex / job.totalVideos) * 100,
          ),
        });
      }

      this.addLog(
        jobId,
        `✅ Completed ${imageTask.imageName} (${totalVideosForThisImage} videos generated)`,
      );
    } catch (error: any) {
      this.addLog(
        jobId,
        `❌ Failed to process ${imageTask.imageName}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Pause batch processing
   */
  pauseBatch(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.status === "running") {
      this.isPaused.set(jobId, true);
      job.status = "paused";
      this.addLog(jobId, "Batch processing paused");
    }
  }

  /**
   * Resume batch processing
   */
  resumeBatch(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.status === "paused") {
      this.isPaused.set(jobId, false);
      job.status = "running";
      this.addLog(jobId, "Batch processing resumed");
    }
  }

  /**
   * Stop batch processing. For running/paused jobs sets stop flag; for pending jobs removes from queue and marks stopped.
   */
  stopBatch(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    if (job.status === "pending") {
      const instanceId = job.comfyInstanceId;
      const q = this.instanceQueue.get(instanceId);
      if (q) {
        const idx = q.indexOf(jobId);
        if (idx !== -1) {
          q.splice(idx, 1);
          this.instanceQueue.set(instanceId, q);
        }
      }
    }

    this.isStopped.set(jobId, true);
    job.status = "stopped";
    this.addLog(jobId, "Batch processing stopped");
  }

  /**
   * Get batch status
   */
  getBatchStatus(jobId: string): EmotionBatchJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): EmotionBatchJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const emotionBatchService = new EmotionBatchService();
