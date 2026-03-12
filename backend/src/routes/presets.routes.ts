import { Router, Request, Response } from "express";
import { readdir, readFile, writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { asyncHandler } from "../middleware/errorHandler.js";

const presetsRouter = Router();
const PRESETS_DIR = join(process.cwd(), "..", "backend", "presets");

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

async function ensureDir() {
  await mkdir(PRESETS_DIR, { recursive: true });
}

/**
 * GET /api/presets — list all preset names + metadata
 */
presetsRouter.get(
  "/",
  asyncHandler(async (_req: Request, res: Response) => {
    await ensureDir();
    const files = await readdir(PRESETS_DIR);
    const presets: Array<{ name: string; createdAt?: string; updatedAt?: string }> = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(PRESETS_DIR, file), "utf-8");
        const data = JSON.parse(raw);
        presets.push({
          name: data.name ?? file.replace(".json", ""),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      } catch {
        continue;
      }
    }

    res.json({ success: true, presets });
  })
);

/**
 * GET /api/presets/:name — get full preset data
 */
presetsRouter.get(
  "/:name",
  asyncHandler(async (req: Request, res: Response) => {
    const filename = sanitizeFilename(req.params.name) + ".json";
    const filePath = join(PRESETS_DIR, filename);
    try {
      const raw = await readFile(filePath, "utf-8");
      res.json({ success: true, preset: JSON.parse(raw) });
    } catch {
      return res.status(404).json({ success: false, error: "Preset not found" });
    }
  })
);

/**
 * POST /api/presets — create new preset
 */
presetsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const preset = req.body;
    if (!preset?.name || typeof preset.name !== "string") {
      return res.status(400).json({ success: false, error: "name is required" });
    }

    await ensureDir();
    const now = new Date().toISOString();
    preset.createdAt = now;
    preset.updatedAt = now;

    const filename = sanitizeFilename(preset.name) + ".json";
    await writeFile(join(PRESETS_DIR, filename), JSON.stringify(preset, null, 2), "utf-8");
    res.json({ success: true, preset });
  })
);

/**
 * PUT /api/presets/:name — update existing preset
 */
presetsRouter.put(
  "/:name",
  asyncHandler(async (req: Request, res: Response) => {
    const filename = sanitizeFilename(req.params.name) + ".json";
    const filePath = join(PRESETS_DIR, filename);

    try {
      await readFile(filePath);
    } catch {
      return res.status(404).json({ success: false, error: "Preset not found" });
    }

    const preset = req.body;
    preset.updatedAt = new Date().toISOString();

    const newFilename = sanitizeFilename(preset.name ?? req.params.name) + ".json";
    const newPath = join(PRESETS_DIR, newFilename);

    if (newFilename !== filename) {
      try { await unlink(filePath); } catch { /* ignore */ }
    }

    await writeFile(newPath, JSON.stringify(preset, null, 2), "utf-8");
    res.json({ success: true, preset });
  })
);

/**
 * DELETE /api/presets/:name
 */
presetsRouter.delete(
  "/:name",
  asyncHandler(async (req: Request, res: Response) => {
    const filename = sanitizeFilename(req.params.name) + ".json";
    const filePath = join(PRESETS_DIR, filename);
    try {
      await unlink(filePath);
      res.json({ success: true });
    } catch {
      return res.status(404).json({ success: false, error: "Preset not found" });
    }
  })
);

export default presetsRouter;
