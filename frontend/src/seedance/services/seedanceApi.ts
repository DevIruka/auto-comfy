import type {
  AutomationQueueControlResult,
  AutomationRunResult,
  AutomationScanResult,
  AutomationQueuesStatus,
  GenerateRequest,
  GenerateResponse,
  IdlePromptOption,
} from "../types/app";

const API_ROOT =
  (import.meta.env.VITE_API_URL || "http://localhost:3002") + "/api/seedance";

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

async function parseJsonSafe<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

async function getJson<T>(endpoint: string): Promise<ApiResult<T>> {
  const res = await fetch(`${API_ROOT}${endpoint}`);
  const data = await parseJsonSafe<T>(res);
  return { ok: res.ok, status: res.status, data };
}

async function postJson<T>(
  endpoint: string,
  body: unknown,
): Promise<ApiResult<T>> {
  const res = await fetch(`${API_ROOT}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe<T>(res);
  return { ok: res.ok, status: res.status, data };
}

export interface SeedanceJobPayload {
  status?: string;
  error?: string;
  result?: { videos?: string[] };
}

export function fetchSeedanceJob(jobId: string) {
  return getJson<SeedanceJobPayload>(
    `/job/${encodeURIComponent(jobId)}`,
  );
}

export function fetchSeedanceQueues() {
  return getJson<AutomationQueuesStatus>("/queues");
}

export function fetchIdlePrompts() {
  return getJson<{ success?: boolean; prompts?: IdlePromptOption[]; error?: string }>(
    "/automation/idle-prompts",
  );
}

export function postSeedanceQueueControl(payload: {
  action: "pause" | "resume" | "stop";
  queue?: number;
}) {
  return postJson<AutomationQueueControlResult>("/queue-control", payload);
}

export function postAutomationRun(payload: {
  folderPairs: Array<{
    inputPath: string;
    outputPath: string;
    prompt?: string;
    endpointIndex?: number | "auto";
    videosPerClip?: number;
    idleTargetCount?: number;
    ignoreExistingOutput?: boolean;
    targetEmotions?: string[];
    targetClothing?: "all" | "clothed" | "naked";
    targetTransition?: "all" | "same" | "toneutral";
    selectedIdlePrompts?: string[];
    applyCommonToNaked?: boolean;
  }>;
  prefixPrompt: string;
  videosPerClip?: number;
  endpointIndex?: number | "auto";
  idleTargetCount?: number;
  ignoreExistingOutput?: boolean;
  targetEmotions?: string[];
  targetClothing?: "all" | "clothed" | "naked";
  targetTransition?: "all" | "same" | "toneutral";
  outputRootPath?: string;
  autoOutputByCharacter?: boolean;
  duration: number;
  aspectRatio: string;
  watermark: boolean;
}) {
  return postJson<AutomationRunResult>("/automation/run", payload);
}

export function postAutomationScan(payload: {
  inputPath: string;
  outputPath?: string;
  outputRootPath?: string;
  autoOutputByCharacter?: boolean;
  endpointIndex?: number | "auto";
  targetEmotions?: string[];
  targetClothing?: "all" | "clothed" | "naked";
  targetTransition?: "all" | "same" | "toneutral";
  ignoreExistingOutput?: boolean;
  videosPerClip?: number;
  idleTargetCount?: number;
  selectedIdlePrompts?: string[];
  applyCommonToNaked?: boolean;
}) {
  return postJson<AutomationScanResult>("/automation/scan", payload);
}

export function postSystemPickFolder() {
  return postJson<{
    success?: boolean;
    path?: string;
    cancelled?: boolean;
    error?: string;
    detail?: string;
  }>("/system/pick-folder", {});
}

export function postSystemOpenFolder(folderPath: string) {
  return postJson<{
    success?: boolean;
    path?: string;
    error?: string;
  }>("/system/open-folder", { path: folderPath });
}

export function postSaveVideo(payload: {
  videoUrl: string;
  basePath: string;
  pose: string;
  clothing: string;
  action: string;
  startEmotion: string;
  endEmotion: string;
}) {
  return postJson<{
    success?: boolean;
    error?: string;
    filePath?: string;
    fileName?: string;
    savedCount?: number;
  }>("/save-video", payload);
}

export function postSeedanceGenerate(requestData: GenerateRequest) {
  return postJson<GenerateResponse>("/generate", requestData);
}
