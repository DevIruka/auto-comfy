const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3002";

export interface PoseInfo {
  name: string;
  expressions: string[];
}

export interface ImageBatchJobStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  totalTasks: number;
  completedTasks: number;
  currentPose: string;
  currentSeedIndex: number;
  logs: string[];
  createdAt: string;
  error?: string;
}

export interface ImageBatchQueueState {
  queue: string[];
  currentJobId: string | null;
  jobs: ImageBatchJobStatus[];
}

class ImageBatchClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async getPoses(): Promise<PoseInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/image-batch/poses`);
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get poses");
    return json.poses;
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
    handFixPositive: string;
    handFixNegative: string;
    poses: Array<{
      poseName: string;
      expression: string;
      handFix: boolean;
    }>;
    batchSize: number;
    outputPath: string;
  }): Promise<{ jobId: string; job: ImageBatchJobStatus }> {
    const res = await fetch(`${this.baseUrl}/api/image-batch/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed to start batch");
    return json.data;
  }

  async getQueue(): Promise<ImageBatchQueueState> {
    const res = await fetch(`${this.baseUrl}/api/image-batch/queue`);
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get queue");
    return json.data;
  }

  async getStatus(jobId: string): Promise<ImageBatchJobStatus> {
    const res = await fetch(
      `${this.baseUrl}/api/image-batch/${jobId}/status`,
    );
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get status");
    return json.data;
  }

  async stopBatch(jobId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/image-batch/${jobId}/stop`,
      { method: "POST" },
    );
    const json = await res.json();
    if (!json.success) throw new Error("Failed to stop batch");
  }
}

export const imageBatchClient = new ImageBatchClient();
