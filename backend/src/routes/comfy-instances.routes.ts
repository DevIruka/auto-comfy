import { Router, Request, Response } from "express";
import { comfyManager } from "../services/comfy-manager.service.js";
import { instanceQueueManager } from "../services/instance-queue-manager.service.js";
import { asyncHandler } from "../middleware/errorHandler.js";

const comfyInstancesRouter = Router();

/**
 * GET /api/comfy-instances
 * Get all available ComfyUI instances
 */
comfyInstancesRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const instances = comfyManager.getAllInstances();

    res.json({
      success: true,
      instances,
      count: instances.length,
    });
  })
);

/**
 * GET /api/comfy-instances/dashboard
 * Returns all instances + their queue status (running/pending jobs)
 */
comfyInstancesRouter.get(
  "/dashboard",
  asyncHandler(async (_req: Request, res: Response) => {
    const instances = comfyManager.getAllInstances();
    const queueStatus = instanceQueueManager.getAllStatus();

    const dashboard = instances.map((inst) => {
      const status = queueStatus[inst.id] ?? { running: null, pending: [] };
      return {
        ...inst,
        running: status.running
          ? {
              entryId: status.running.entryId,
              jobId: status.running.jobId,
              serviceType: status.running.serviceType,
              label: status.running.label,
              createdAt: status.running.createdAt,
            }
          : null,
        pending: status.pending.map((e) => ({
          entryId: e.entryId,
          jobId: e.jobId,
          serviceType: e.serviceType,
          label: e.label,
          createdAt: e.createdAt,
        })),
      };
    });

    res.json({ success: true, dashboard });
  })
);

/**
 * POST /api/comfy-instances/dashboard/cancel/:entryId
 * Cancel a pending queue entry by entryId
 */
comfyInstancesRouter.post(
  "/dashboard/cancel/:entryId",
  asyncHandler(async (req: Request, res: Response) => {
    const { entryId } = req.params;
    const removed = instanceQueueManager.cancel(entryId);
    if (!removed) {
      return res.status(404).json({ success: false, error: "Entry not found or already running" });
    }
    res.json({ success: true });
  })
);

/**
 * POST /api/comfy-instances/dashboard/stop
 * Stop a running job by serviceType + jobId (delegates to the correct service)
 */
comfyInstancesRouter.post(
  "/dashboard/stop",
  asyncHandler(async (req: Request, res: Response) => {
    const { serviceType, jobId } = req.body as { serviceType?: string; jobId?: string };
    if (!serviceType || !jobId) {
      return res.status(400).json({ success: false, error: "serviceType and jobId are required" });
    }

    let stopped = false;
    switch (serviceType) {
      case "image-batch": {
        const { imageBatchService } = await import("../services/image-batch.service.js");
        imageBatchService.stopJob(jobId);
        stopped = true;
        break;
      }
      case "banner-batch": {
        const { bannerBatchService } = await import("../services/banner-batch.service.js");
        bannerBatchService.stopJob(jobId);
        stopped = true;
        break;
      }
      case "anchor-image": {
        const { anchorImageService } = await import("../services/anchor-image.service.js");
        anchorImageService.stopJob(jobId);
        stopped = true;
        break;
      }
      case "batch": {
        const { batchService } = await import("../services/batch.service.js");
        await batchService.stopBatch(jobId);
        stopped = true;
        break;
      }
      case "emotion-batch": {
        const { emotionBatchService } = await import("../services/emotion-batch.service.js");
        emotionBatchService.stopBatch(jobId);
        stopped = true;
        break;
      }
      case "emotion-pipeline": {
        const { stopEmotionPipelineJob } = await import("../services/emotion-pipeline.service.js");
        stopped = stopEmotionPipelineJob(jobId);
        break;
      }
      default:
        return res.status(400).json({ success: false, error: `Unknown serviceType: ${serviceType}` });
    }

    res.json({ success: true, stopped });
  })
);

/**
 * POST /api/comfy-instances
 * Dynamically add a new ComfyUI instance at runtime
 */
comfyInstancesRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { url, name } = req.body as { url?: string; name?: string };
    if (!url || typeof url !== "string") {
      return res.status(400).json({ success: false, error: "url is required" });
    }
    const instance = comfyManager.addInstance(url.trim(), name?.trim());
    res.json({ success: true, instance });
  })
);

/**
 * DELETE /api/comfy-instances/:id
 * Remove a ComfyUI instance
 */
comfyInstancesRouter.delete(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!comfyManager.hasInstance(id)) {
      return res.status(404).json({ success: false, error: `Instance '${id}' not found` });
    }
    comfyManager.removeInstance(id);
    res.json({ success: true });
  })
);

export default comfyInstancesRouter;
