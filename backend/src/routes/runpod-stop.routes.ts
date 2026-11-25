import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { runPodStopService } from "../services/runpod-stop.service.js";

const runpodStopRouter = Router();

/**
 * POST /api/runpod-stop/schedule
 * Schedule a RunPod shutdown on the given instance's queue.
 */
runpodStopRouter.post(
  "/schedule",
  asyncHandler(async (req: Request, res: Response) => {
    const { instanceId, podId, shutdownPc } = req.body as {
      instanceId?: string;
      podId?: string;
      shutdownPc?: boolean;
    };

    if (!instanceId || typeof instanceId !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "instanceId is required" });
    }

    try {
      const result = runPodStopService.scheduleStop({
        instanceId,
        podId: typeof podId === "string" ? podId : undefined,
        shutdownPc: shutdownPc === true,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : "RunPod 종료 예약 실패",
      });
    }
  }),
);

/**
 * GET /api/runpod-stop/jobs
 * Recent schedule/execution log summary for the tab.
 */
runpodStopRouter.get(
  "/jobs",
  asyncHandler(async (_req: Request, res: Response) => {
    const jobs = runPodStopService.getRecentJobs();
    res.json({ success: true, jobs });
  }),
);

export default runpodStopRouter;
