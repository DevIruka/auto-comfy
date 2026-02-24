import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * Simple RunPod service for stopping pods after batch completion
 */
class RunPodService {
  private apiKey: string;
  private httpClient: AxiosInstance;

  constructor() {
    this.apiKey = process.env.RUNPOD_API_KEY || "";

    if (!this.apiKey) {
      console.warn("⚠️ RUNPOD_API_KEY not set in .env");
    }

    this.httpClient = axios.create({
      baseURL: "https://rest.runpod.io/v1",
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  /**
   * Extract Pod ID from ComfyUI URL
   * Example: https://sxfk3cvhn9zjr6-8188.proxy.runpod.net → sxfk3cvhn9zjr6
   */
  extractPodIdFromUrl(comfyUrl: string): string | null {
    try {
      const match = comfyUrl.match(
        /https?:\/\/([a-z0-9]+)-\d+\.proxy\.runpod\.net/i,
      );
      return match ? match[1] : null;
    } catch (error) {
      console.error("Failed to extract Pod ID from URL:", error);
      return null;
    }
  }

  /**
   * Stop a RunPod pod
   */
  async stopPod(podId: string): Promise<boolean> {
    if (!this.apiKey) {
      console.warn("⚠️ Cannot stop pod: RUNPOD_API_KEY not configured");
      return false;
    }

    try {
      console.log(`🛑 Stopping RunPod: ${podId}`);

      const response = await this.httpClient.post(
        `/pods/${podId}/stop`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
      );

      if (response.data?.status === "success" || response.status === 200) {
        console.log(`✅ RunPod stopped successfully: ${podId}`);
        return true;
      } else {
        console.warn(
          `⚠️ Unexpected response when stopping pod ${podId}:`,
          response.data,
        );
        return false;
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message;
      console.error(`❌ Failed to stop RunPod ${podId}:`, errorMsg);
      return false;
    }
  }

  /**
   * Stop pod by ComfyUI URL
   */
  async stopPodByComfyUrl(comfyUrl: string): Promise<boolean> {
    const podId = this.extractPodIdFromUrl(comfyUrl);
    if (!podId) {
      console.warn(`⚠️ Could not extract Pod ID from URL: ${comfyUrl}`);
      return false;
    }

    return await this.stopPod(podId);
  }
}

export const runPodService = new RunPodService();
