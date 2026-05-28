import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { join, resolve, relative, isAbsolute } from "path";

/** Subfolders under each spot (CRAWL_TO_AUTO_COMFY_FLOW.md) */
export const SPOT_SUBFOLDERS = [
  "감정별 이미지",
  "성인용 영상",
  "성인용 이미지",
  "일반 영상",
] as const;

export const BANNER_FOLDER = "배너";

/**
 * Project root: Google Drive for desktop mount or local workspace.
 * Fallback for dev when unset.
 */
export function getProjectDriveRoot(): string {
  const raw = process.env.PROJECT_DRIVE_ROOT?.trim();
  if (raw) return resolve(raw);
  return resolve(process.cwd(), "workspace");
}

/** Sanitize a single path segment (folder name), not full path */
export function sanitizeSegment(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim()
    .replace(/^\.+$/, "_")
    || "_";
}

export function characterRoot(character: string): string {
  return join(getProjectDriveRoot(), sanitizeSegment(character));
}

export function spotPath(character: string, spot: string): string {
  return join(characterRoot(character), sanitizeSegment(spot));
}

export function bannerPath(character: string): string {
  return join(characterRoot(character), BANNER_FOLDER);
}

export function spotSubfolder(
  character: string,
  spot: string,
  sub: (typeof SPOT_SUBFOLDERS)[number],
): string {
  return join(spotPath(character, spot), sub);
}

export interface ResolvedPaths {
  root: string;
  character: string;
  spot: string;
  spotPath: string;
  bannerPath: string;
  imageAdult: string;
  videoAdult: string;
  emotionImages: string;
  generalVideo: string;
}

export function resolveWorkspacePaths(
  character: string,
  spot: string,
): ResolvedPaths {
  const c = sanitizeSegment(character);
  const s = sanitizeSegment(spot);
  const root = getProjectDriveRoot();
  const charRoot = join(root, c);
  const sp = join(charRoot, s);
  return {
    root,
    character: c,
    spot: s,
    spotPath: sp,
    bannerPath: join(charRoot, BANNER_FOLDER),
    imageAdult: join(sp, "성인용 이미지"),
    videoAdult: join(sp, "성인용 영상"),
    emotionImages: join(sp, "감정별 이미지"),
    generalVideo: join(sp, "일반 영상"),
  };
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create character/배너 and each spot with standard subfolders.
 */
export async function createFolderStructure(
  character: string,
  spots: string[],
): Promise<{ created: string[] }> {
  const c = sanitizeSegment(character);
  if (!c || c === "_") {
    throw new Error("Invalid character name");
  }
  const list = spots.map((s) => sanitizeSegment(s)).filter((s) => s && s !== "_");
  if (list.length === 0) {
    throw new Error("At least one spot name is required");
  }

  const created: string[] = [];
  const charRoot = join(getProjectDriveRoot(), c);

  await mkdir(join(charRoot, BANNER_FOLDER), { recursive: true });
  created.push(join(charRoot, BANNER_FOLDER));

  for (const spotName of list) {
    const sp = join(charRoot, spotName);
    for (const sub of SPOT_SUBFOLDERS) {
      const p = join(sp, sub);
      await mkdir(p, { recursive: true });
      created.push(p);
    }
  }

  // Also create empty presets for each spot, if missing.
  // Presets are stored under backend/presets (same convention as presets routes).
  const presetsDir = join(process.cwd(), "..", "backend", "presets");
  await mkdir(presetsDir, { recursive: true });
  const sanitizePresetFilename = (name: string): string =>
    String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();

  for (const spotName of list) {
    const presetName = `${c} ${spotName}`.trim();
    const fileName = `${sanitizePresetFilename(presetName)}.json`;
    const filePath = join(presetsDir, fileName);
    try {
      await readFile(filePath, "utf-8");
      // exists — do not overwrite
      continue;
    } catch {
      // missing — create new
    }

    const now = new Date().toISOString();
    const preset = {
      name: presetName,
      createdAt: now,
      updatedAt: now,
    };
    await writeFile(filePath, JSON.stringify(preset, null, 2), "utf-8");
  }

  return { created };
}

/** List direct child directory names under project root (characters) */
export async function listCharacters(): Promise<string[]> {
  const root = getProjectDriveRoot();
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    names.push(e.name);
  }
  return names.sort();
}

/** List spot folders under a character (direct children, excluding 배너) */
export async function listSpots(character: string): Promise<string[]> {
  const charRoot = characterRoot(character);
  if (!(await pathExists(charRoot))) return [];
  const entries = await readdir(charRoot, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === BANNER_FOLDER) continue;
    names.push(e.name);
  }
  return names.sort();
}

/** Verify spot folder exists under character */
export async function validateWorkspace(
  character: string,
  spot: string,
): Promise<{ ok: boolean; paths?: ResolvedPaths; error?: string }> {
  const paths = resolveWorkspacePaths(character, spot);
  const sp = paths.spotPath;
  if (!(await pathExists(sp))) {
    return {
      ok: false,
      error: `Spot folder does not exist: ${sp}`,
    };
  }
  return { ok: true, paths };
}
