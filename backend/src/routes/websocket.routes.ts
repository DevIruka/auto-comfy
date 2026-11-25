import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { comfyService } from "../services/comfy.service.js";
import { batchService } from "../services/batch.service.js";
import { batchV2Service } from "../services/batch-v2.service.js";
import { emotionBatchService } from "../services/emotion-batch.service.js";
import { imageBatchService } from "../services/image-batch.service.js";
import { bannerBatchService } from "../services/banner-batch.service.js";
import { anchorImageService } from "../services/anchor-image.service.js";

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
  });

  // Setup batch service broadcast callback (pose batch)
  batchService.setBroadcastCallback((jobId: string, data: any) => {
    // Broadcast to all connected clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  batchV2Service.setBroadcastCallback((_jobId: string, data: unknown) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  // Setup image batch service broadcast callback
  imageBatchService.setBroadcastCallback((_jobId: string, data: unknown) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  // Setup banner batch service broadcast callback
  bannerBatchService.setBroadcastCallback((_jobId: string, data: unknown) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  anchorImageService.setBroadcastCallback((_jobId: string, data: unknown) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  // Setup emotion batch service broadcast callback
  emotionBatchService.setBroadcastCallback((jobId: string, data: any) => {
    // Broadcast to all connected clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    console.log("🔌 Frontend WebSocket client connected");

    let comfyWs: WebSocket | null = null;

    // Only create ComfyUI WebSocket if legacy single API URL is configured
    const apiUrl = process.env.COMFYUI_API_URL;
    if (apiUrl) {
      comfyWs = comfyService.createWebSocket(
        (message) => {
          // Forward ComfyUI messages to frontend
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
          }
        },
        (error) => {
          console.error("ComfyUI WebSocket error:", error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                data: { message: error.message },
              })
            );
          }
        }
      );
    }
    // Note: For multi-instance setup (COMFYUI_API_URL_1, _2, etc.),
    // WebSocket connections are created per-job by each ComfyService instance.
    // No global WebSocket connection is needed.

    ws.on("message", (message) => {
      console.log("Received from frontend:", message.toString());
    });

    ws.on("close", () => {
      console.log("🔌 Frontend WebSocket client disconnected");
      if (comfyWs && comfyWs.readyState === WebSocket.OPEN) {
        comfyWs.close();
      }
    });

    ws.on("error", (error) => {
      console.error("Frontend WebSocket error:", error);
    });
  });

  console.log("🔌 WebSocket server initialized on /ws");
}
