import { v4 as uuidv4 } from "uuid";

export type ServiceType =
  | "image-batch"
  | "banner-batch"
  | "batch"
  | "emotion-batch"
  | "emotion-pipeline";

export interface QueueEntry {
  entryId: string;
  jobId: string;
  serviceType: ServiceType;
  label: string;
  instanceId: string;
  onStart: () => Promise<void>;
  createdAt: Date;
}

export interface InstanceQueueStatus {
  running: QueueEntry | null;
  pending: QueueEntry[];
}

class InstanceQueueManager {
  private running = new Map<string, QueueEntry>();
  private queues = new Map<string, QueueEntry[]>();

  /**
   * Enqueue a job for a specific ComfyUI instance.
   * If the instance is idle, onStart is called immediately.
   * Returns the entryId for tracking.
   */
  enqueue(entry: Omit<QueueEntry, "entryId" | "createdAt">): string {
    const entryId = uuidv4();
    const full: QueueEntry = { ...entry, entryId, createdAt: new Date() };

    if (!this.running.has(entry.instanceId)) {
      this.running.set(entry.instanceId, full);
      this.runEntry(full);
      return entryId;
    }

    if (!this.queues.has(entry.instanceId)) {
      this.queues.set(entry.instanceId, []);
    }
    this.queues.get(entry.instanceId)!.push(full);
    console.log(
      `[QueueManager] Queued ${entry.serviceType}:${entry.jobId} on ${entry.instanceId} (${this.queues.get(entry.instanceId)!.length} pending)`
    );
    return entryId;
  }

  /**
   * Release the current lock on an instance and start the next queued entry.
   * Should be called by the service when its job finishes (success, fail, or stop).
   */
  release(instanceId: string): void {
    this.running.delete(instanceId);
    const queue = this.queues.get(instanceId);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      this.running.set(instanceId, next);
      console.log(
        `[QueueManager] Starting next: ${next.serviceType}:${next.jobId} on ${instanceId}`
      );
      this.runEntry(next);
    }
  }

  /**
   * Cancel a pending (not-yet-started) entry by entryId.
   * Returns true if found and removed.
   */
  cancel(entryId: string): boolean {
    for (const [instanceId, queue] of this.queues) {
      const idx = queue.findIndex((e) => e.entryId === entryId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        console.log(`[QueueManager] Cancelled entry ${entryId} on ${instanceId}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Cancel all pending entries for a specific jobId (across all instances).
   */
  cancelByJobId(jobId: string): number {
    let removed = 0;
    for (const queue of this.queues.values()) {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].jobId === jobId) {
          queue.splice(i, 1);
          removed++;
        }
      }
    }
    return removed;
  }

  /**
   * Get the running entry for an instance (or null if idle).
   */
  getRunningEntry(instanceId: string): QueueEntry | null {
    return this.running.get(instanceId) ?? null;
  }

  /**
   * Get status for a specific instance.
   */
  getInstanceStatus(instanceId: string): InstanceQueueStatus {
    return {
      running: this.running.get(instanceId) ?? null,
      pending: this.queues.get(instanceId) ?? [],
    };
  }

  /**
   * Get status for all known instances (those with running or pending entries).
   */
  getAllStatus(): Record<string, InstanceQueueStatus> {
    const result: Record<string, InstanceQueueStatus> = {};
    const allIds = new Set([...this.running.keys(), ...this.queues.keys()]);
    for (const id of allIds) {
      result[id] = this.getInstanceStatus(id);
    }
    return result;
  }

  /**
   * Clean up when an instance is removed (cancel all pending, clear running).
   */
  removeInstance(instanceId: string): void {
    this.running.delete(instanceId);
    this.queues.delete(instanceId);
  }

  private runEntry(entry: QueueEntry): void {
    console.log(
      `[QueueManager] Running ${entry.serviceType}:${entry.jobId} on ${entry.instanceId}`
    );
    entry
      .onStart()
      .catch((err) => {
        console.error(
          `[QueueManager] Error in ${entry.serviceType}:${entry.jobId}:`,
          err
        );
      })
      .finally(() => {
        this.release(entry.instanceId);
      });
  }
}

export const instanceQueueManager = new InstanceQueueManager();
