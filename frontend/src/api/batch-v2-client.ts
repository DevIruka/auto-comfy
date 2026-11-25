import axios from "axios";
import type { AxiosInstance } from "axios";
import type { ImageTask } from "./batch-client";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3002/api";

export type WanVersion = "2.7" | "2.2";
export type WanMode = WanVersion | "json";

export interface BatchV2Job {
  id: string;
  folderPath: string;
  outputFolderPath: string;
  prefixPrompt: string;
  wanVersion?: WanMode;
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

export interface BatchV2ScanResult {
  images: ImageTask[];
  count: number;
  pending: number;
  skipped: number;
}

class BatchV2Client {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: API_BASE_URL,
      timeout: 120000,
      headers: { "Content-Type": "application/json" },
    });
  }

  async scanFolder(
    folderPath: string,
    outputFolderPath?: string,
  ): Promise<BatchV2ScanResult> {
    const response = await this.httpClient.post("/batch-v2/scan", {
      folderPath,
      outputFolderPath,
    });
    return {
      images: response.data.images,
      count: response.data.count ?? response.data.images?.length ?? 0,
      pending: response.data.pending ?? 0,
      skipped: response.data.skipped ?? 0,
    };
  }

  async startBatch(
    folderPath: string,
    outputFolderPath: string,
    prefixPrompt: string,
    wanVersion: WanMode = "json",
  ): Promise<{ jobId: string; job: BatchV2Job }> {
    const response = await this.httpClient.post("/batch-v2/start", {
      folderPath,
      outputFolderPath,
      prefixPrompt,
      wanVersion,
    });
    return { jobId: response.data.jobId, job: response.data.job };
  }

  async pauseBatch(jobId: string): Promise<void> {
    await this.httpClient.post(`/batch-v2/${jobId}/pause`);
  }

  async resumeBatch(jobId: string): Promise<void> {
    await this.httpClient.post(`/batch-v2/${jobId}/resume`);
  }

  async stopBatch(jobId: string): Promise<void> {
    await this.httpClient.post(`/batch-v2/${jobId}/stop`);
  }

  async getBatchStatus(jobId: string): Promise<BatchV2Job> {
    const response = await this.httpClient.get(`/batch-v2/${jobId}/status`);
    return response.data.job;
  }

  async getAllJobs(): Promise<BatchV2Job[]> {
    const response = await this.httpClient.get("/batch-v2/jobs");
    return response.data.jobs;
  }
}

export const batchV2Client = new BatchV2Client();
