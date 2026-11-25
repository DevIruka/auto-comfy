import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

export type BatchFixedSeedCount = 1 | 2 | 3;

export interface BatchVideoSettings {
  fixedSeedCount: BatchFixedSeedCount;
  preferMinimax: boolean;
}

const DEFAULT_SETTINGS: BatchVideoSettings = {
  fixedSeedCount: 2,
  preferMinimax: true,
};

function settingsPath(): string {
  return join(process.cwd(), "data", "batch-video-settings.json");
}

function parseFixedSeedCount(value: unknown): BatchFixedSeedCount | null {
  const n = typeof value === "string" ? parseInt(value, 10) : value;
  return n === 1 || n === 2 || n === 3 ? n : null;
}

function parsePreferMinimax(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

export async function readBatchVideoSettings(): Promise<BatchVideoSettings> {
  try {
    const raw = await readFile(settingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as {
      fixedSeedCount?: unknown;
      preferMinimax?: unknown;
    };
    return {
      fixedSeedCount:
        parseFixedSeedCount(parsed.fixedSeedCount) ??
        DEFAULT_SETTINGS.fixedSeedCount,
      preferMinimax:
        parsePreferMinimax(parsed.preferMinimax) ??
        DEFAULT_SETTINGS.preferMinimax,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeBatchVideoSettings(
  patch: Partial<BatchVideoSettings>,
): Promise<BatchVideoSettings> {
  const current = await readBatchVideoSettings();
  const next: BatchVideoSettings = {
    fixedSeedCount: patch.fixedSeedCount ?? current.fixedSeedCount,
    preferMinimax: patch.preferMinimax ?? current.preferMinimax,
  };
  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}
