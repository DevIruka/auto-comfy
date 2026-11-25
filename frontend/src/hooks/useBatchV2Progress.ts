import { useState, useEffect, useRef } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3002/ws";

export interface BatchV2Progress {
  jobId: string | null;
  status: string;
  currentImage: string;
  currentImageIndex: number;
  totalImages: number;
  currentVideoIndex: number;
  totalVideos: number;
  overallProgress: number;
}

export function useBatchV2Progress() {
  const [progress, setProgress] = useState<BatchV2Progress>({
    jobId: null,
    status: "idle",
    currentImage: "",
    currentImageIndex: 0,
    totalImages: 0,
    currentVideoIndex: 0,
    totalVideos: 0,
    overallProgress: 0,
  });
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const connect = () => {
    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "batch_v2_progress") {
            setProgress((prev) => ({
              ...prev,
              jobId: message.jobId,
              status: message.status,
              currentImage: message.currentImage,
              currentImageIndex: message.currentImageIndex,
              totalImages: message.totalImages,
              currentVideoIndex: message.currentVideoIndex,
              totalVideos: message.totalVideos ?? 0,
              overallProgress: message.overallProgress,
            }));
          }

          if (message.type === "batch_v2_completed") {
            setProgress((prev) => ({
              ...prev,
              status: "completed",
              overallProgress: 100,
            }));
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        const maxAttempts = 5;
        if (reconnectAttemptsRef.current < maxAttempts) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000,
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { progress, isConnected };
}
