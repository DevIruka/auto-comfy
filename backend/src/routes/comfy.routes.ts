import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { comfyService } from '../services/comfy.service.js';

export const comfyRouter = Router();

/**
 * Queue a workflow for execution
 * POST /api/comfy/queue
 */
comfyRouter.post('/queue', asyncHandler(async (req: Request, res: Response) => {
  const { workflow } = req.body;

  if (!workflow) {
    return res.status(400).json({
      success: false,
      error: 'Workflow is required'
    });
  }

  const result = await comfyService.queuePrompt(workflow);

  res.json({
    success: true,
    data: result
  });
}));

/**
 * Execute a workflow and wait for completion
 * POST /api/comfy/execute
 */
comfyRouter.post('/execute', asyncHandler(async (req: Request, res: Response) => {
  const { workflow } = req.body;

  if (!workflow) {
    return res.status(400).json({
      success: false,
      error: 'Workflow is required'
    });
  }

  const result = await comfyService.executeWorkflow(workflow);

  res.json({
    success: true,
    data: result
  });
}));

/**
 * Get workflow execution history
 * GET /api/comfy/history/:promptId?
 */
comfyRouter.get('/history/:promptId?', asyncHandler(async (req: Request, res: Response) => {
  const { promptId } = req.params;
  const history = await comfyService.getHistory(promptId);

  res.json({
    success: true,
    data: history
  });
}));

/**
 * Get current queue status
 * GET /api/comfy/queue
 */
comfyRouter.get('/queue', asyncHandler(async (req: Request, res: Response) => {
  const queue = await comfyService.getQueue();

  res.json({
    success: true,
    data: queue
  });
}));

/**
 * Cancel a prompt
 * POST /api/comfy/cancel
 */
comfyRouter.post('/cancel', asyncHandler(async (req: Request, res: Response) => {
  const { promptId } = req.body;

  if (!promptId) {
    return res.status(400).json({
      success: false,
      error: 'Prompt ID is required'
    });
  }

  const result = await comfyService.cancelPrompt(promptId);

  res.json({
    success: true,
    data: result
  });
}));

/**
 * Get available nodes and models
 * GET /api/comfy/object-info
 */
comfyRouter.get('/object-info', asyncHandler(async (req: Request, res: Response) => {
  const objectInfo = await comfyService.getObjectInfo();

  res.json({
    success: true,
    data: objectInfo
  });
}));

/**
 * Get system stats
 * GET /api/comfy/system-stats
 */
comfyRouter.get('/system-stats', asyncHandler(async (req: Request, res: Response) => {
  const stats = await comfyService.getSystemStats();

  res.json({
    success: true,
    data: stats
  });
}));

/**
 * Get an image
 * GET /api/comfy/image
 */
comfyRouter.get('/image', asyncHandler(async (req: Request, res: Response) => {
  const { filename, subfolder = '', type = 'output' } = req.query;

  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Filename is required'
    });
  }

  const imageBuffer = await comfyService.getImage(
    filename,
    subfolder as string,
    type as string
  );

  // Determine content type based on file extension
  const ext = filename.toLowerCase().split('.').pop();
  const contentType = ext === 'png' ? 'image/png' : 
                     ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 
                     ext === 'webp' ? 'image/webp' : 
                     'application/octet-stream';

  res.set('Content-Type', contentType);
  res.send(imageBuffer);
}));

/**
 * Get ComfyUI API info
 * GET /api/comfy/info
 */
comfyRouter.get('/info', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      apiUrl: comfyService.getApiUrl(),
      clientId: comfyService.getClientId()
    }
  });
}));
