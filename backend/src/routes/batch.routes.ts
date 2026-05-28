import { Router, Request, Response } from "express";
import { batchService } from "../services/batch.service.js";
import {
  readBatchVideoSettings,
  writeBatchVideoSettings,
  type BatchFixedSeedCount,
} from "../services/batch-video-settings.service.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const batchRouter = Router();

/**
 * POST /api/batch/scan
 * Scan folder for images
 */
batchRouter.post(
  "/scan",
  asyncHandler(async (req: Request, res: Response) => {
    const { folderPath } = req.body;

    if (!folderPath) {
      res.status(400).json({ error: "folderPath is required" });
      return;
    }

    const images = await batchService.scanFolder(folderPath);

    res.json({
      success: true,
      images,
      count: images.length,
    });
  }),
);

/**
 * POST /api/batch/start
 * Start batch processing
 */
batchRouter.post(
  "/start",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      folderPath,
      outputFolderPath,
      prefixPrompt,
      includeRandomSeeds = false,
      autoStopPod = false,
      comfyInstanceId,
    } = req.body;

    if (!folderPath) {
      res.status(400).json({ error: "folderPath is required" });
      return;
    }

    if (!prefixPrompt) {
      res.status(400).json({ error: "prefixPrompt is required" });
      return;
    }

    // Create job
    const job = await batchService.createBatchJob(
      folderPath,
      outputFolderPath || "",
      prefixPrompt,
      includeRandomSeeds,
      autoStopPod,
      comfyInstanceId,
    );

    // Start processing
    await batchService.startBatch(job.id);

    res.json({
      success: true,
      jobId: job.id,
      job,
    });
  }),
);

/**
 * GET /api/batch/settings — persisted video batch options (fixed seed count per image)
 */
batchRouter.get(
  "/settings",
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await readBatchVideoSettings();
    res.json({ success: true, data: settings });
  }),
);

/**
 * PUT /api/batch/settings — body: { fixedSeedCount: 2 | 3 }
 */
batchRouter.put(
  "/settings",
  asyncHandler(async (req: Request, res: Response) => {
    const raw = req.body?.fixedSeedCount;
    const n = typeof raw === "string" ? parseInt(raw, 10) : raw;
    if (n !== 2 && n !== 3) {
      res.status(400).json({
        success: false,
        error: "fixedSeedCount must be 2 or 3",
      });
      return;
    }
    const data = await writeBatchVideoSettings(n as BatchFixedSeedCount);
    res.json({ success: true, data });
  }),
);

/**
 * POST /api/batch/:jobId/pause
 * Pause batch processing
 */
batchRouter.post(
  "/:jobId/pause",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    await batchService.pauseBatch(jobId);

    res.json({
      success: true,
      message: "Batch paused",
    });
  }),
);

/**
 * POST /api/batch/:jobId/resume
 * Resume batch processing
 */
batchRouter.post(
  "/:jobId/resume",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    await batchService.resumeBatch(jobId);

    res.json({
      success: true,
      message: "Batch resumed",
    });
  }),
);

/**
 * POST /api/batch/:jobId/stop
 * Stop batch processing
 */
batchRouter.post(
  "/:jobId/stop",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    await batchService.stopBatch(jobId);

    res.json({
      success: true,
      message: "Batch stopped",
    });
  }),
);

/**
 * GET /api/batch/:jobId/status
 * Get batch status
 */
batchRouter.get(
  "/:jobId/status",
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    const job = batchService.getBatchStatus(jobId);

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
 * GET /api/batch/jobs
 * Get all jobs
 */
batchRouter.get(
  "/jobs",
  asyncHandler(async (req: Request, res: Response) => {
    const jobs = batchService.getAllJobs();

    res.json({
      success: true,
      jobs,
      count: jobs.length,
    });
  }),
);
