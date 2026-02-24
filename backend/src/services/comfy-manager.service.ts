import { ComfyService } from "./comfy.service.js";

export interface ComfyInstance {
  id: string;
  url: string;
  name: string;
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

    // Check for numbered instances
    for (let i = 1; i <= 10; i++) {
      const url = env[`COMFYUI_API_URL_${i}`];
      if (url) {
        const id = `comfy${i}`;
        const name = env[`COMFYUI_NAME_${i}`] || `ComfyUI Pod ${i}`;

        this.instances.set(id, new ComfyService(url, id));
        this.instanceInfo.set(id, { id, url, name });
        count++;
        console.log(`✅ Loaded ComfyUI instance: ${name} (${id}) - ${url}`);
      }
    }

    // Also support legacy single URL
    if (env.COMFYUI_API_URL && count === 0) {
      const id = "comfy1";
      const name = "ComfyUI Default";
      const url = env.COMFYUI_API_URL;

      this.instances.set(id, new ComfyService(url, id));
      this.instanceInfo.set(id, { id, url, name });
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
}

export const comfyManager = new ComfyManagerService();
