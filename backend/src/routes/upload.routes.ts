import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/errorHandler.js';
import { comfyService } from '../services/comfy.service.js';

export const uploadRouter = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed'));
      return;
    }
    cb(null, true);
  },
});

/**
 * Upload an image to ComfyUI
 * POST /api/upload/image
 */
uploadRouter.post('/image', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No image file provided'
    });
  }

  const subfolder = req.body.subfolder || '';
  const type = req.body.type || 'input';
  const overwrite = req.body.overwrite === 'true';

  const result = await comfyService.uploadImage(
    req.file.buffer,
    req.file.originalname,
    subfolder,
    type,
    overwrite
  );

  res.json({
    success: true,
    data: result
  });
}));
