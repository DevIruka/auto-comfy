import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

export type BatchFixedSeedCount = 2 | 3;

const DEFAULT_FIXED_SEED_COUNT: BatchFixedSeedCount = 2;

function settingsPath(): string {
  return join(process.cwd(), "data", "batch-video-settings.json");
}

export async function readBatchVideoSettings(): Promise<{
  fixedSeedCount: BatchFixedSeedCount;
}> {
  try {
    const raw = await readFile(settingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as { fixedSeedCount?: unknown };
    const n = parsed.fixedSeedCount;
    if (n === 2 || n === 3) {
      return { fixedSeedCount: n };
    }
  } catch {
    // missing or invalid
  }
  return { fixedSeedCount: DEFAULT_FIXED_SEED_COUNT };
}

export async function writeBatchVideoSettings(
  fixedSeedCount: BatchFixedSeedCount,
): Promise<{ fixedSeedCount: BatchFixedSeedCount }> {
  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const payload = { fixedSeedCount };
  await writeFile(
    settingsPath(),
    JSON.stringify(payload, null, 2),
    "utf-8",
  );
  return payload;
}
