import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createServer } from "http";
import { comfyRouter } from "./routes/comfy.routes.js";
import { uploadRouter } from "./routes/upload.routes.js";
import { batchRouter } from "./routes/batch.routes.js";
import emotionBatchRouter from "./routes/emotion-batch.routes.js";
import comfyInstancesRouter from "./routes/comfy-instances.routes.js";
import imageGenRouter from "./routes/image-gen.routes.js";
import imageBatchRouter from "./routes/image-batch.routes.js";
import { setupWebSocket } from "./routes/websocket.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5174";

// Middleware
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/comfy", comfyRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/batch", batchRouter);
app.use("/api/emotion-batch", emotionBatchRouter);
app.use("/api/comfy-instances", comfyInstancesRouter);
app.use("/api/image-gen", imageGenRouter);
app.use("/api/image-batch", imageBatchRouter);

// Error handling
app.use(errorHandler);

// Create HTTP server and setup WebSocket
const server = createServer(app);
setupWebSocket(server);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📡 ComfyUI API: ${process.env.COMFYUI_API_URL}`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log(`🔌 WebSocket available at ws://localhost:${PORT}/ws`);
});
