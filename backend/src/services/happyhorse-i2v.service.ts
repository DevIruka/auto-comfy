import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const DEFAULT_API_BASE = "https://dashscope-intl.aliyuncs.com";
const DEFAULT_MODEL = "happyhorse-1.1-i2v";

export type HappyHorseResolution = "720P" | "1080P";

export type HappyHorseStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

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

function getApiBase(): string {
  return (process.env.DASHSCOPE_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function getModel(): string {
  return (process.env.HAPPYHORSE_MODEL || DEFAULT_MODEL).trim();
}

function getApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) {
    throw new Error("DASHSCOPE_API_KEY is not configured");
  }
  return key;
}

function getPollIntervalMs(): number {
  const n = Number(process.env.HAPPYHORSE_POLL_INTERVAL_MS ?? 5000);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 5000;
}

function getPollMaxAttempts(): number {
  const n = Number(process.env.HAPPYHORSE_POLL_MAX_ATTEMPTS ?? 180);
  return Number.isFinite(n) && n >= 30 ? Math.floor(n) : 180;
}

function normalizeResolution(value: unknown): HappyHorseResolution {
  return String(value).toUpperCase() === "720P" ? "720P" : "1080P";
}

function normalizeDuration(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(15, Math.max(2, Math.floor(n)));
}

// Header that turns OFF the content filter for both input and output (Singapore region).
const DATA_INSPECTION_OFF = JSON.stringify({ input: "disable", output: "disable" });

async function createHappyHorseTask(params: {
  prompt: string;
  imageDataUri: string;
  resolution: HappyHorseResolution;
  duration: number;
  promptExtend: boolean;
  negativePrompt?: string;
}): Promise<string> {
  const input: Record<string, unknown> = {
    prompt: params.prompt || "",
    media: [{ type: "first_frame", url: params.imageDataUri }],
  };
  if (params.negativePrompt?.trim()) {
    input.negative_prompt = params.negativePrompt.trim();
  }

  const body = {
    model: getModel(),
    input,
    parameters: {
      resolution: params.resolution,
      duration: params.duration,
      prompt_extend: params.promptExtend,
      // Default is true; force off so no "Happy Horse" watermark appears.
      watermark: false,
    },
  };

  const response = await axios.post(
    `${getApiBase()}/api/v1/services/aigc/video-generation/video-synthesis`,
    body,
    {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
        "X-DashScope-DataInspection": DATA_INSPECTION_OFF,
      },
      timeout: 120000,
    },
  );

  const taskId = response.data?.output?.task_id;
  if (!taskId || typeof taskId !== "string") {
    throw new Error("DashScope did not return output.task_id");
  }
  return taskId;
}

async function pollHappyHorseTask(
  taskId: string,
  onStatus?: (status: string, attempt: number) => void,
): Promise<string> {
  const pollUrl = `${getApiBase()}/api/v1/tasks/${taskId}`;
  const intervalMs = getPollIntervalMs();
  const maxAttempts = getPollMaxAttempts();
  let consecutiveErrors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(pollUrl, {
        headers: { Authorization: `Bearer ${getApiKey()}` },
        timeout: 30000,
      });
      consecutiveErrors = 0;

      const status = response.data?.output?.task_status as string | undefined;
      onStatus?.(status || "UNKNOWN", attempt);

      if (status === "SUCCEEDED") {
        const videoUrl = response.data?.output?.video_url as string | undefined;
        if (!videoUrl) {
          throw new Error("Task succeeded but no video_url in response");
        }
        return videoUrl;
      }

      if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
        const message =
          response.data?.output?.message ||
          response.data?.output?.code ||
          `HappyHorse task ${status}`;
        throw new Error(String(message));
      }

      await sleep(intervalMs);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          throw new Error(
            `Polling failed after ${consecutiveErrors} errors: ${error.message}`,
          );
        }
        await sleep(intervalMs);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`HappyHorse task timed out after ${maxAttempts} poll attempts`);
}

class HappyHorseService {
  private jobs = new Map<string, HappyHorseJob>();

  private addLog(jobId: string, message: string) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.logs.push(`[${new Date().toISOString()}] ${message}`);
      console.log(`[HappyHorse ${jobId}] ${message}`);
    }
  }

  createJob(params: HappyHorseGenerateParams): HappyHorseJob {
    const job: HappyHorseJob = {
      id: uuidv4(),
      status: "pending",
      prompt: params.prompt || "",
      resolution: normalizeResolution(params.resolution),
      duration: normalizeDuration(params.duration),
      promptExtend: params.promptExtend !== false,
      negativePrompt: params.negativePrompt?.trim() || undefined,
      logs: [],
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(jobId: string): HappyHorseJob | undefined {
    return this.jobs.get(jobId);
  }

  /** Kick off the async create + poll flow. Does not block the caller. */
  startJob(jobId: string, imageDataUri: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    void (async () => {
      try {
        job.status = "running";
        this.addLog(jobId, `Creating task (model ${getModel()}, filter OFF)...`);
        const taskId = await createHappyHorseTask({
          prompt: job.prompt,
          imageDataUri,
          resolution: job.resolution,
          duration: job.duration,
          promptExtend: job.promptExtend,
          negativePrompt: job.negativePrompt,
        });
        job.taskId = taskId;
        this.addLog(jobId, `Task created: ${taskId}. Polling...`);

        const videoUrl = await pollHappyHorseTask(taskId, (status, attempt) => {
          if (attempt === 1 || attempt % 3 === 0) {
            this.addLog(jobId, `Status: ${status} (attempt ${attempt})`);
          }
        });

        job.videoUrl = videoUrl;
        job.status = "completed";
        job.completedAt = new Date().toISOString();
        this.addLog(jobId, "Completed.");
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        job.completedAt = new Date().toISOString();
        this.addLog(jobId, `Failed: ${job.error}`);
      }
    })();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const happyHorseService = new HappyHorseService();
