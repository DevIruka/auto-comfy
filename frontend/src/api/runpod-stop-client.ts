const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3002";

export interface RunPodStopJob {
  id: string;
  entryId: string;
  instanceId: string;
  podId: string;
  shutdownPc?: boolean;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  createdAt: string;
  finishedAt?: string;
  logs: string[];
}

export interface ScheduleStopResult {
  jobId: string;
  entryId: string;
  queued: "running" | "pending";
}

class RunPodStopClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async scheduleStop(
    instanceId: string,
    podId?: string,
    shutdownPc = false,
  ): Promise<ScheduleStopResult> {
    const res = await fetch(`${this.baseUrl}/api/runpod-stop/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, podId, shutdownPc }),
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || "RunPod 종료 예약 실패");
    }
    return { jobId: data.jobId, entryId: data.entryId, queued: data.queued };
  }

  async getJobs(): Promise<RunPodStopJob[]> {
    const res = await fetch(`${this.baseUrl}/api/runpod-stop/jobs`);
    const data = await res.json();
    if (!data.success) throw new Error("Failed to fetch runpod-stop jobs");
    return data.jobs ?? [];
  }
}

export const runPodStopClient = new RunPodStopClient();
