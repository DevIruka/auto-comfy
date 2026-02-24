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

export interface ImageTask {
  poseName: string;
  imagePath: string;
  imageName: string;
  outputFolder: string;
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
  async scanFolder(folderPath: string): Promise<ImageTask[]> {
    try {
      const response = await this.httpClient.post("/batch/scan", {
        folderPath,
      });
      return response.data.images;
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
    prefixPrompt: string,
    includeRandomSeeds: boolean = false,
    autoStopPod: boolean = false,
  ): Promise<{ jobId: string; job: BatchJob }> {
    try {
      const response = await this.httpClient.post("/batch/start", {
        folderPath,
        outputFolderPath,
        prefixPrompt,
        includeRandomSeeds,
        autoStopPod,
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
}

export const batchClient = new BatchClient();
