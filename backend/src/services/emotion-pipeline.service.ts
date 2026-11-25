import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from "fs/promises";
import { join, basename, extname } from "path";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { createSdxlWaiWorkflow, createSdxlWaiHiresWorkflow, HIRES_SAVE_NODE_ID, type SdxlWaiPromptBlocks, type SdxlWaiLoraSlot } from "../utils/workflow-helpers.js";
import { comfyManager } from "./comfy-manager.service.js";
import { instanceQueueManager } from "./instance-queue-manager.service.js";

export type { SdxlWaiPromptBlocks, SdxlWaiLoraSlot };

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const EMOTIONS = ["Happy", "Aroused", "Sad", "Angry"] as const;
const SAVE_NODE_ID = "1044";

export interface EmotionConfig {
  Happy: string;
  Aroused: string;
  Sad: string;
  Angry: string;
}

export interface EmotionPipelineParams {
  folderPath: string;
  comfyInstanceId: string;
  promptBlocks: SdxlWaiPromptBlocks;
  loraSlots?: SdxlWaiLoraSlot[];
  upscaleSeedCount: number;
  /** Use subfolder "원본" if present */
  useOriginSubfolder?: boolean;
}

export interface EmotionPipelineJob {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  totalSteps: number;
  currentStep: number;
  logs: string[];
  error?: string;
  createdAt?: string;
}

const jobs = new Map<string, EmotionPipelineJob>();
const jobParams = new Map<string, EmotionPipelineParams>();
const stopRequested = new Map<string, boolean>();

/** Global lock: only one masking run at a time so facemask/input+output are not overwritten; next job waits until current masking finishes. */
let maskingLockPromise: Promise<void> = Promise.resolve();

/**
 * Run face mask with global lock. Queued jobs wait for the previous job's masking to finish before starting their own.
 */
async function runFaceMaskWithLock(
  imagePaths: string[],
  faceMaskDir: string,
  jobId: string,
  maskedOutputDir: string
): Promise<{ inputPath: string; outputPath: string }[]> {
  const prev = maskingLockPromise;
  let release: () => void;
  maskingLockPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await runFaceMask(imagePaths, faceMaskDir, jobId, maskedOutputDir);
  } finally {
    release!();
  }
}

function addLog(jobId: string, message: string) {
  const job = jobs.get(jobId);
  if (job) {
    job.logs.push(`[${new Date().toISOString()}] ${message}`);
    console.log(`[EmotionPipeline ${jobId}] ${message}`);
  }
}

function setStep(jobId: string, current: number, total: number) {
  const job = jobs.get(jobId);
  if (job) {
    job.currentStep = current;
    job.totalSteps = total;
  }
}


/**
 * Load emotion prompts from img-emotion-config.json (project root or cwd)
 */
async function loadEmotionConfig(): Promise<EmotionConfig> {
  const paths = [
    join(process.cwd(), "..", "img-emotion-config.json"),
    join(process.cwd(), "img-emotion-config.json"),
  ];
  for (const p of paths) {
    try {
      const raw = await readFile(p, "utf-8");
      return JSON.parse(raw) as EmotionConfig;
    } catch {
      continue;
    }
  }
  throw new Error("img-emotion-config.json not found (checked project root and backend cwd)");
}

/**
 * Resolve directory to scan (same logic as image listing).
 */
async function resolveScanDir(
  folderPath: string,
  useOriginSubfolder: boolean
): Promise<string> {
  let dir = folderPath;
  if (useOriginSubfolder) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const origin = entries.find((e) => e.isDirectory() && e.name === "원본");
      if (origin) {
        const originDir = join(dir, "원본");
        // Only use "원본" when it actually contains images; otherwise fall back to the job folder.
        try {
          const originEntries = await readdir(originDir, { withFileTypes: true });
          const hasImages = originEntries.some((e) => {
            if (!e.isFile()) return false;
            const ext = extname(e.name).toLowerCase();
            return IMAGE_EXT.has(ext);
          });
          if (hasImages) dir = originDir;
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  return dir;
}

/**
 * Scan folder for image paths. If useOriginSubfolder, scan the "원본" subfolder when present.
 * Includes all image files in the target directory.
 */
async function scanImagePaths(
  folderPath: string,
  useOriginSubfolder: boolean
): Promise<{ scanDir: string; imagePaths: string[] }> {
  const scanDir = await resolveScanDir(folderPath, useOriginSubfolder);
  const entries = await readdir(scanDir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    if (IMAGE_EXT.has(ext)) files.push(join(scanDir, e.name));
  }
  return { scanDir, imagePaths: files.sort() };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** List image files in a directory (non-recursive). */
async function listImagesInDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    if (IMAGE_EXT.has(ext)) files.push(join(dir, e.name));
  }
  return files.sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function missingIndices(existing: Set<number>, count: number): number[] {
  const missing: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!existing.has(i)) missing.push(i);
  }
  return missing;
}

/** Parse `{base}_{emotion}_{n}.ext` indices (case-insensitive). */
export async function listExistingEmotionIndices(
  emotionDir: string,
  emotion: string,
  baseName: string,
): Promise<Set<number>> {
  const files = await readdir(emotionDir).catch(() => []);
  const pattern = new RegExp(
    `^${escapeRegExp(baseName)}_${escapeRegExp(emotion)}_(\\d+)\\.(?:png|jpg|jpeg|webp|bmp)$`,
    "i",
  );
  const numbers = new Set<number>();
  for (const file of files) {
    const match = file.match(pattern);
    if (match) numbers.add(Number(match[1]));
  }
  return numbers;
}

export interface EmotionSlotPlan {
  imagePath: string;
  baseName: string;
  needNeutral: boolean;
  missingByEmotion: Record<(typeof EMOTIONS)[number], number[]>;
  pending: number;
  skipped: number;
}

export interface EmotionPipelineScanResult {
  images: number;
  pending: number;
  skipped: number;
  sources: Array<{
    baseName: string;
    pending: number;
    skipped: number;
    needNeutral: boolean;
    missingByEmotion: Record<string, number[]>;
  }>;
}

export async function buildEmotionSlotPlans(
  folderPath: string,
  useOriginSubfolder: boolean,
  upscaleSeedCount: number,
): Promise<{
  scanDir: string;
  imagePaths: string[];
  emotionsFolder: string;
  totalSeeds: number;
  plans: EmotionSlotPlan[];
  pending: number;
  skipped: number;
}> {
  const totalSeeds = Math.max(3, Math.floor(upscaleSeedCount));
  const { scanDir, imagePaths } = await scanImagePaths(folderPath, useOriginSubfolder);
  const emotionsFolder = join(folderPath, "Emotions");
  const plans: EmotionSlotPlan[] = [];

  for (const imagePath of imagePaths) {
    const baseName = basename(imagePath, extname(imagePath));
    const existingNeutral = await listExistingEmotionIndices(
      join(emotionsFolder, "Neutral"),
      "Neutral",
      baseName,
    );
    const needNeutral = !existingNeutral.has(0);
    let pending = needNeutral ? 1 : 0;
    let skipped = needNeutral ? 0 : 1;
    const missingByEmotion = {} as EmotionSlotPlan["missingByEmotion"];

    for (const emotion of EMOTIONS) {
      const existing = await listExistingEmotionIndices(
        join(emotionsFolder, emotion),
        emotion,
        baseName,
      );
      const missing = missingIndices(existing, totalSeeds);
      missingByEmotion[emotion] = missing;
      pending += missing.length;
      skipped += totalSeeds - missing.length;
    }

    plans.push({
      imagePath,
      baseName,
      needNeutral,
      missingByEmotion,
      pending,
      skipped,
    });
  }

  return {
    scanDir,
    imagePaths,
    emotionsFolder,
    totalSeeds,
    plans,
    pending: plans.reduce((sum, p) => sum + p.pending, 0),
    skipped: plans.reduce((sum, p) => sum + p.skipped, 0),
  };
}

export async function scanEmotionPipeline(params: {
  folderPath: string;
  upscaleSeedCount?: number;
  useOriginSubfolder?: boolean;
}): Promise<EmotionPipelineScanResult> {
  const built = await buildEmotionSlotPlans(
    params.folderPath,
    params.useOriginSubfolder !== false,
    typeof params.upscaleSeedCount === "number" ? params.upscaleSeedCount : 3,
  );
  return {
    images: built.imagePaths.length,
    pending: built.pending,
    skipped: built.skipped,
    sources: built.plans.map((p) => ({
      baseName: p.baseName,
      pending: p.pending,
      skipped: p.skipped,
      needNeutral: p.needNeutral,
      missingByEmotion: p.missingByEmotion,
    })),
  };
}

function findMaskedForOriginal(
  imagePath: string,
  allImagePaths: string[],
  maskedFiles: string[],
): string | null {
  const byName = new Map(maskedFiles.map((p) => [basename(p).toLowerCase(), p]));
  const stem = basename(imagePath, extname(imagePath));
  const names = [`${stem}.png`, `${stem}_fail.png`];
  const idx = allImagePaths.indexOf(imagePath);
  if (idx >= 0 && allImagePaths.length > 1) {
    const prefixed = `${String(idx).padStart(4, "0")}_${stem}`;
    names.push(`${prefixed}.png`, `${prefixed}_fail.png`);
  }
  for (const name of names) {
    const found = byName.get(name.toLowerCase());
    if (found) return found;
  }
  return null;
}

/**
 * Prefer masked next to scanned images, then job-root masked (legacy layout).
 */
async function findExistingMaskedDir(
  scanDir: string,
  folderPath: string
): Promise<string | null> {
  const candidates = [join(scanDir, "masked"), join(folderPath, "masked")];
  for (const p of candidates) {
    if (!(await isDirectory(p))) continue;
    const imgs = await listImagesInDir(p);
    if (imgs.length > 0) return p;
  }
  return null;
}

/**
 * Pair originals with masked PNGs using the same basename rules as runFaceMask output.
 */
function pairOriginalsWithExistingMasked(
  imagePaths: string[],
  maskedPaths: string[]
): { inputPath: string; outputPath: string }[] {
  const byName = new Map<string, string>();
  for (const m of maskedPaths) {
    byName.set(basename(m).toLowerCase(), m);
  }

  const n = imagePaths.length;
  const pairs: { inputPath: string; outputPath: string }[] = [];

  for (let i = 0; i < n; i++) {
    const src = imagePaths[i];
    const stem = basename(src, extname(src));
    const base =
      n > 1
        ? `${String(i).padStart(4, "0")}_${stem}`
        : stem;
    const outName = `${base}.png`;
    const failName = `${base}_fail.png`;
    const maskedPath =
      byName.get(outName.toLowerCase()) ?? byName.get(failName.toLowerCase());
    if (!maskedPath) {
      throw new Error(
        `Existing masked folder: no file matching "${outName}" or "${failName}" for original "${basename(src)}"`
      );
    }
    pairs.push({ inputPath: src, outputPath: maskedPath });
  }

  return pairs;
}

/**
 * Run face mask: copy imagePaths to facemask/input, run face_mask.py, then copy results to maskedOutputDir
 * so masked images are stored under the user's folder and not overwritten by the next job.
 */
async function runFaceMask(
  imagePaths: string[],
  faceMaskDir: string,
  jobId: string,
  maskedOutputDir: string
): Promise<{ inputPath: string; outputPath: string }[]> {
  const inputDir = join(faceMaskDir, "input");
  const outputDir = join(faceMaskDir, "output");
  await mkdir(inputDir, { recursive: true });
  await mkdir(maskedOutputDir, { recursive: true });

  const existing = await readdir(inputDir).catch(() => []);
  for (const name of existing) {
    await rm(join(inputDir, name), { force: true });
  }

  for (let i = 0; i < imagePaths.length; i++) {
    const src = imagePaths[i];
    const name = imagePaths.length > 1 ? `${String(i).padStart(4, "0")}_${basename(src)}` : basename(src);
    await cp(src, join(inputDir, name));
  }

  addLog(jobId, `Running face mask on ${imagePaths.length} images...`);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("python", ["face_mask.py"], {
      cwd: faceMaskDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });

  if (exitCode !== 0) {
    throw new Error(`Face mask script exited with code ${exitCode}`);
  }

  const outEntries: string[] = await readdir(outputDir).catch((): string[] => []);
  const results: { inputPath: string; outputPath: string }[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const base = imagePaths.length > 1 ? `${String(i).padStart(4, "0")}_${basename(imagePaths[i], extname(imagePaths[i]))}` : basename(imagePaths[i], extname(imagePaths[i]));
    const outName = base + ".png";
    const failName = base + "_fail.png";
    const outPath = join(outputDir, outName);
    const failPath = join(outputDir, failName);
    const destPath = join(maskedOutputDir, outName);
    const destFailPath = join(maskedOutputDir, failName);
    if (outEntries.includes(outName)) {
      await cp(outPath, destPath);
      results.push({ inputPath: imagePaths[i], outputPath: destPath });
    } else if (outEntries.includes(failName)) {
      await cp(failPath, destFailPath);
      results.push({ inputPath: imagePaths[i], outputPath: destFailPath });
    }
  }
  addLog(jobId, `Face mask done: ${results.length} outputs saved to ${maskedOutputDir}`);
  return results;
}

/** Options for SDXL WAI workflow minus imageFilename (set after upload) */
interface SdxlWaiOptionsWithoutImage {
  seed: number;
  promptBlocks: SdxlWaiPromptBlocks;
  loraSlots?: SdxlWaiLoraSlot[];
  upscaleMethod?: string;
  /** Use Hires Fix workflow (FaceDetailer → Ultimate SD Upscale → Save 1046). For upscale step. */
  useHiresWorkflow?: boolean;
  /** Match 1291 image_width/image_height to uploaded image to avoid Efficient Loader vae_decode path bugs */
  imageWidth?: number;
  imageHeight?: number;
}

/** Read PNG width/height from buffer (IHDR at offset 16/20, big-endian). Returns null if not a valid PNG. */
function getPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buffer[i] !== sig[i]) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 65535 || height > 65535) return null;
  return { width, height };
}

/**
 * Upload image first, then run workflow with the returned filename only.
 * Ensures the workflow never runs with a missing or stale image reference.
 */
async function runWorkflowWithUpload(
  comfy: ReturnType<typeof comfyManager.getInstance>,
  imageBuffer: Buffer,
  filename: string,
  options: SdxlWaiOptionsWithoutImage
): Promise<{ outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }> {
  const uploadResult = await comfy.uploadImage(imageBuffer, filename, "", "input", true);
  const name = uploadResult?.name;
  if (!name) {
    throw new Error("Upload did not return image name - cannot run workflow safely");
  }
  const workflow = options.useHiresWorkflow
    ? createSdxlWaiHiresWorkflow({
        imageFilename: name,
        seed: options.seed,
        promptBlocks: options.promptBlocks,
        loraSlots: options.loraSlots,
        imageWidth: options.imageWidth,
        imageHeight: options.imageHeight,
      })
    : createSdxlWaiWorkflow({
        imageFilename: name,
        ...options,
      });
  const result = await comfy.executeWorkflow(workflow);
  return result as { outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> };
}

function getFirstImageFromOutput(
  outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>,
  saveNodeId: string = SAVE_NODE_ID
): { filename: string; subfolder: string; type: string } | null {
  const node = outputs[saveNodeId];
  if (!node?.images?.length) return null;
  return node.images[0];
}

export async function startEmotionPipeline(
  jobId: string,
  params: EmotionPipelineParams
): Promise<void> {
  const {
    folderPath,
    comfyInstanceId,
    promptBlocks: baseBlocks,
    loraSlots,
    upscaleSeedCount,
    useOriginSubfolder = true,
  } = params;

  const totalSeeds = Math.max(3, Math.floor(upscaleSeedCount));

  const job: EmotionPipelineJob = {
    jobId,
    status: "running",
    totalSteps: 0,
    currentStep: 0,
    logs: [],
  };
  jobs.set(jobId, job);
  addLog(jobId, `Starting pipeline: ${folderPath}, instance: ${comfyInstanceId}`);

  const faceMaskDir = join(process.cwd(), "..", "facemask");

  try {
    const comfy = comfyManager.getInstance(comfyInstanceId);
    const emotionConfig = await loadEmotionConfig();

    const built = await buildEmotionSlotPlans(
      folderPath,
      useOriginSubfolder,
      upscaleSeedCount
    );
    const { scanDir, imagePaths, emotionsFolder, plans } = built;
    if (imagePaths.length === 0) {
      throw new Error(
        "No images found in the job folder (or in a \"원본\" subfolder when that option is on)"
      );
    }
    addLog(
      jobId,
      `Found ${imagePaths.length} images · 생성 ${built.pending} · 스킵 ${built.skipped}`
    );

    if (built.pending === 0) {
      setStep(jobId, 0, 0);
      job.status = "completed";
      addLog(jobId, "All emotion slots already exist — nothing to generate");
      return;
    }

    await mkdir(emotionsFolder, { recursive: true });
    await mkdir(join(emotionsFolder, "Neutral"), { recursive: true });
    for (const em of EMOTIONS) {
      await mkdir(join(emotionsFolder, em), { recursive: true });
    }

    const needMaskPlans = plans.filter((p) =>
      EMOTIONS.some((em) => p.missingByEmotion[em].length > 0)
    );
    const maskedMap = new Map<string, string>();

    if (needMaskPlans.length > 0) {
      const existingMaskedDir = await findExistingMaskedDir(scanDir, folderPath);
      if (existingMaskedDir) {
        const maskedFiles = await listImagesInDir(existingMaskedDir);
        addLog(
          jobId,
          `Using existing masked folder (${existingMaskedDir}): ${maskedFiles.length} images, skipping face mask`
        );
        for (const plan of needMaskPlans) {
          const maskedPath = findMaskedForOriginal(
            plan.imagePath,
            imagePaths,
            maskedFiles
          );
          if (!maskedPath) {
            throw new Error(
              `Existing masked folder: no file matching original "${basename(plan.imagePath)}"`
            );
          }
          maskedMap.set(plan.imagePath, maskedPath);
        }
      } else {
        const toMask = needMaskPlans.map((p) => p.imagePath);
        const maskedOutputDir = join(folderPath, "masked");
        const masked = await runFaceMaskWithLock(
          toMask,
          faceMaskDir,
          jobId,
          maskedOutputDir
        );
        if (masked.length === 0) {
          throw new Error("Face mask produced no outputs");
        }
        for (const pair of masked) {
          maskedMap.set(pair.inputPath, pair.outputPath);
        }
      }
    } else {
      addLog(jobId, "No missing emotion slots — skipping face mask");
    }

    const isStopped = () => stopRequested.get(jobId) === true;
    const pendingEmotionSlots = plans.reduce(
      (sum, p) =>
        sum + EMOTIONS.reduce((s, em) => s + p.missingByEmotion[em].length, 0),
      0
    );
    const pendingNeutral = plans.filter((p) => p.needNeutral).length;
    const totalSteps = pendingNeutral + pendingEmotionSlots * 2;
    setStep(jobId, 0, totalSteps);
    let step = 0;

    for (const plan of plans) {
      if (isStopped()) break;
      const { imagePath, baseName } = plan;

      if (plan.needNeutral) {
        const originalBuffer = await readFile(imagePath);
        const seedNeutral = Math.floor(Math.random() * 1e15);
        const dimsNeutral = getPngDimensions(originalBuffer);
        addLog(jobId, `Generate Neutral/${baseName}_Neutral_0`);
        const neutralResult = await runWorkflowWithUpload(
          comfy,
          originalBuffer,
          `neutral_${baseName}_r0.png`,
          {
            seed: seedNeutral,
            promptBlocks: baseBlocks,
            loraSlots,
            useHiresWorkflow: true,
            imageWidth: dimsNeutral?.width,
            imageHeight: dimsNeutral?.height,
          }
        );
        step++;
        setStep(jobId, step, totalSteps);

        const neutralImg = getFirstImageFromOutput(
          neutralResult.outputs,
          HIRES_SAVE_NODE_ID
        );
        if (neutralImg) {
          const neutralBuf = await comfy.getImage(
            neutralImg.filename,
            neutralImg.subfolder || "",
            neutralImg.type || "output"
          );
          const neutralOutPath = join(
            emotionsFolder,
            "Neutral",
            `${baseName}_Neutral_0.png`
          );
          await writeFile(neutralOutPath, neutralBuf);
          addLog(jobId, `Saved: Neutral/${baseName}_Neutral_0.png`);
        }
      } else {
        addLog(jobId, `Skip Neutral/${baseName}_Neutral_0`);
      }

      const missingAny = EMOTIONS.some((em) => plan.missingByEmotion[em].length > 0);
      if (!missingAny) continue;

      const outputPath = maskedMap.get(imagePath);
      if (!outputPath) {
        throw new Error(`No masked image for ${baseName}`);
      }
      const maskedBuffer = await readFile(outputPath);

      for (const emotion of EMOTIONS) {
        if (isStopped()) break;
        const emotionPrompt =
          (emotionConfig as unknown as Record<string, string>)[emotion] ?? "";
        const promptBlocks: SdxlWaiPromptBlocks = {
          ...baseBlocks,
          emotion: emotionPrompt,
        };
        const missing = plan.missingByEmotion[emotion];
        for (let k = 0; k < totalSeeds; k++) {
          if (!missing.includes(k)) {
            addLog(jobId, `Skip ${emotion}/${baseName}_${emotion}_${k}`);
          }
        }

        for (const round of missing) {
          if (isStopped()) break;
          const seedInpaint = Math.floor(Math.random() * 1e15);
          const dims = getPngDimensions(maskedBuffer);
          addLog(
            jobId,
            `Generate ${emotion}/${baseName}_${emotion}_${round} (inpaint → upscale)`
          );
          const inpaintResult = await runWorkflowWithUpload(
            comfy,
            maskedBuffer,
            `emotion_${baseName}_${emotion}_r${round}.png`,
            {
              seed: seedInpaint,
              promptBlocks,
              loraSlots,
              upscaleMethod: "🚫 Do not upscale",
              imageWidth: dims?.width,
              imageHeight: dims?.height,
            }
          );
          step++;
          setStep(jobId, step, totalSteps);

          if (isStopped()) break;

          const firstImage = getFirstImageFromOutput(inpaintResult.outputs);
          if (!firstImage) {
            addLog(jobId, `No output from inpaint for ${emotion} ${baseName}_${round}`);
            step++;
            setStep(jobId, step, totalSteps);
            continue;
          }

          const inpaintBuffer = await comfy.getImage(
            firstImage.filename,
            firstImage.subfolder || "",
            firstImage.type || "output"
          );
          const dimsUpscale = getPngDimensions(inpaintBuffer);
          const seedUpscale = Math.floor(Math.random() * 1e15);
          const upscaleResult = await runWorkflowWithUpload(
            comfy,
            inpaintBuffer,
            `upscale_${baseName}_${emotion}_r${round}.png`,
            {
              seed: seedUpscale,
              promptBlocks,
              loraSlots,
              useHiresWorkflow: true,
              imageWidth: dimsUpscale?.width,
              imageHeight: dimsUpscale?.height,
            }
          );
          step++;
          setStep(jobId, step, totalSteps);

          const upImg = getFirstImageFromOutput(
            upscaleResult.outputs,
            HIRES_SAVE_NODE_ID
          );
          if (upImg) {
            const upBuf = await comfy.getImage(
              upImg.filename,
              upImg.subfolder || "",
              upImg.type || "output"
            );
            const outPath = join(
              emotionsFolder,
              emotion,
              `${baseName}_${emotion}_${round}.png`
            );
            await writeFile(outPath, upBuf);
            addLog(jobId, `Saved: ${emotion}/${baseName}_${emotion}_${round}.png`);
          }
        }
      }
    }

    if (isStopped()) {
      job.status = "stopped";
      addLog(jobId, "Pipeline stopped by user.");
    } else {
      job.status = "completed";
      addLog(jobId, "Pipeline completed.");
    }
  } catch (err: any) {
    if (stopRequested.get(jobId)) {
      job.status = "stopped";
      addLog(jobId, "Pipeline stopped by user.");
    } else {
      job.status = "failed";
      job.error = err?.message ?? String(err);
      addLog(jobId, `Failed: ${job.error}`);
    }
  } finally {
    stopRequested.delete(jobId);
  }
}

export function getEmotionPipelineJob(jobId: string): EmotionPipelineJob | undefined {
  return jobs.get(jobId);
}

/**
 * Request a running/pending pipeline job to stop.
 */
export function stopEmotionPipelineJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.status !== "running" && job.status !== "pending") return false;
  stopRequested.set(jobId, true);
  if (job.status === "pending") {
    job.status = "stopped";
    addLog(jobId, "Job stopped (was pending).");
    instanceQueueManager.cancelByJobId(jobId);
  }
  return true;
}

export function getEmotionPipelineQueueState(): {
  queue: string[];
  currentJobId: string | null;
  currentJobIds: string[];
  jobs: EmotionPipelineJob[];
} {
  const jobList = Array.from(jobs.values()).sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tB - tA;
  });
  const pendingJobs = jobList.filter((j) => j.status === "pending").map((j) => j.jobId);
  const runningJobs = jobList.filter((j) => j.status === "running").map((j) => j.jobId);
  return {
    queue: pendingJobs,
    currentJobId: runningJobs[0] ?? null,
    currentJobIds: runningJobs,
    jobs: jobList,
  };
}

/**
 * Create a new pipeline job and add it to the queue. Returns jobId.
 */
export function createEmotionPipelineJob(params: EmotionPipelineParams): string {
  const jobId = uuidv4();
  const job: EmotionPipelineJob = {
    jobId,
    status: "pending",
    totalSteps: 0,
    currentStep: 0,
    logs: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  jobParams.set(jobId, params);

  instanceQueueManager.enqueue({
    jobId,
    serviceType: "emotion-pipeline",
    label: `Emotion pipeline: inpaint+upscale`,
    instanceId: params.comfyInstanceId,
    onStart: async () => {
      job.status = "running";
      await startEmotionPipeline(jobId, params);
    },
  });
  return jobId;
}
