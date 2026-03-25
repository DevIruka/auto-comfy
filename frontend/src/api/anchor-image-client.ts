const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3002";

export const ANCHOR_IMAGE_LABELS = [
  "sit_neutral",
  "sit_neutral_nude",
  "stand_neutral",
  "stand_neutral_nude",
] as const;
export type AnchorImageLabel = (typeof ANCHOR_IMAGE_LABELS)[number];

export interface AnchorImageJobStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  totalTasks: number;
  completedTasks: number;
  currentTask: string;
  logs: string[];
  createdAt: string;
  error?: string;
  resultFiles?: string[];
}

export interface AnchorImageQueueState {
  queue: string[];
  currentJobId: string | null;
  currentJobIds?: string[];
  jobs: AnchorImageJobStatus[];
}

class AnchorImageClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async startJob(params: {
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
    outputPath: string;
    compositionPose: string;
    aspect: "portrait" | "landscape";
  }): Promise<{ jobId: string; job: AnchorImageJobStatus }> {
    const res = await fetch(`${this.baseUrl}/api/anchor-image/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed to start job");
    return json.data;
  }

  async getQueue(): Promise<AnchorImageQueueState> {
    const res = await fetch(`${this.baseUrl}/api/anchor-image/queue`);
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get queue");
    return json.data;
  }

  async getStatus(jobId: string): Promise<AnchorImageJobStatus> {
    const res = await fetch(
      `${this.baseUrl}/api/anchor-image/${jobId}/status`,
    );
    const json = await res.json();
    if (!json.success) throw new Error("Failed to get status");
    return json.data;
  }

  async stopJob(jobId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/anchor-image/${jobId}/stop`,
      { method: "POST" },
    );
    const json = await res.json();
    if (!json.success) throw new Error("Failed to stop job");
  }

  previewUrl(jobId: string, imageIndex: number): string {
    return `${this.baseUrl}/api/anchor-image/${jobId}/preview/${imageIndex}`;
  }

  async saveResultAs(
    jobId: string,
    imageIndex: number,
    label: AnchorImageLabel,
  ): Promise<{ savedPath: string; fileName: string }> {
    const res = await fetch(
      `${this.baseUrl}/api/anchor-image/${jobId}/save-as`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIndex, label }),
      },
    );
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Failed to save");
    return json.data;
  }
}

export const anchorImageClient = new AnchorImageClient();
