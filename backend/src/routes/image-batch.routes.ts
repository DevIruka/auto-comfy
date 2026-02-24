import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  imageBatchService,
  type ImageBatchJobParams,
} from "../services/image-batch.service.js";

const imageBatchRouter = Router();

/**
 * GET /api/image-batch/poses
 * Get available poses and expressions from config
 */
imageBatchRouter.get(
  "/poses",
  asyncHandler(async (_req: Request, res: Response) => {
    const config = imageBatchService.getPoseConfig();
    const poses = Object.entries(config).map(([name, expressionMap]) => ({
      name,
      expressions: Object.keys(expressionMap),
    }));
    res.json({ success: true, poses });
  }),
);

/**
 * POST /api/image-batch/start
 * Start a batch image generation job
 */
imageBatchRouter.post(
  "/start",
  asyncHandler(async (req: Request, res: Response) => {
    const params = req.body as ImageBatchJobParams;

    if (!params.poses || params.poses.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "At least one pose must be selected" });
    }
    if (!params.outputPath) {
      return res
        .status(400)
        .json({ success: false, error: "outputPath is required" });
    }

    const jobId = imageBatchService.createJob(params);

    res.json({
      success: true,
      data: { jobId, job: imageBatchService.getJob(jobId) },
    });
  }),
);

/**
 * GET /api/image-batch/queue
 * Get queue state and all jobs
 */
imageBatchRouter.get(
  "/queue",
  asyncHandler(async (_req: Request, res: Response) => {
    const state = imageBatchService.getQueueState();
    res.json({ success: true, data: state });
  }),
);

/**
 * GET /api/image-batch/:jobId/status
 * Get job status
 */
imageBatchRouter.get(
  "/:jobId/status",
  asyncHandler(async (req: Request, res: Response) => {
    const job = imageBatchService.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    res.json({ success: true, data: job });
  }),
);

/**
 * POST /api/image-batch/:jobId/stop
 * Stop a running job
 */
imageBatchRouter.post(
  "/:jobId/stop",
  asyncHandler(async (req: Request, res: Response) => {
    const job = imageBatchService.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    imageBatchService.stopJob(req.params.jobId);
    res.json({ success: true, data: { message: "Stop requested" } });
  }),
);

export default imageBatchRouter;
