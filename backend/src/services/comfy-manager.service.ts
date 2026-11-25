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
  /** How this instance is reached. Defaults to "proxy" for direct URLs. */
  connectionType?: "proxy" | "ssh-tunnel";
  /** SSH target for display when connectionType is "ssh-tunnel" (e.g. user@ssh.runpod.io) */
  sshTarget?: string | null;
  /** Remote ComfyUI port forwarded through the tunnel (e.g. 8188) */
  remotePort?: string | null;
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
   * Instances are registered at runtime from the Pod Dashboard.
   * .env COMFYUI_API_URL_* seeds are no longer loaded.
   */
  private loadInstances() {
    console.log(
      "📡 ComfyUI instances: none at startup (register from Pod Dashboard)",
    );
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
  addInstance(
    url: string,
    name?: string,
    meta?: {
      connectionType?: "proxy" | "ssh-tunnel";
      podId?: string | null;
      sshTarget?: string | null;
      remotePort?: string | null;
    },
  ): ComfyInstance {
    let maxN = 0;
    for (const id of this.instances.keys()) {
      const m = id.match(/^comfy(\d+)$/);
      if (m) maxN = Math.max(maxN, Number(m[1]));
    }
    const id = `comfy${maxN + 1}`;
    const podId =
      meta?.podId !== undefined
        ? meta.podId
        : runPodService.extractPodIdFromUrl(url);
    const port = runPodService.extractPortFromRunPodUrl(url);
    const displayName = name || `ComfyUI Pod ${maxN + 1}`;

    this.instances.set(id, new ComfyService(url, id));
    const info: ComfyInstance = {
      id,
      url,
      name: displayName,
      podId,
      port,
      connectionType: meta?.connectionType ?? "proxy",
      sshTarget: meta?.sshTarget ?? null,
      remotePort: meta?.remotePort ?? null,
    };
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
