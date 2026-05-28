import { useState, useEffect, useRef } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3002/ws";

export interface BatchProgress {
  jobId: string | null;
  status: string;
  currentImage: string;
  currentImageIndex: number;
  totalImages: number;
  currentVideoIndex: number;
  totalVideos: number;
  overallProgress: number;
  currentVideoProgress: number; // 현재 영상의 진행률 (0-100)
  currentVideoProgressMax: number; // 현재 영상의 최대값
}

export function useBatchProgress() {
  const [progress, setProgress] = useState<BatchProgress>({
    jobId: null,
    status: "idle",
    currentImage: "",
    currentImageIndex: 0,
    totalImages: 0,
    currentVideoIndex: 0,
    totalVideos: 0,
    overallProgress: 0,
    currentVideoProgress: 0,
    currentVideoProgressMax: 0,
  });
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectAttemptsRef = useRef(0);

  const connect = () => {
    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("🔌 BatchProgress WebSocket connected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle batch progress messages
          if (message.type === "batch_progress") {
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
              // Reset video progress when starting new video
              currentVideoProgress: 0,
              currentVideoProgressMax: 0,
            }));
          }

          // Handle ComfyUI progress messages (individual video generation)
          if (message.type === "progress" && message.data) {
            const value = message.data.value || 0;
            const max = message.data.max || 100;
            setProgress((prev) => ({
              ...prev,
              currentVideoProgress: value,
              currentVideoProgressMax: max,
            }));
          }

          // Handle batch completed
          if (message.type === "batch_completed") {
            setProgress((prev) => ({
              ...prev,
              status: "completed",
              overallProgress: 100,
            }));
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("BatchProgress WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("🔌 BatchProgress WebSocket disconnected");
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff
        const maxAttempts = 5;
        if (reconnectAttemptsRef.current < maxAttempts) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000,
          );
          console.log(
            `Attempting to reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxAttempts})`,
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }
  };

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const resetProgress = () => {
    setProgress({
      jobId: null,
      status: "idle",
      currentImage: "",
      currentImageIndex: 0,
      totalImages: 0,
      currentVideoIndex: 0,
      totalVideos: 0,
      overallProgress: 0,
      currentVideoProgress: 0,
      currentVideoProgressMax: 0,
    });
  };

  return {
    progress,
    isConnected,
    resetProgress,
  };
}
