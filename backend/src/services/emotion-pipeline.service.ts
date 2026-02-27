import { readdir, readFile, writeFile, mkdir, cp, rm } from "fs/promises";
import { join, basename, extname } from "path";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { createSdxlWaiWorkflow, createSdxlWaiHiresWorkflow, HIRES_SAVE_NODE_ID, type SdxlWaiPromptBlocks, type SdxlWaiLoraSlot } from "../utils/workflow-helpers.js";
import { comfyManager } from "./comfy-manager.service.js";

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
  status: "pending" | "running" | "completed" | "failed";
  totalSteps: number;
  currentStep: number;
  logs: string[];
  error?: string;
  createdAt?: string;
}

const jobs = new Map<string, EmotionPipelineJob>();
const jobParams = new Map<string, EmotionPipelineParams>();
/** Queue per ComfyUI instance: different ports run in parallel. */
const jobQueueByInstance = new Map<string, string[]>();
/** Current running job per instance (one at a time per port). */
const currentJobByInstance = new Map<string, string>();

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

function processQueue(): void {
  const instanceIds = new Set<string>([
    ...jobQueueByInstance.keys(),
    ...currentJobByInstance.keys(),
  ]);
  for (const instanceId of instanceIds) {
    if (currentJobByInstance.get(instanceId) != null) continue;
    const queue = jobQueueByInstance.get(instanceId);
    if (!queue?.length) continue;

    const nextId = queue.shift()!;
    const params = jobParams.get(nextId);
    if (!params) {
      processQueue();
      return;
    }
    currentJobByInstance.set(instanceId, nextId);
    const job = jobs.get(nextId);
    if (job) job.status = "running";

    startEmotionPipeline(nextId, params)
      .finally(() => {
        currentJobByInstance.delete(instanceId);
        processQueue();
      })
      .catch((err) => {
        console.error(`[EmotionPipeline ${nextId}] Unhandled error:`, err);
        const j = jobs.get(nextId);
        if (j) {
          j.status = "failed";
          j.error = err?.message ?? String(err);
        }
      });
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
 * Scan folder for image paths. If useOriginSubfolder, scan the "원본" subfolder when present.
 * Only includes files whose filename contains "원본".
 */
async function scanImagePaths(folderPath: string, useOriginSubfolder: boolean): Promise<string[]> {
  let dir = folderPath;
  if (useOriginSubfolder) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const origin = entries.find((e) => e.isDirectory() && e.name === "원본");
      if (origin) dir = join(dir, "원본");
    } catch {
      // ignore
    }
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.includes("원본")) continue;
    const ext = extname(e.name).toLowerCase();
    if (IMAGE_EXT.has(ext)) files.push(join(dir, e.name));
  }
  return files.sort();
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

    const imagePaths = await scanImagePaths(folderPath, useOriginSubfolder);
    if (imagePaths.length === 0) {
      throw new Error('No images found whose filename contains "원본" (in folder or 원본 subfolder)');
    }
    addLog(jobId, `Found ${imagePaths.length} images`);

    const maskedOutputDir = join(folderPath, "masked");
    const masked = await runFaceMaskWithLock(imagePaths, faceMaskDir, jobId, maskedOutputDir);
    if (masked.length === 0) {
      throw new Error("Face mask produced no outputs");
    }

    const emotionsFolder = join(folderPath, "Emotions");
    await mkdir(emotionsFolder, { recursive: true });
    for (const em of EMOTIONS) {
      await mkdir(join(emotionsFolder, em), { recursive: true });
    }

    // Total steps: per image, per emotion, per "round" we do 1 inpaint + 1 upscale = 2 steps. Rounds = totalSeeds.
    const totalSteps = masked.length * EMOTIONS.length * totalSeeds * 2;
    setStep(jobId, 0, totalSteps);
    let step = 0;

    for (const { inputPath, outputPath } of masked) {
      const baseName = basename(inputPath, extname(inputPath));

      for (const emotion of EMOTIONS) {
        const emotionPrompt = (emotionConfig as unknown as Record<string, string>)[emotion] ?? "";
        const promptBlocks: SdxlWaiPromptBlocks = {
          ...baseBlocks,
          emotion: emotionPrompt,
        };

        const maskedBuffer = await readFile(outputPath);

        // Each "round" = full chain: inpaint → upscale. Do totalSeeds rounds per emotion.
        for (let round = 0; round < totalSeeds; round++) {
          const seedInpaint = Math.floor(Math.random() * 1e15);
          const uploadName = `emotion_${baseName}_${emotion}_r${round}.png`;

          const dims = getPngDimensions(maskedBuffer);
          addLog(jobId, `Round ${round + 1}/${totalSeeds}: Inpaint → Upscale for ${baseName} / ${emotion}`);
          const inpaintResult = await runWorkflowWithUpload(
            comfy,
            maskedBuffer,
            uploadName,
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

          const firstImage = getFirstImageFromOutput(inpaintResult.outputs);
          if (!firstImage) {
            addLog(jobId, `No output from inpaint for ${emotion} round ${round + 1}`);
            step++;
            setStep(jobId, step, totalSteps);
            continue;
          }

          const inpaintBuffer = await comfy.getImage(firstImage.filename, firstImage.subfolder || "", firstImage.type || "output");
          const dimsUpscale = getPngDimensions(inpaintBuffer);
          const seedUpscale = Math.floor(Math.random() * 1e15);
          const upscaleUploadName = `upscale_${baseName}_${emotion}_r${round}.png`;
          const upscaleResult = await runWorkflowWithUpload(
            comfy,
            inpaintBuffer,
            upscaleUploadName,
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

          const upImg = getFirstImageFromOutput(upscaleResult.outputs, HIRES_SAVE_NODE_ID);
          if (upImg) {
            const upBuf = await comfy.getImage(upImg.filename, upImg.subfolder || "", upImg.type || "output");
            const outPath = join(emotionsFolder, emotion, `${baseName}_${emotion}_${round}.png`);
            await writeFile(outPath, upBuf);
            addLog(jobId, `Saved: ${emotion}/${baseName}_${emotion}_${round}.png`);
          }
        }
      }
    }

    job.status = "completed";
    addLog(jobId, "Pipeline completed.");
  } catch (err: any) {
    job.status = "failed";
    job.error = err?.message ?? String(err);
    addLog(jobId, `Failed: ${job.error}`);
  }
}

export function getEmotionPipelineJob(jobId: string): EmotionPipelineJob | undefined {
  return jobs.get(jobId);
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
  const queue = Array.from(jobQueueByInstance.values()).flat();
  const currentJobIds = Array.from(currentJobByInstance.values()).filter(Boolean);
  return {
    queue,
    currentJobId: currentJobIds[0] ?? null,
    currentJobIds,
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

  const instanceId = params.comfyInstanceId;
  if (!jobQueueByInstance.has(instanceId)) {
    jobQueueByInstance.set(instanceId, []);
  }
  jobQueueByInstance.get(instanceId)!.push(jobId);
  processQueue();
  return jobId;
}
