const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3002";

export interface BannerConfig {
  pose: Record<string, string>;
  gesture: Record<string, string>;
}

export interface BannerBatchJobStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  totalTasks: number;
  completedTasks: number;
  currentTask: string;
  logs: string[];
  createdAt: string;
  error?: string;
}

export interface BannerBatchQueueState {
  queue: string[];
  currentJobId: string | null;
  currentJobIds?: string[];
  jobs: BannerBatchJobStatus[];
}

class BannerBatchClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async getConfig(): Promise<BannerConfig> {
    const res = await fetch(`${this.baseUrl}/api/banner-batch/config`);
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get banner config");
    return json.data;
  }

  async startBatch(params: {
    instanceId: string;
    loras: Array<{
      enabled: boolean;
      loraName: string;
      strengthModel: number;
      strengthClip: number;
    }>;
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
    batchSize: number;
    /** Runs per combination (default 3). */
    runsPerCombo?: number;
    outputPath: string;
  }): Promise<{ jobId: string; job: BannerBatchJobStatus }> {
    const res = await fetch(`${this.baseUrl}/api/banner-batch/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed to start batch");
    return json.data;
  }

  async getQueue(): Promise<BannerBatchQueueState> {
    const res = await fetch(`${this.baseUrl}/api/banner-batch/queue`);
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get queue");
    return json.data;
  }

  async getStatus(jobId: string): Promise<BannerBatchJobStatus> {
    const res = await fetch(
      `${this.baseUrl}/api/banner-batch/${jobId}/status`,
    );
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get status");
    return json.data;
  }

  async stopBatch(jobId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/banner-batch/${jobId}/stop`,
      { method: "POST" },
    );
    const json = await res.json();
    if (!json.success) throw new Error("Failed to stop batch");
  }
}

export const bannerBatchClient = new BannerBatchClient();
