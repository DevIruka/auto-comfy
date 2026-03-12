import { ComfyService } from "./comfy.service.js";
import { runPodService } from "./runpod.service.js";
import { instanceQueueManager } from "./instance-queue-manager.service.js";

export interface ComfyInstance {
  id: string;
  url: string;
  name: string;
  /** RunPod pod ID when URL is RunPod proxy (e.g. sxfk3cvhn9zjr6) */
  podId: string | null;
  /** Port from URL when RunPod proxy (e.g. 8188, 8189) */
  port: string | null;
}

/**
 * Manages multiple ComfyUI instances
 */
class ComfyManagerService {
  private instances: Map<string, ComfyService> = new Map();
  private instanceInfo: Map<string, ComfyInstance> = new Map();

  constructor() {
    this.loadInstances();
  }

  /**
   * Load ComfyUI instances from environment variables
   * Looks for COMFYUI_API_URL_1, COMFYUI_API_URL_2, etc.
   */
  private loadInstances() {
    const env = process.env;
    let count = 0;

    // Check for numbered instances (up to 20 for multi-GPU per pod)
    for (let i = 1; i <= 20; i++) {
      const url = env[`COMFYUI_API_URL_${i}`];
      if (url) {
        const id = `comfy${i}`;
        const name = env[`COMFYUI_NAME_${i}`] || `ComfyUI Pod ${i}`;
        const podId = runPodService.extractPodIdFromUrl(url);
        const port = runPodService.extractPortFromRunPodUrl(url);

        this.instances.set(id, new ComfyService(url, id));
        this.instanceInfo.set(id, { id, url, name, podId, port });
        count++;
        console.log(`✅ Loaded ComfyUI instance: ${name} (${id}) - ${url}`);
      }
    }

    // Also support legacy single URL
    if (env.COMFYUI_API_URL && count === 0) {
      const id = "comfy1";
      const name = "ComfyUI Default";
      const url = env.COMFYUI_API_URL;
      const podId = runPodService.extractPodIdFromUrl(url);
      const port = runPodService.extractPortFromRunPodUrl(url);

      this.instances.set(id, new ComfyService(url, id));
      this.instanceInfo.set(id, { id, url, name, podId, port });
      count++;
      console.log(`✅ Loaded ComfyUI instance: ${name} (${id}) - ${url}`);
    }

    if (count === 0) {
      console.warn("⚠️  No ComfyUI instances configured");
    } else {
      console.log(`📡 Total ComfyUI instances loaded: ${count}`);
    }
  }

  /**
   * Get a specific ComfyUI instance
   */
  getInstance(instanceId: string): ComfyService {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`ComfyUI instance '${instanceId}' not found`);
    }
    return instance;
  }

  /**
   * Get all ComfyUI instances info
   */
  getAllInstances(): ComfyInstance[] {
    return Array.from(this.instanceInfo.values());
  }

  /**
   * Check if an instance exists
   */
  hasInstance(instanceId: string): boolean {
    return this.instances.has(instanceId);
  }

  /**
   * Get default instance (first available)
   */
  getDefaultInstance(): ComfyService {
    const firstId = Array.from(this.instances.keys())[0];
    if (!firstId) {
      throw new Error("No ComfyUI instances available");
    }
    return this.getInstance(firstId);
  }

  /**
   * Get default instance ID
   */
  getDefaultInstanceId(): string {
    const firstId = Array.from(this.instances.keys())[0];
    if (!firstId) {
      throw new Error("No ComfyUI instances available");
    }
    return firstId;
  }

  /**
   * Dynamically add a new ComfyUI instance at runtime (no server restart needed).
   * Returns the auto-assigned instance ID.
   */
  addInstance(url: string, name?: string): ComfyInstance {
    let maxN = 0;
    for (const id of this.instances.keys()) {
      const m = id.match(/^comfy(\d+)$/);
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
    const id = `comfy${maxN + 1}`;
    const podId = runPodService.extractPodIdFromUrl(url);
    const port = runPodService.extractPortFromRunPodUrl(url);
    const displayName = name || `ComfyUI Pod ${maxN + 1}`;

    this.instances.set(id, new ComfyService(url, id));
    const info: ComfyInstance = { id, url, name: displayName, podId, port };
    this.instanceInfo.set(id, info);
    console.log(`✅ Dynamically added ComfyUI instance: ${displayName} (${id}) - ${url}`);
    return info;
  }

  /**
   * Remove a dynamically added instance. Throws if the instance doesn't exist.
   */
  removeInstance(instanceId: string): void {
    if (!this.instances.has(instanceId)) {
      throw new Error(`ComfyUI instance '${instanceId}' not found`);
    }
    this.instances.delete(instanceId);
    this.instanceInfo.delete(instanceId);
    instanceQueueManager.removeInstance(instanceId);
    console.log(`🗑️ Removed ComfyUI instance: ${instanceId}`);
  }
}

export const comfyManager = new ComfyManagerService();
