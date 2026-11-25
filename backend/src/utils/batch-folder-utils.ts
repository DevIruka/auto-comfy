import { readdir } from "fs/promises";
import { join, extname } from "path";
import { readFileSync } from "fs";

export type VideoEngine = "minimax" | "wan";
export type SkipReason = "existing" | "no_prompt" | "minimax_owned";
export type WanVersion = "2.2" | "2.7";
export type WanMode = WanVersion | "json";
export type AdultVideoRouteMode = "v1" | "v2";

export interface ImageTask {
  poseName: string;
  imagePath: string;
  imageName: string;
  outputFolder: string;
  sequenceNumber?: number;
  targetFilename?: string;
  skipped?: boolean;
  skipReason?: SkipReason;
  engine?: VideoEngine;
}

export interface PoseConfig {
  [poseName: string]: {
    prompt: string;
    negativePrompt: string;
    /** WAN version for V2 Json setting, e.g. "2.2" | "2.7". Missing → 2.2. */
    model?: string;
  };
}

/** Fixed seeds for batch processing (use first N by persisted fixedSeedCount). */
export const BATCH_FIXED_SEEDS = [625130800946143, 625130800946142, 625130800946144];

export function loadMinimaxPromptConfig(): PoseConfig {
  try {
    const configPath = join(process.cwd(), "..", "minimax prompt.json");
    const configData = readFileSync(configPath, "utf-8");
    const config = JSON.parse(configData) as PoseConfig;
    console.log("✅ Loaded minimax prompt configuration:", Object.keys(config));
    return config;
  } catch (error) {
    console.error("❌ Failed to load minimax prompt.json:", error);
    return {};
  }
}

export function getMinimaxPosePrompt(
  poseName: string,
  config: PoseConfig,
): { key: string; prompt: string } | null {
  const key = resolvePoseConfigKey(poseName, config);
  if (!key) return null;
  const prompt = (config[key]?.prompt || "").trim();
  if (!prompt) return null;
  return { key, prompt };
}

export function applyMinimaxPromptSkips(
  tasks: ImageTask[],
  config: PoseConfig,
): ImageTask[] {
  return tasks.map((task) => {
    if (task.skipped) {
      return { ...task, skipReason: task.skipReason ?? "existing" };
    }
    if (!getMinimaxPosePrompt(task.poseName, config)) {
      return { ...task, skipped: true, skipReason: "no_prompt" };
    }
    return { ...task, engine: "minimax" };
  });
}

export function resolveWanVersionFromPose(
  jobMode: WanMode,
  configKey: string,
  poseConfig: PoseConfig,
): WanVersion {
  if (jobMode === "2.2" || jobMode === "2.7") return jobMode;
  const model = poseConfig[configKey]?.model;
  return model === "2.7" || model === "2.2" ? model : "2.2";
}

export function wanLogLabel(jobMode: WanMode, version: WanVersion): string {
  return jobMode === "json" ? `WAN ${version} (json)` : `WAN ${version}`;
}

/**
 * Existing .mp4 skips stay as-is. Remaining slots get an engine (or skip)
 * based on MiniMax / pose-config ownership and preferMinimax.
 */
export function routeAdultVideoTasks(
  tasks: ImageTask[],
  options: {
    preferMinimax: boolean;
    mode: AdultVideoRouteMode;
    minimaxConfig: PoseConfig;
    poseConfig: PoseConfig;
  },
): ImageTask[] {
  return tasks.map((task) => {
    if (task.skipped) {
      return { ...task, skipReason: task.skipReason ?? "existing" };
    }

    const hasMinimax = !!getMinimaxPosePrompt(task.poseName, options.minimaxConfig);
    const hasWan = !!resolvePoseConfigKey(task.poseName, options.poseConfig);

    if (options.mode === "v1") {
      if (options.preferMinimax) {
        if (hasMinimax) return { ...task, engine: "minimax" };
        if (hasWan) return { ...task, engine: "wan" };
        return { ...task, skipped: true, skipReason: "no_prompt" };
      }
      if (hasMinimax) return { ...task, engine: "minimax" };
      return { ...task, skipped: true, skipReason: "no_prompt" };
    }

    if (options.preferMinimax && hasMinimax) {
      return { ...task, skipped: true, skipReason: "minimax_owned" };
    }
    if (hasWan) return { ...task, engine: "wan" };
    return task;
  });
}

export function sortPendingByEngine(tasks: ImageTask[]): ImageTask[] {
  const pending = tasks.filter((task) => !task.skipped);
  return [
    ...pending.filter((task) => task.engine === "minimax"),
    ...pending.filter((task) => task.engine === "wan"),
    ...pending.filter(
      (task) => task.engine !== "minimax" && task.engine !== "wan",
    ),
  ];
}

export function countRoutedTasks(tasks: ImageTask[]) {
  const pending = tasks.filter((task) => !task.skipped);
  return {
    total: tasks.length,
    pending: pending.length,
    skipped: tasks.length - pending.length,
    minimax: pending.filter((task) => task.engine === "minimax").length,
    wan: pending.filter((task) => task.engine === "wan").length,
    existing: tasks.filter((task) => task.skipReason === "existing").length,
    noPrompt: tasks.filter((task) => task.skipReason === "no_prompt").length,
    minimaxOwned: tasks.filter((task) => task.skipReason === "minimax_owned")
      .length,
  };
}

export function loadPoseConfig(): PoseConfig {
  try {
    const configPath = join(process.cwd(), "..", "pose-config.json");
    const configData = readFileSync(configPath, "utf-8");
    const config = JSON.parse(configData) as PoseConfig;
    console.log("✅ Loaded pose configuration:", Object.keys(config));
    return config;
  } catch (error) {
    console.error("❌ Failed to load pose-config.json:", error);
    return {};
  }
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export async function scanAdultVideoFolder(folderPath: string): Promise<ImageTask[]> {
  const imageTasks: ImageTask[] = [];

  const entries = await readdir(folderPath, { withFileTypes: true });
  const poseDirs = entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => compareNames(a.name, b.name));

  for (const entry of poseDirs) {
    const poseName = entry.name;
    const poseFolder = join(folderPath, poseName);
    const files = (await readdir(poseFolder)).slice().sort(compareNames);

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        imageTasks.push({
          poseName,
          imagePath: join(poseFolder, file),
          imageName: file,
          outputFolder: "",
        });
      }
    }
  }

  console.log(`✅ Scanned ${imageTasks.length} images from ${folderPath}`);
  return imageTasks;
}

/**
 * Map an input folder name to a pose-config.json key.
 * Exact match first, then strip trailing digits (Cowgirl2 → Cowgirl).
 * Prefix matching is intentionally not used (Cum would steal CumInMouth).
 */
export function resolvePoseConfigKey(
  folderName: string,
  config: PoseConfig,
): string | null {
  if (config[folderName]) return folderName;
  const stripped = folderName.match(/^(.+?)(\d+)$/);
  if (stripped && config[stripped[1]]) return stripped[1];
  return null;
}

const POSE_OUTPUT_ALIASES: Record<string, string> = {
  SingleFootjob: "Footjob",
  DoubleFootjob: "Footjob",
  PaizuriNoTongue: "Paizuri",
};

/** V2: Oral → folder Oral variant 0; Oral2 → folder Oral variant 2. */
export function parsePoseOutputNaming(poseName: string): {
  folder: string;
  variant: number;
} {
  const aliased = POSE_OUTPUT_ALIASES[poseName] || poseName;
  const stripped = aliased.match(/^(.+?)(\d+)$/);
  if (stripped) {
    return { folder: stripped[1], variant: Number(stripped[2]) };
  }
  return { folder: aliased, variant: 0 };
}

export function mapPoseToFolderName(poseName: string): string {
  return parsePoseOutputNaming(poseName).folder;
}

export function v2VideoNumber(variant: number, imageIndex: number): number {
  return variant * 10000 + imageIndex;
}

export function generateVideoFilename(
  poseName: string,
  sequentialNumber: number,
): string {
  return `${poseName}_${sequentialNumber.toString().padStart(5, "0")}.mp4`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse `{pose}_00001.mp4` sequence numbers (case-insensitive). */
export async function listExistingVideoNumbers(
  poseOutputFolder: string,
  poseName: string,
): Promise<Set<number>> {
  const existingFiles = await readdir(poseOutputFolder).catch(() => []);
  const pattern = new RegExp(`^${escapeRegExp(poseName)}_(\\d{5,})\\.mp4$`, "i");
  const numbers = new Set<number>();
  for (const file of existingFiles) {
    const match = file.match(pattern);
    if (!match) continue;
    numbers.add(Number(match[1]));
  }
  return numbers;
}

/**
 * Assign V2 filenames per input pose folder.
 * Oral → Oral_0000N; Oral2 → Oral_2000N. Skip only if that exact number exists.
 */
export async function planAdultVideoTasks(
  imageTasks: ImageTask[],
  outputFolderPath?: string,
): Promise<ImageTask[]> {
  const byPose = new Map<string, ImageTask[]>();
  for (const task of imageTasks) {
    const list = byPose.get(task.poseName) ?? [];
    list.push(task);
    byPose.set(task.poseName, list);
  }

  const existingByOutput = new Map<string, Set<number>>();
  const planned: ImageTask[] = [];

  for (const [poseName, tasks] of byPose) {
    const { folder, variant } = parsePoseOutputNaming(poseName);
    if (outputFolderPath && !existingByOutput.has(folder)) {
      existingByOutput.set(
        folder,
        await listExistingVideoNumbers(join(outputFolderPath, folder), folder),
      );
    }
    const existing = existingByOutput.get(folder) ?? new Set<number>();

    tasks.forEach((task, index) => {
      const sequenceNumber = v2VideoNumber(variant, index + 1);
      const targetFilename = generateVideoFilename(folder, sequenceNumber);
      planned.push({
        ...task,
        outputFolder: folder,
        sequenceNumber,
        targetFilename,
        skipped: existing.has(sequenceNumber),
        skipReason: existing.has(sequenceNumber) ? "existing" : undefined,
      });
    });
  }

  return planned;
}

export function generateRandomSeed(): number {
  return Math.floor(Math.random() * 999999999999999);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
