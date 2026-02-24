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

export default comfyInstancesRouter;
