import axios from "axios";
import { createWriteStream } from "fs";
import { readFile } from "fs/promises";
import { extname } from "path";
import { pipeline } from "stream/promises";

const API_BASE = process.env.MULEROUTER_API_BASE || "https://api.mulerouter.ai";

export type WanVersion = "2.7" | "2.2";

function createPath(version: WanVersion): string {
  return version === "2.2"
    ? "/vendors/carrothub/v1/wan2.2-i2v-spicy/generation"
    : "/vendors/carrothub/v1/wan2.7-i2v-spicy/generation";
}

function getApiKey(): string {
  const key = process.env.MULEROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error("MULEROUTER_API_KEY is not configured");
  }
  return key;
}

function getResolution(version: WanVersion): string {
  if (version === "2.2") {
    const raw = (process.env.WAN22_RESOLUTION || "480p").trim();
    return raw === "720p" ? "720p" : "480p";
  }
  const raw = (process.env.WAN27_RESOLUTION || "1080p").trim();
  return raw === "720p" ? "720p" : "1080p";
}

function getDuration(version: WanVersion): number {
  if (version === "2.2") {
    const n = Number(process.env.WAN22_DURATION ?? 5);
    // WAN 2.2 only supports 5 or 8 seconds.
    return n === 8 ? 8 : 5;
  }
  const n = Number(process.env.WAN27_DURATION ?? 5);
  if (!Number.isFinite(n)) return 5;
  return Math.min(15, Math.max(2, Math.floor(n)));
}

function getPromptExtend(version: WanVersion): boolean {
  const envVar = version === "2.2" ? process.env.WAN22_PROMPT_EXTEND : process.env.WAN27_PROMPT_EXTEND;
  const raw = (envVar ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

function getPollIntervalMs(): number {
  const n = Number(process.env.WAN27_POLL_INTERVAL_MS ?? 5000);
  return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 5000;
}

function getPollMaxAttempts(): number {
  const n = Number(process.env.WAN27_POLL_MAX_ATTEMPTS ?? 180);
  return Number.isFinite(n) && n >= 30 ? Math.floor(n) : 180;
}

function mimeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

export async function readImageAsDataUri(imagePath: string): Promise<string> {
  const buffer = await readFile(imagePath);
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error(`Image exceeds 20MB limit: ${imagePath}`);
  }
  const mime = mimeFromPath(imagePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export interface WanCreateTaskParams {
  version: WanVersion;
  prompt: string;
  imageDataUri: string;
  negativePrompt?: string;
  seed?: number;
}

function normalizeSeed(seed: number): number {
  return Math.abs(Math.floor(seed)) % 2147483648;
}

export async function createWanTask(params: WanCreateTaskParams): Promise<string> {
  const { version } = params;
  const body: Record<string, unknown> = {
    prompt: params.prompt,
    image: params.imageDataUri,
    resolution: getResolution(version),
    duration: getDuration(version),
    prompt_extend: getPromptExtend(version),
  };
  // WAN 2.2 interpolates first→last frame; reuse the start image as last_image.
  if (version === "2.2") {
    body.last_image = params.imageDataUri;
  }
  // WAN 2.2 schema is additionalProperties:false and has no negative_prompt.
  if (version !== "2.2" && params.negativePrompt?.trim()) {
    body.negative_prompt = params.negativePrompt.trim();
  }
  if (params.seed !== undefined) {
    body.seed = normalizeSeed(params.seed);
  }

  const response = await axios.post(`${API_BASE}${createPath(version)}`, body, {
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    timeout: 120000,
    validateStatus: (s) => s === 202 || (s >= 200 && s < 300),
  });

  const taskId = response.data?.task_info?.id;
  if (!taskId || typeof taskId !== "string") {
    throw new Error("MuleRouter did not return task_info.id");
  }
  return taskId;
}

export interface WanPollResult {
  videoUrl: string;
}

export async function pollWanTask(
  version: WanVersion,
  taskId: string,
  onStatus?: (status: string, attempt: number) => void,
): Promise<WanPollResult> {
  const pollUrl = `${API_BASE}${createPath(version)}/${taskId}`;
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

      const status = response.data?.task_info?.status as string | undefined;
      onStatus?.(status || "unknown", attempt);

      if (status === "completed") {
        const videos = response.data?.videos as string[] | undefined;
        const videoUrl = videos?.[0];
        if (!videoUrl) {
          throw new Error("Task completed but no video URL in response");
        }
        return { videoUrl };
      }

      if (status === "failed") {
        const err = response.data?.task_info?.error;
        const detail =
          err?.detail || err?.title || JSON.stringify(err) || `WAN ${version} generation failed`;
        throw new Error(String(detail));
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

  throw new Error(`WAN ${version} task timed out after ${maxAttempts} poll attempts`);
}

export async function downloadVideoToFile(videoUrl: string, destPath: string): Promise<void> {
  const response = await axios.get(videoUrl, {
    responseType: "stream",
    timeout: 300000,
  });
  await pipeline(response.data, createWriteStream(destPath));
}

export async function generateWanI2VToFile(params: {
  version: WanVersion;
  prompt: string;
  imagePath: string;
  outputPath: string;
  negativePrompt?: string;
  onLog?: (message: string) => void;
  onPoll?: (status: string, attempt: number) => void;
}): Promise<void> {
  const imageDataUri = await readImageAsDataUri(params.imagePath);
  let taskId: string | undefined;
  let retries = 0;
  const maxRetries = 3;

  while (retries < maxRetries) {
    try {
      taskId = await createWanTask({
        version: params.version,
        prompt: params.prompt,
        imageDataUri,
        negativePrompt: params.negativePrompt,
      });
      params.onLog?.(`Task created: ${taskId}`);
      break;
    } catch (error: unknown) {
      retries++;
      const msg = error instanceof Error ? error.message : String(error);
      const retryable =
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("504") ||
        msg.includes("timeout") ||
        msg.includes("ECONNRESET");

      if (retryable && retries < maxRetries) {
        const waitTime = Math.min(2000 * Math.pow(2, retries - 1), 10000);
        params.onLog?.(
          `⚠️ Create task failed (${msg}), retry in ${waitTime / 1000}s (${retries}/${maxRetries})`,
        );
        await sleep(waitTime);
      } else {
        throw error;
      }
    }
  }

  if (!taskId) throw new Error(`Failed to create WAN ${params.version} task`);

  const { videoUrl } = await pollWanTask(params.version, taskId, params.onPoll);
  await downloadVideoToFile(videoUrl, params.outputPath);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
