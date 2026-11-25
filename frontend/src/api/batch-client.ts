import axios from "axios";
import type { AxiosInstance } from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3002/api";

export interface BatchJob {
  id: string;
  folderPath: string;
  outputFolderPath: string;
  prefixPrompt: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "stopped";
  currentImageIndex: number;
  totalImages: number;
  currentVideoIndex: number;
  totalVideos: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
  logs: string[];
}

export type VideoEngine = "minimax" | "wan";
export type SkipReason = "existing" | "no_prompt" | "minimax_owned";

export interface ImageTask {
  poseName: string;
  imagePath: string;
  imageName: string;
  outputFolder: string;
  sequenceNumber?: number;
  targetFilename?: string;
  skipped?: boolean;
  skipReason?: SkipReason;
  engine?: VideoEngine;
}

export function countImageTasks(images: ImageTask[]) {
  const pending = images.filter((img) => !img.skipped);
  return {
    pending: pending.length,
    skipped: images.length - pending.length,
    minimax: pending.filter((img) => img.engine === "minimax").length,
    wan: pending.filter((img) => img.engine === "wan").length,
    noPrompt: images.filter((img) => img.skipReason === "no_prompt").length,
    minimaxOwned: images.filter((img) => img.skipReason === "minimax_owned")
      .length,
  };
}

export interface BatchScanResult {
  images: ImageTask[];
  count: number;
  pending: number;
  skipped: number;
}

export interface BatchVideoSettings {
  fixedSeedCount: 1 | 2 | 3;
  preferMinimax: boolean;
}

class BatchClient {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: API_BASE_URL,
      timeout: 120000, // 2 minutes for batch operations
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Scan folder for images
   */
  async scanFolder(
    folderPath: string,
    outputFolderPath?: string,
  ): Promise<BatchScanResult> {
    try {
      const response = await this.httpClient.post("/batch/scan", {
        folderPath,
        outputFolderPath,
      });
      const images = response.data.images ?? [];
      return {
        images,
        count: response.data.count ?? images.length,
        pending: response.data.pending ?? 0,
        skipped: response.data.skipped ?? 0,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(err.response?.data?.error || "Failed to scan folder");
    }
  }

  /**
   * Start batch processing
   */
  async startBatch(
    folderPath: string,
    outputFolderPath: string,
    prefixPrompt: string = "",
    autoStopPod: boolean = false,
    comfyInstanceId?: string,
  ): Promise<{ jobId: string; job: BatchJob }> {
    try {
      const response = await this.httpClient.post("/batch/start", {
        folderPath,
        outputFolderPath,
        prefixPrompt,
        autoStopPod,
        comfyInstanceId,
      });
      return {
        jobId: response.data.jobId,
        job: response.data.job,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(err.response?.data?.error || "Failed to start batch");
    }
  }

  /**
   * Pause batch processing
   */
  async pauseBatch(jobId: string): Promise<void> {
    try {
      await this.httpClient.post(`/batch/${jobId}/pause`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(err.response?.data?.error || "Failed to pause batch");
    }
  }

  /**
   * Resume batch processing
   */
  async resumeBatch(jobId: string): Promise<void> {
    try {
      await this.httpClient.post(`/batch/${jobId}/resume`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(err.response?.data?.error || "Failed to resume batch");
    }
  }

  /**
   * Stop batch processing
   */
  async stopBatch(jobId: string): Promise<void> {
    try {
      await this.httpClient.post(`/batch/${jobId}/stop`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(err.response?.data?.error || "Failed to stop batch");
    }
  }

  /**
   * Get batch status
   */
  async getBatchStatus(jobId: string): Promise<BatchJob> {
    try {
      const response = await this.httpClient.get(`/batch/${jobId}/status`);
      return response.data.job;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(
        err.response?.data?.error || "Failed to get batch status",
      );
    }
  }

  /**
   * Get all jobs
   */
  async getAllJobs(): Promise<BatchJob[]> {
    try {
      const response = await this.httpClient.get("/batch/jobs");
      return response.data.jobs;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(err.response?.data?.error || "Failed to get jobs");
    }
  }

  /** Persisted: fixed seed count per image (2 or 3). Survives refresh and server restart. */
  async getBatchVideoSettings(): Promise<BatchVideoSettings> {
    const response = await this.httpClient.get("/batch/settings");
    if (!response.data?.success || !response.data?.data) {
      throw new Error("Failed to load batch settings");
    }
    return response.data.data as BatchVideoSettings;
  }

  async updateBatchVideoSettings(
    settings: Partial<BatchVideoSettings>,
  ): Promise<BatchVideoSettings> {
    const response = await this.httpClient.put("/batch/settings", settings);
    if (!response.data?.success || !response.data?.data) {
      throw new Error("Failed to save batch settings");
    }
    return response.data.data as BatchVideoSettings;
  }
}

export const batchClient = new BatchClient();
