import { Router, Request, Response } from "express";
import { happyHorseService } from "../services/happyhorse-i2v.service.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const happyhorseRouter = Router();

happyhorseRouter.post(
  "/generate",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      imageDataUri,
      prompt,
      resolution,
      duration,
      promptExtend,
      negativePrompt,
    } = req.body || {};

    if (!imageDataUri || typeof imageDataUri !== "string") {
      res.status(400).json({ error: "imageDataUri is required" });
      return;
    }
    if (!process.env.DASHSCOPE_API_KEY?.trim()) {
      res.status(500).json({ error: "DASHSCOPE_API_KEY is not configured" });
      return;
    }

    const job = happyHorseService.createJob({
      imageDataUri,
      prompt,
      resolution,
      duration,
      promptExtend,
      negativePrompt,
    });
    happyHorseService.startJob(job.id, imageDataUri);

    res.json({ success: true, jobId: job.id, job });
  }),
);

happyhorseRouter.get(
  "/:jobId/status",
  asyncHandler(async (req: Request, res: Response) => {
    const job = happyHorseService.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ success: true, job });
  }),
);
