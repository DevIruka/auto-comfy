import { useState, useEffect, useRef } from "react";

interface ComfyMessage {
  type: string;
  data: {
    value?: number;
    max?: number;
    node?: string;
    prompt_id?: string;
    sid?: string;
  };
}

export function useComfyProgress() {
  const [progress, setProgress] = useState(0);
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsUrl = import.meta.env.VITE_WS_URL || "ws://localhost:3002/ws";

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("✅ WebSocket connected");
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const message: ComfyMessage = JSON.parse(event.data);

          if (message.type === "progress") {
            const { value = 0, max = 100 } = message.data;
            const progressPercent = max > 0 ? (value / max) * 100 : 0;
            setProgress(progressPercent);
          } else if (message.type === "executing") {
            const node = message.data.node;
            if (node) {
              setCurrentNode(node);
            } else {
              // Execution finished
              setCurrentNode(null);
              setProgress(100);
            }
          } else if (message.type === "executed") {
            // Node execution completed
            console.log("Node executed:", message.data.node);
          }
        } catch (error) {
          console.error("WebSocket message parse error:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("❌ WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("🔌 WebSocket disconnected");
        setIsConnected(false);
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const resetProgress = () => {
    setProgress(0);
    setCurrentNode(null);
  };

  return {
    progress,
    currentNode,
    isConnected,
    resetProgress,
  };
}
