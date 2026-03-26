import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  anchorImageService,
  type AnchorImageJobParams,
} from "../services/anchor-image.service.js";

const anchorImageRouter = Router();

anchorImageRouter.post(
  "/start",
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as AnchorImageJobParams;
    const params: AnchorImageJobParams = {
      ...body,
      compositionPose:
        typeof body.compositionPose === "string" ? body.compositionPose : "",
    };

    if (!params.outputPath) {
      return res
        .status(400)
        .json({ success: false, error: "outputPath is required" });
    }
    if (params.aspect !== "portrait" && params.aspect !== "landscape") {
      return res.status(400).json({
        success: false,
        error: 'aspect must be "portrait" or "landscape"',
      });
    }

    const jobId = anchorImageService.createJob(params);

    res.json({
      success: true,
      data: { jobId, job: anchorImageService.getJob(jobId) },
    });
  }),
);

anchorImageRouter.get(
  "/queue",
  asyncHandler(async (_req: Request, res: Response) => {
    const state = anchorImageService.getQueueState();
    res.json({ success: true, data: state });
  }),
);

/**
 * GET preview PNG for a completed job result (by index)
 */
anchorImageRouter.get(
  "/:jobId/preview/:index",
  asyncHandler(async (req: Request, res: Response) => {
    const idx = parseInt(req.params.index, 10);
    if (Number.isNaN(idx) || idx < 0) {
      return res.status(400).json({ success: false, error: "Invalid index" });
    }
    const buf = await anchorImageService.readPreviewBuffer(
      req.params.jobId,
      idx,
    );
    if (!buf) {
      return res
        .status(404)
        .json({ success: false, error: "Image not found or job not ready" });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=120");
    res.send(buf);
  }),
);

/**
 * POST write preview buffer to {label}.png in the job export folder (감정별 이미지)
 */
anchorImageRouter.post(
  "/:jobId/save-as",
  asyncHandler(async (req: Request, res: Response) => {
    const { imageIndex, label } = req.body as {
      imageIndex?: unknown;
      label?: string;
    };
    const idx =
      typeof imageIndex === "number"
        ? imageIndex
        : parseInt(String(imageIndex), 10);
    if (Number.isNaN(idx) || idx < 0 || !label || typeof label !== "string") {
      return res.status(400).json({
        success: false,
        error: "imageIndex (number) and label (string) are required",
      });
    }
    try {
      const data = await anchorImageService.saveResultWithLabel(
        req.params.jobId,
        idx,
        label,
      );
      res.json({ success: true, data });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ success: false, error: msg });
    }
  }),
);

anchorImageRouter.get(
  "/:jobId/status",
  asyncHandler(async (req: Request, res: Response) => {
    const job = anchorImageService.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    res.json({ success: true, data: job });
  }),
);

anchorImageRouter.post(
  "/:jobId/stop",
  asyncHandler(async (req: Request, res: Response) => {
    const job = anchorImageService.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found" });
    }
    anchorImageService.stopJob(req.params.jobId);
    res.json({ success: true, data: { message: "Stop requested" } });
  }),
);

export default anchorImageRouter;
