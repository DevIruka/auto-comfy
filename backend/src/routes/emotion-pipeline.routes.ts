import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  createEmotionPipelineJob,
  getEmotionPipelineJob,
  getEmotionPipelineQueueState,
  type EmotionPipelineParams,
  type SdxlWaiPromptBlocks,
  type SdxlWaiLoraSlot,
} from "../services/emotion-pipeline.service.js";
import { comfyManager } from "../services/comfy-manager.service.js";

const emotionPipelineRouter = Router();

/**
 * POST /api/emotion-pipeline/start
 * Start emotion inpaint + upscale pipeline (folder scan → mask → 4 emotions inpaint → upscale × N → save to Emotions/{emotion})
 * Body: EmotionPipelineParams (folderPath, comfyInstanceId, promptBlocks, loraSlots?, upscaleSeedCount?, useOriginSubfolder?)
 */
emotionPipelineRouter.post(
  "/start",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      folderPath: string;
      comfyInstanceId: string;
      promptBlocks: SdxlWaiPromptBlocks;
      loraSlots?: SdxlWaiLoraSlot[];
      upscaleSeedCount?: number;
      useOriginSubfolder?: boolean;
    };

    if (!body.folderPath || typeof body.folderPath !== "string") {
      return res.status(400).json({ success: false, error: "folderPath is required" });
    }
    if (!body.comfyInstanceId || typeof body.comfyInstanceId !== "string") {
      return res.status(400).json({ success: false, error: "comfyInstanceId is required" });
    }
    if (!comfyManager.hasInstance(body.comfyInstanceId)) {
      return res.status(400).json({ success: false, error: `ComfyUI instance '${body.comfyInstanceId}' not found` });
    }
    if (!body.promptBlocks || typeof body.promptBlocks !== "object") {
      return res.status(400).json({ success: false, error: "promptBlocks is required (styleTrigger, character, pose, emotion, background)" });
    }

    const params: EmotionPipelineParams = {
      folderPath: body.folderPath,
      comfyInstanceId: body.comfyInstanceId,
      promptBlocks: {
        styleTrigger: body.promptBlocks.styleTrigger ?? "",
        character: body.promptBlocks.character ?? "",
        pose: body.promptBlocks.pose ?? "",
        emotion: body.promptBlocks.emotion ?? "",
        background: body.promptBlocks.background ?? "",
        negativeExtra: body.promptBlocks.negativeExtra ?? "",
      },
      loraSlots: body.loraSlots,
      upscaleSeedCount: typeof body.upscaleSeedCount === "number" ? Math.max(3, body.upscaleSeedCount) : 3,
      useOriginSubfolder: body.useOriginSubfolder !== false,
    };

    const jobId = createEmotionPipelineJob(params);

    res.json({
      success: true,
      data: { jobId },
    });
  }),
);

/**
 * GET /api/emotion-pipeline/queue
 * Get queue state and all jobs (pending, running, completed, failed)
 */
emotionPipelineRouter.get(
  "/queue",
  asyncHandler(async (_req: Request, res: Response) => {
    const state = getEmotionPipelineQueueState();
    res.json({ success: true, data: state });
  }),
);

/**
 * GET /api/emotion-pipeline/:jobId/status
 * Get pipeline job status and logs
 */
emotionPipelineRouter.get(
  "/:jobId/status",
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = req.params.jobId;
    const job = getEmotionPipelineJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    res.json({ success: true, data: job });
  }),
);

export default emotionPipelineRouter;
