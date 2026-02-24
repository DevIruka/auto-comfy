import { useState, useEffect, useRef } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3002/ws";

export interface EmotionBatchProgress {
  jobId: string | null;
  status: string;
  currentImage: string;
  currentImageIndex: number;
  totalImages: number;
  currentVideoIndex: number;
  totalVideos: number;
  overallProgress: number;
  currentVideoProgress: number;
  currentVideoProgressMax: number;
}

export function useEmotionBatchProgress() {
  const [progress, setProgress] = useState<EmotionBatchProgress>({
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
    null
  );
  const reconnectAttemptsRef = useRef(0);

  const connect = () => {
    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("🔌 EmotionBatchProgress WebSocket connected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Handle emotion batch progress messages
          if (message.type === "emotion_batch_progress") {
            setProgress((prev) => ({
              ...prev,
              jobId: message.jobId,
              status: message.status,
              currentImage: message.currentImage,
              currentImageIndex: message.currentImageIndex,
              totalImages: message.totalImages,
              currentVideoIndex: message.currentVideoIndex,
              totalVideos: message.totalVideos,
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

          // Handle emotion batch completed
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
        console.error("EmotionBatchProgress WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("🔌 EmotionBatchProgress WebSocket disconnected");
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff
        const maxAttempts = 10;
        if (reconnectAttemptsRef.current < maxAttempts) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectAttemptsRef.current++;
          console.log(
            `🔄 Reconnecting in ${delay / 1000}s (attempt ${
              reconnectAttemptsRef.current
            }/${maxAttempts})...`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }
  };

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

  return { progress, isConnected, resetProgress };
}
