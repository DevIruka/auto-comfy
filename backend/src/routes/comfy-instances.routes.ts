import { Router, Request, Response } from "express";
import { comfyManager } from "../services/comfy-manager.service.js";
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
