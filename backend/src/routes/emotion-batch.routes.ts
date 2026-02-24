import { Router, Request, Response } from "express";
import { emotionBatchService } from "../services/emotion-batch.service.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const emotionBatchRouter = Router();

/**
 * POST /api/emotion-batch/scan
 * Scan folder for emotion images
 */
emotionBatchRouter.post(
  "/scan",
  asyncHandler(async (req: Request, res: Response) => {
    const { folderPath } = req.body;

    if (!folderPath) {
      res.status(400).json({ error: "folderPath is required" });
      return;
    }

    const images = await emotionBatchService.scanFolder(folderPath);

    res.json({
      success: true,
      images,
      count: images.length,
    });
  }),
);

/**
 * POST /api/emotion-batch/start
 * Start emotion batch processing
 */
emotionBatchRouter.post(
  "/start",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      folderPath,
      outputFolderPath,
      prefixPrompt,
      comfyInstanceId,
      includeSpeakNatural,
      autoStopPod = false,
    } = req.body;

    if (!folderPath) {
      res.status(400).json({ error: "folderPath is required" });
      return;
    }

    if (!prefixPrompt) {
      res.status(400).json({ error: "prefixPrompt is required" });
      return;
    }

    if (!comfyInstanceId) {
      res.status(400).json({ error: "comfyInstanceId is required" });
      return;
    }

    // Create job
    const job = await emotionBatchService.createEmotionBatchJob(
      folderPath,
      outputFolderPath || "",
      prefixPrompt,
      comfyInstanceId,
      includeSpeakNatural ?? true, // default to true if not specified
      autoStopPod,
    );

    // Start processing
    await emotionBatchService.startBatch(job.id);

    res.json({
      success: true,
      jobId: job.id,
      job,
    });
  }),
);

/**
 * POST /api/emotion-batch/:jobId/pause
 * Pause emotion batch processing
 */
emotionBatchRouter.post(
  "/:jobId/pause",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    emotionBatchService.pauseBatch(jobId);

    const job = emotionBatchService.getBatchStatus(jobId);
    res.json({
      success: true,
      job,
    });
  }),
);

/**
 * POST /api/emotion-batch/:jobId/resume
 * Resume emotion batch processing
 */
emotionBatchRouter.post(
  "/:jobId/resume",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    emotionBatchService.resumeBatch(jobId);

    const job = emotionBatchService.getBatchStatus(jobId);
    res.json({
      success: true,
      job,
    });
  }),
);

/**
 * POST /api/emotion-batch/:jobId/stop
 * Stop emotion batch processing
 */
emotionBatchRouter.post(
  "/:jobId/stop",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    emotionBatchService.stopBatch(jobId);

    const job = emotionBatchService.getBatchStatus(jobId);
    res.json({
      success: true,
      job,
    });
  }),
);

/**
 * GET /api/emotion-batch/:jobId/status
 * Get emotion batch job status
 */
emotionBatchRouter.get(
  "/:jobId/status",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = emotionBatchService.getBatchStatus(jobId);

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.json({
      success: true,
      job,
    });
  }),
);

/**
 * GET /api/emotion-batch/jobs
 * Get all emotion batch jobs
 */
emotionBatchRouter.get(
  "/jobs",
  asyncHandler(async (req: Request, res: Response) => {
    const jobs = emotionBatchService.getAllJobs();
    res.json({
      success: true,
      jobs,
    });
  }),
);

export default emotionBatchRouter;
