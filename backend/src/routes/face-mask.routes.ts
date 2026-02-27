import { Router, Request, Response } from "express";
import multer from "multer";
import { writeFile, rm, mkdir, readdir } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import { asyncHandler } from "../middleware/errorHandler.js";

const faceMaskRouter = Router();

const FACE_MASK_DIR = join(process.cwd(), "..", "facemask");
const INPUT_DIR = join(FACE_MASK_DIR, "input");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);

let processingLock = false;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image files are allowed"));
      return;
    }
    cb(null, true);
  },
});

function safeBasename(original: string): string {
  const name = original.replace(/^.*[/\\]/, "");
  const base = name.replace(/\.[^.]+$/i, "").replace(/[^\w.\-]/g, "_") || "image";
  const ext = name.match(/\.[^.]+$/i)?.[0] ?? ".png";
  return base + (IMAGE_EXT.has(ext.toLowerCase()) ? ext : ".png");
}

/**
 * POST /api/tools/face-mask
 * Body: multipart form, field "images" = multiple image files (or "image" for single)
 * Query: soft=true for soft mask
 * Script reads input/ and writes to output/. Returns JSON with count.
 */
faceMaskRouter.post(
  "/",
  upload.fields([
    { name: "images", maxCount: 200 },
    { name: "image", maxCount: 1 },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files as { images?: Express.Multer.File[]; image?: Express.Multer.File[] }) ?? {};
    const list = files.images?.length ? files.images : files.image ? [files.image[0]] : [];

    if (!list.length) {
      res.status(400).json({ error: "No image files provided" });
      return;
    }

    if (processingLock) {
      res.status(503).json({
        error: "Another face-mask job is in progress. Please try again shortly.",
      });
      return;
    }

    processingLock = true;
    try {
      await mkdir(INPUT_DIR, { recursive: true });
      const existing = await readdir(INPUT_DIR).catch(() => []);
      for (const name of existing) {
        await rm(join(INPUT_DIR, name), { force: true });
      }

      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const base = safeBasename(f.originalname).slice(0, 220);
        const name = list.length > 1 ? `${String(i).padStart(4, "0")}_${base}` : base;
        await writeFile(join(INPUT_DIR, name), f.buffer);
      }

      const soft = req.query.soft === "true" || req.query.soft === "1";
      const args = ["face_mask.py"];
      if (soft) args.push("--soft");

      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn("python", args, {
          cwd: FACE_MASK_DIR,
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stderr?.on("data", () => {});
        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", reject);
      });

      if (exitCode !== 0) {
        res.status(500).json({
          error: "Face mask script failed",
          details: "Check server logs. Ensure Python and facemask dependencies are installed.",
        });
        return;
      }

      res.json({
        success: true,
        count: list.length,
        message: `${list.length}장 처리 완료. 결과는 facemask/output 폴더에 저장되었습니다.`,
      });
    } finally {
      processingLock = false;
    }
  })
);

export default faceMaskRouter;
