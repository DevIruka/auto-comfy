import { Router, Request, Response } from "express";
import { batchV2Service } from "../services/batch-v2.service.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const batchV2Router = Router();

batchV2Router.post(
  "/scan",
  asyncHandler(async (req: Request, res: Response) => {
    const { folderPath, outputFolderPath } = req.body;
    if (!folderPath) {
      res.status(400).json({ error: "folderPath is required" });
      return;
    }
    const images = await batchV2Service.scanFolder(
      folderPath,
      typeof outputFolderPath === "string" ? outputFolderPath : undefined,
    );
    const pending = images.filter((image) => !image.skipped).length;
    const skipped = images.length - pending;
    res.json({
      success: true,
      images,
      count: images.length,
      pending,
      skipped,
    });
  }),
);

batchV2Router.post(
  "/start",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      folderPath,
      outputFolderPath,
      prefixPrompt,
      wanVersion = "json",
    } = req.body;

    if (!folderPath) {
      res.status(400).json({ error: "folderPath is required" });
      return;
    }
    if (!prefixPrompt) {
      res.status(400).json({ error: "prefixPrompt is required" });
      return;
    }
    if (wanVersion !== "json" && wanVersion !== "2.7" && wanVersion !== "2.2") {
      res.status(400).json({ error: 'wanVersion must be "json", "2.7", or "2.2"' });
      return;
    }

    const job = await batchV2Service.createBatchJob(
      folderPath,
      outputFolderPath || "",
      prefixPrompt,
      wanVersion,
    );

    await batchV2Service.startBatch(job.id);

    res.json({ success: true, jobId: job.id, job });
  }),
);

batchV2Router.get(
  "/jobs",
  asyncHandler(async (_req: Request, res: Response) => {
    const jobs = batchV2Service.getAllJobs();
    res.json({ success: true, jobs, count: jobs.length });
  }),
);

batchV2Router.get(
  "/:jobId/status",
  asyncHandler(async (req: Request, res: Response) => {
    const job = batchV2Service.getBatchStatus(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ success: true, job });
  }),
);

batchV2Router.post(
  "/:jobId/pause",
  asyncHandler(async (req: Request, res: Response) => {
    await batchV2Service.pauseBatch(req.params.jobId);
    res.json({ success: true, message: "Batch paused" });
  }),
);

batchV2Router.post(
  "/:jobId/resume",
  asyncHandler(async (req: Request, res: Response) => {
    await batchV2Service.resumeBatch(req.params.jobId);
    res.json({ success: true, message: "Batch resumed" });
  }),
);

batchV2Router.post(
  "/:jobId/stop",
  asyncHandler(async (req: Request, res: Response) => {
    await batchV2Service.stopBatch(req.params.jobId);
    res.json({ success: true, message: "Batch stopped" });
  }),
);
