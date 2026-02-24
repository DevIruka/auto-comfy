import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { comfyManager } from "../services/comfy-manager.service.js";
import {
  createImageGenWorkflow,
  type LoraSlotConfig,
} from "../utils/workflow-helpers.js";
import { mkdir } from "fs/promises";
import { join } from "path";

const imageGenRouter = Router();

/**
 * GET /api/image-gen/loras?instanceId=comfy1
 * Fetch available LoRA files from a ComfyUI instance
 */
imageGenRouter.get(
  "/loras",
  asyncHandler(async (req: Request, res: Response) => {
    const instanceId =
      (req.query.instanceId as string) || comfyManager.getDefaultInstanceId();
    const comfy = comfyManager.getInstance(instanceId);
    const objectInfo = await comfy.getObjectInfo();

    const loraLoader = objectInfo?.LoraLoader;
    if (!loraLoader?.input?.required?.lora_name) {
      return res.json({ success: true, loras: [] });
    }

    const loraNames: string[] = loraLoader.input.required.lora_name[0] || [];
    res.json({ success: true, loras: loraNames });
  }),
);

/**
 * POST /api/image-gen/generate
 * Generate images with dynamic LoRA configuration
 */
imageGenRouter.post(
  "/generate",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      instanceId,
      loras,
      positivePrompt,
      negativePrompt,
      seed,
      batchSize,
      outputPath,
    } = req.body as {
      instanceId?: string;
      loras: LoraSlotConfig[];
      positivePrompt: string;
      negativePrompt: string;
      seed: number;
      batchSize?: number;
      outputPath?: string;
    };

    if (!positivePrompt) {
      return res
        .status(400)
        .json({ success: false, error: "positivePrompt is required" });
    }
    if (!loras || !Array.isArray(loras)) {
      return res
        .status(400)
        .json({ success: false, error: "loras array is required" });
    }

    const comfyId =
      instanceId || comfyManager.getDefaultInstanceId();
    const comfy = comfyManager.getInstance(comfyId);

    const workflow = createImageGenWorkflow({
      loras,
      positivePrompt,
      negativePrompt,
      seed: seed ?? Math.floor(Math.random() * 1e15),
      batchSize: batchSize ?? 4,
    });

    const queueResponse = await comfy.queuePrompt(workflow);
    const promptId = queueResponse.prompt_id;

    if (
      queueResponse.node_errors &&
      Object.keys(queueResponse.node_errors).length > 0
    ) {
      return res.status(400).json({
        success: false,
        error: `Workflow validation failed`,
        details: queueResponse.node_errors,
      });
    }

    console.log(`🖼️ Image generation queued: ${promptId} on ${comfyId}`);

    // Poll for completion - check node 212 (SaveImage)
    const maxAttempts = 120;
    let attempts = 0;

    const poll = (): Promise<any> =>
      new Promise((resolve, reject) => {
        const check = async () => {
          attempts++;
          try {
            const history = await comfy.getHistory(promptId);
            if (history[promptId]) {
              const { status, outputs } = history[promptId];

              if (status.status_str === "error") {
                reject(new Error("Workflow execution failed"));
                return;
              }

              if (
                status.completed &&
                (outputs?.["212"]?.images?.length ?? 0) > 0
              ) {
                resolve({ prompt_id: promptId, outputs });
                return;
              }
            }

            if (attempts >= maxAttempts) {
              reject(new Error("Image generation timeout (10 min)"));
              return;
            }

            setTimeout(check, 5000);
          } catch (err) {
            reject(err);
          }
        };
        setTimeout(check, 3000);
      });

    const result = await poll();

    const images = (result.outputs["212"]?.images || []).map(
      (img: { filename: string; subfolder: string; type: string }) => ({
        filename: img.filename,
        subfolder: img.subfolder,
        type: img.type,
      }),
    );

    console.log(
      `✅ Image generation completed: ${promptId} (${images.length} images)`,
    );

    const savedPaths: string[] = [];
    if (outputPath && images.length > 0) {
      try {
        await mkdir(outputPath, { recursive: true });
        for (const img of images) {
          const imageBuffer = await comfy.getImage(
            img.filename,
            img.subfolder,
            img.type,
          );
          const savePath = join(outputPath, img.filename);
          const fs = await import("fs/promises");
          await fs.writeFile(savePath, imageBuffer);
          savedPaths.push(savePath);
          console.log(`💾 Image saved: ${savePath}`);
        }
      } catch (saveErr: unknown) {
        const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
        console.error(`⚠️ Failed to save images to ${outputPath}:`, msg);
      }
    }

    res.json({
      success: true,
      data: { prompt_id: promptId, images, savedPaths },
    });
  }),
);

/**
 * GET /api/image-gen/view
 * Proxy image from a specific ComfyUI instance
 */
imageGenRouter.get(
  "/view",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      instanceId,
      filename,
      subfolder = "",
      type = "output",
    } = req.query as Record<string, string>;

    if (!filename) {
      return res
        .status(400)
        .json({ success: false, error: "filename is required" });
    }

    const comfyId =
      instanceId || comfyManager.getDefaultInstanceId();
    const comfy = comfyManager.getInstance(comfyId);
    const imageBuffer = await comfy.getImage(filename, subfolder, type);

    const ext = filename.toLowerCase().split(".").pop();
    const contentType =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "webp"
            ? "image/webp"
            : "application/octet-stream";

    res.set("Content-Type", contentType);
    res.send(imageBuffer);
  }),
);

export default imageGenRouter;
