import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { comfyService } from "../services/comfy.service.js";
import { batchService } from "../services/batch.service.js";

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
  });

  // Setup batch service broadcast callback
  batchService.setBroadcastCallback((jobId: string, data: any) => {
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

    // Only create ComfyUI WebSocket if API URL is configured
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
              }),
            );
          }
        },
      );
    } else {
      console.warn(
        "⚠️ ComfyUI WebSocket not initialized: API URL not configured",
      );
    }

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
