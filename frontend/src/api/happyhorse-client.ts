import axios from "axios";
import type { AxiosInstance } from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3002/api";

export type HappyHorseResolution = "720P" | "1080P";

export type HappyHorseStatus = "pending" | "running" | "completed" | "failed";

export interface HappyHorseJob {
  id: string;
  status: HappyHorseStatus;
  prompt: string;
  resolution: HappyHorseResolution;
  duration: number;
  promptExtend: boolean;
  negativePrompt?: string;
  taskId?: string;
  videoUrl?: string;
  error?: string;
  logs: string[];
  createdAt: string;
  completedAt?: string;
}

export interface HappyHorseGenerateParams {
  imageDataUri: string;
  prompt?: string;
  resolution?: HappyHorseResolution;
  duration?: number;
  promptExtend?: boolean;
  negativePrompt?: string;
}

class HappyHorseClient {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: API_BASE_URL,
      timeout: 120000,
      headers: { "Content-Type": "application/json" },
    });
  }

  async generate(
    params: HappyHorseGenerateParams,
  ): Promise<{ jobId: string; job: HappyHorseJob }> {
    const response = await this.httpClient.post("/happyhorse/generate", params);
    return { jobId: response.data.jobId, job: response.data.job };
  }

  async getStatus(jobId: string): Promise<HappyHorseJob> {
    const response = await this.httpClient.get(`/happyhorse/${jobId}/status`);
    return response.data.job;
  }
}

export const happyHorseClient = new HappyHorseClient();
