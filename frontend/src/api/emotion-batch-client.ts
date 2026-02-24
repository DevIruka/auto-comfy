import axios from "axios";
import type { AxiosInstance } from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3002/api";

export interface EmotionImageTask {
  pose: string;
  emotion: string;
  clothingType: string;
  imagePath: string;
  imageName: string;
  outputFolder: string;
}

export interface EmotionBatchJob {
  id: string;
  folderPath: string;
  outputFolderPath: string;
  prefixPrompt: string;
  comfyInstanceId: string;
  includeSpeakNatural: boolean;
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

export interface ComfyInstance {
  id: string;
  url: string;
  name: string;
}

class EmotionBatchClient {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Get all available ComfyUI instances
   */
  async getComfyInstances(): Promise<ComfyInstance[]> {
    try {
      const response = await this.httpClient.get("/comfy-instances");
      return response.data.instances;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(
        err.response?.data?.error || "Failed to get ComfyUI instances",
      );
    }
  }

  /**
   * Scan folder for emotion images
   */
  async scanFolder(folderPath: string): Promise<EmotionImageTask[]> {
    try {
      const response = await this.httpClient.post("/emotion-batch/scan", {
        folderPath,
      });
      return response.data.images;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(err.response?.data?.error || "Failed to scan folder");
    }
  }

  /**
   * Start emotion batch processing
   */
  async startBatch(
    folderPath: string,
    outputFolderPath: string,
    prefixPrompt: string,
    comfyInstanceId: string,
    includeSpeakNatural: boolean = true,
    autoStopPod: boolean = false,
  ): Promise<{ jobId: string; job: EmotionBatchJob }> {
    try {
      const response = await this.httpClient.post("/emotion-batch/start", {
        folderPath,
        outputFolderPath,
        prefixPrompt,
        comfyInstanceId,
        includeSpeakNatural,
        autoStopPod,
      });
      return {
        jobId: response.data.jobId,
        job: response.data.job,
      };
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(
        err.response?.data?.error || "Failed to start emotion batch",
      );
    }
  }

  /**
   * Pause emotion batch processing
   */
  async pauseBatch(jobId: string): Promise<EmotionBatchJob> {
    try {
      const response = await this.httpClient.post(
        `/emotion-batch/${jobId}/pause`,
      );
      return response.data.job;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(
        err.response?.data?.error || "Failed to pause emotion batch",
      );
    }
  }

  /**
   * Resume emotion batch processing
   */
  async resumeBatch(jobId: string): Promise<EmotionBatchJob> {
    try {
      const response = await this.httpClient.post(
        `/emotion-batch/${jobId}/resume`,
      );
      return response.data.job;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(
        err.response?.data?.error || "Failed to resume emotion batch",
      );
    }
  }

  /**
   * Stop emotion batch processing
   */
  async stopBatch(jobId: string): Promise<EmotionBatchJob> {
    try {
      const response = await this.httpClient.post(
        `/emotion-batch/${jobId}/stop`,
      );
      return response.data.job;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(
        err.response?.data?.error || "Failed to stop emotion batch",
      );
    }
  }

  /**
   * Get emotion batch status
   */
  async getBatchStatus(jobId: string): Promise<EmotionBatchJob> {
    try {
      const response = await this.httpClient.get(
        `/emotion-batch/${jobId}/status`,
      );
      return response.data.job;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(
        err.response?.data?.error || "Failed to get emotion batch status",
      );
    }
  }

  /**
   * Get all emotion batch jobs
   */
  async getAllJobs(): Promise<EmotionBatchJob[]> {
    try {
      const response = await this.httpClient.get("/emotion-batch/jobs");
      return response.data.jobs;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      throw new Error(
        err.response?.data?.error || "Failed to get emotion batch jobs",
      );
    }
  }
}

export const emotionBatchClient = new EmotionBatchClient();
