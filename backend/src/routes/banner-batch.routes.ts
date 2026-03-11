import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  bannerBatchService,
  type BannerBatchJobParams,
} from "../services/banner-batch.service.js";

const bannerBatchRouter = Router();

/**
 * GET /api/banner-batch/config
 * Get banner config (pose, gesture from banner-config.json)
 */
bannerBatchRouter.get(
  "/config",
  asyncHandler(async (_req: Request, res: Response) => {
    const config = bannerBatchService.getConfig();
    res.json({ success: true, data: config });
  }),
);

/**
 * POST /api/banner-batch/start
 * Start a banner/thumbnail batch image generation job
 */
bannerBatchRouter.post(
  "/start",
  asyncHandler(async (req: Request, res: Response) => {
    const params = req.body as BannerBatchJobParams;

    if (!params.outputPath) {
      return res
        .status(400)
        .json({ success: false, error: "outputPath is required" });
    }

    const jobId = bannerBatchService.createJob(params);

    res.json({
      success: true,
      data: { jobId, job: bannerBatchService.getJob(jobId) },
    });
  }),
);

/**
 * GET /api/banner-batch/queue
 * Get queue state and all jobs
 */
bannerBatchRouter.get(
  "/queue",
  asyncHandler(async (_req: Request, res: Response) => {
    const state = bannerBatchService.getQueueState();
    res.json({ success: true, data: state });
  }),
);

/**
 * GET /api/banner-batch/:jobId/status
 * Get job status
 */
bannerBatchRouter.get(
  "/:jobId/status",
  asyncHandler(async (req: Request, res: Response) => {
    const job = bannerBatchService.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    res.json({ success: true, data: job });
  }),
);

/**
 * POST /api/banner-batch/:jobId/stop
 * Stop a running job
 */
bannerBatchRouter.post(
  "/:jobId/stop",
  asyncHandler(async (req: Request, res: Response) => {
    const job = bannerBatchService.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    bannerBatchService.stopJob(req.params.jobId);
    res.json({ success: true, data: { message: "Stop requested" } });
  }),
);

export default bannerBatchRouter;
