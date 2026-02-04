import axios, { AxiosInstance } from "axios";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

// Ensure environment variables are loaded
dotenv.config();

export interface ComfyWorkflow {
  [key: string]: {
    inputs: any;
    class_type: string;
    _meta?: any;
  };
}

export interface QueuePromptResponse {
  prompt_id: string;
  number: number;
  node_errors?: any;
}

export interface HistoryResponse {
  [prompt_id: string]: {
    outputs: {
      [node_id: string]: {
        images?: Array<{
          filename: string;
          subfolder: string;
          type: string;
        }>;
        gifs?: Array<{
          filename: string;
          subfolder: string;
          type: string;
        }>;
      };
    };
    status: {
      status_str: string;
      completed: boolean;
    };
  };
}

class ComfyService {
  private apiUrl: string;
  private httpClient: AxiosInstance;
  private clientId: string;

  constructor() {
    this.apiUrl = process.env.COMFYUI_API_URL || "";

    if (!this.apiUrl) {
      console.warn("⚠️  COMFYUI_API_URL is not set in environment variables");
    }

    // Validate URL
    if (this.apiUrl) {
      try {
        new URL(this.apiUrl);
      } catch (error) {
        console.error(`❌ Invalid COMFYUI_API_URL: ${this.apiUrl}`);
        this.apiUrl = "";
      }
    }

    this.httpClient = axios.create({
      baseURL: this.apiUrl,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    });

    this.clientId = uuidv4();
  }

  /**
   * Queue a workflow for execution
   */
  async queuePrompt(workflow: ComfyWorkflow): Promise<QueuePromptResponse> {
    if (!this.apiUrl) {
      throw new Error(
        "ComfyUI API URL is not configured. Please set COMFYUI_API_URL in .env file"
      );
    }

    try {
      const response = await this.httpClient.post("/prompt", {
        prompt: workflow,
        client_id: this.clientId,
      });

      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      console.error("Queue prompt error:", {
        url: `${this.apiUrl}/prompt`,
        status: error.response?.status,
        message: errorMsg,
      });
      throw new Error(`Failed to queue prompt: ${errorMsg}`);
    }
  }

  /**
   * Get workflow execution history with retry logic
   */
  async getHistory(promptId?: string): Promise<HistoryResponse> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const url = promptId ? `/history/${promptId}` : "/history";
        const response = await this.httpClient.get(url);
        return response.data;
      } catch (error: any) {
        const statusCode = error.response?.status;
        const isRetryable =
          statusCode === 502 || statusCode === 503 || statusCode === 504;

        retryCount++;

        if (isRetryable && retryCount < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 5000); // Exponential backoff: 1s, 2s, 4s
          console.log(
            `⚠️ History request failed with ${statusCode}, retrying in ${waitTime}ms (${retryCount}/${maxRetries})...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          throw new Error(`Failed to get history: ${error.message}`);
        }
      }
    }

    throw new Error("Failed to get history after max retries");
  }

  /**
   * Get current queue status
   */
  async getQueue() {
    if (!this.apiUrl) {
      throw new Error(
        "ComfyUI API URL is not configured. Please set COMFYUI_API_URL in .env file"
      );
    }

    try {
      const response = await this.httpClient.get("/queue");
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      console.error("Get queue error:", {
        url: `${this.apiUrl}/queue`,
        status: error.response?.status,
        message: errorMsg,
      });
      throw new Error(`Failed to get queue: ${errorMsg}`);
    }
  }

  /**
   * Cancel a prompt in the queue
   */
  async cancelPrompt(promptId: string) {
    try {
      const response = await this.httpClient.post("/interrupt", {
        prompt_id: promptId,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to cancel prompt: ${error.message}`);
    }
  }

  /**
   * Get available object info (nodes, models, etc.)
   */
  async getObjectInfo() {
    try {
      const response = await this.httpClient.get("/object_info");
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get object info: ${error.message}`);
    }
  }

  /**
   * Get system stats
   */
  async getSystemStats() {
    try {
      const response = await this.httpClient.get("/system_stats");
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get system stats: ${error.message}`);
    }
  }

  /**
   * Download an image from ComfyUI
   */
  async getImage(
    filename: string,
    subfolder: string = "",
    type: string = "output"
  ): Promise<Buffer> {
    try {
      const params = new URLSearchParams({
        filename,
        subfolder,
        type,
      });

      const response = await this.httpClient.get(`/view?${params}`, {
        responseType: "arraybuffer",
      });

      return Buffer.from(response.data);
    } catch (error: any) {
      throw new Error(`Failed to get image: ${error.message}`);
    }
  }

  /**
   * Upload an image to ComfyUI
   */
  async uploadImage(
    imageBuffer: Buffer,
    filename: string,
    subfolder: string = "",
    type: string = "input",
    overwrite: boolean = true
  ): Promise<{ name: string; subfolder: string; type: string }> {
    if (!this.apiUrl) {
      throw new Error(
        "ComfyUI API URL is not configured. Please set COMFYUI_API_URL in .env file"
      );
    }

    try {
      const FormData = (await import("form-data")).default;
      const formData = new FormData();

      formData.append("image", imageBuffer, {
        filename: filename,
        contentType: "image/png",
      });

      if (subfolder) {
        formData.append("subfolder", subfolder);
      }

      formData.append("type", type);
      formData.append("overwrite", overwrite.toString());

      const response = await this.httpClient.post("/upload/image", formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      console.error("Upload image error:", {
        url: `${this.apiUrl}/upload/image`,
        status: error.response?.status,
        message: errorMsg,
      });
      throw new Error(`Failed to upload image: ${errorMsg}`);
    }
  }

  /**
   * Create a WebSocket connection to monitor progress
   */
  createWebSocket(
    onMessage: (data: any) => void,
    onError?: (error: Error) => void
  ) {
    if (!this.apiUrl) {
      console.error(
        "❌ Cannot create WebSocket: ComfyUI API URL is not configured"
      );
      if (onError) onError(new Error("ComfyUI API URL is not configured"));
      return null;
    }

    try {
      const wsUrl =
        this.apiUrl.replace("http", "ws").replace("https", "wss") +
        `/ws?clientId=${this.clientId}`;
      console.log("🔌 Attempting to connect WebSocket:", wsUrl);

      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        console.log("✅ WebSocket connected to ComfyUI");
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const dataStr = data.toString();
          // Skip non-JSON messages (ComfyUI sometimes sends plain text)
          if (!dataStr.startsWith("{") && !dataStr.startsWith("[")) {
            return;
          }
          const message = JSON.parse(dataStr);
          onMessage(message);
        } catch (error) {
          // Silently ignore parsing errors for non-JSON messages
          // This is normal behavior for ComfyUI WebSocket
        }
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        if (onError) onError(error);
      });

      ws.on("close", () => {
        console.log("WebSocket disconnected");
      });

      return ws;
    } catch (error: any) {
      console.error("❌ Failed to create WebSocket:", error);
      if (onError) onError(error);
      return null;
    }
  }

  /**
   * Execute a workflow and wait for completion
   */
  async executeWorkflow(workflow: ComfyWorkflow): Promise<{
    prompt_id: string;
    outputs: any;
  }> {
    // Queue the workflow
    const queueResponse = await this.queuePrompt(workflow);
    const promptId = queueResponse.prompt_id;

    // Check for node errors immediately after queueing
    if (
      queueResponse.node_errors &&
      Object.keys(queueResponse.node_errors).length > 0
    ) {
      console.error(
        "❌ Workflow has node errors:",
        JSON.stringify(queueResponse.node_errors, null, 2)
      );
      throw new Error(
        `Workflow validation failed: ${JSON.stringify(
          queueResponse.node_errors
        )}`
      );
    }

    console.log(`✅ Workflow queued successfully: ${promptId}`);

    // Poll for completion
    return new Promise((resolve, reject) => {
      const maxAttempts = 60; // 5 minutes with 5 second intervals
      let attempts = 0;

      const checkStatus = async () => {
        attempts++;

        try {
          const history = await this.getHistory(promptId);

          if (history[promptId]) {
            const status = history[promptId].status;
            const outputs = history[promptId].outputs;

            console.log(
              `📊 [Attempt ${attempts}] Status check for ${promptId}:`,
              JSON.stringify({
                completed: status.completed,
                status_str: status.status_str,
                hasOutputs: !!outputs,
                outputNodes: outputs ? Object.keys(outputs) : [],
              })
            );

            // Check for errors
            if (status.status_str === "error") {
              console.error(`❌ Workflow execution failed with error status`);
              reject(
                new Error(`Workflow execution failed: ${status.status_str}`)
              );
              return;
            }

            if (status.completed) {
              // Check if we actually have video output (MKV only - node 828)
              const has828 =
                outputs?.["828"]?.gifs && outputs["828"].gifs.length > 0;

              if (has828 && outputs) {
                console.log(
                  `✅ Workflow truly completed with video output (828 MKV: ${outputs["828"]?.gifs?.[0]?.filename})`
                );
                resolve({
                  prompt_id: promptId,
                  outputs: outputs,
                });
                return;
              } else {
                console.log(
                  `⏳ Workflow marked complete but MKV not ready (828: ${!!has828}), waiting...`
                );
              }
            }
          } else {
            console.log(
              `⏳ [Attempt ${attempts}] No history found for ${promptId} yet`
            );

            // After 10 attempts, check the queue to see if workflow is still pending
            if (attempts === 10) {
              try {
                const queue = await this.getQueue();
                const isInQueue =
                  queue.queue_running.some(
                    (item: any) => item[1] === promptId
                  ) ||
                  queue.queue_pending.some((item: any) => item[1] === promptId);

                if (!isInQueue) {
                  console.error(
                    `❌ Workflow ${promptId} not found in queue and no history - may have failed silently`
                  );
                  reject(
                    new Error(
                      `Workflow ${promptId} disappeared from queue without creating history entry`
                    )
                  );
                  return;
                }
                console.log(
                  `📋 Workflow ${promptId} is still in queue, continuing to wait...`
                );
              } catch (queueError) {
                console.error(`⚠️ Failed to check queue status:`, queueError);
              }
            }
          }

          if (attempts >= maxAttempts) {
            reject(new Error("Workflow execution timeout"));
            return;
          }

          // Check again in 5 seconds
          setTimeout(checkStatus, 5000);
        } catch (error) {
          reject(error);
        }
      };

      // Start checking after 2 seconds
      setTimeout(checkStatus, 2000);
    });
  }

  /**
   * Get the base URL for the ComfyUI API
   */
  getApiUrl(): string {
    return this.apiUrl;
  }

  /**
   * Get the client ID
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * Download and save video file from ComfyUI to local path
   */
  async downloadAndSaveVideo(
    filename: string,
    outputPath: string,
    subfolder: string = "",
    type: string = "output"
  ): Promise<void> {
    if (!this.apiUrl) {
      throw new Error(
        "ComfyUI API URL is not configured. Please set COMFYUI_API_URL in .env file"
      );
    }

    try {
      // Construct URL
      const params = new URLSearchParams({
        filename,
        subfolder,
        type,
      });
      const url = `/view?${params.toString()}`;

      // Download file
      const response = await this.httpClient.get(url, {
        responseType: "arraybuffer",
      });

      // Write to file
      const fs = await import("fs/promises");
      await fs.writeFile(outputPath, Buffer.from(response.data));

      console.log(`✅ Video saved: ${outputPath}`);
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      console.error("Download video error:", {
        url: `${this.apiUrl}/view`,
        filename,
        message: errorMsg,
      });
      throw new Error(`Failed to download video: ${errorMsg}`);
    }
  }
}

export const comfyService = new ComfyService();
