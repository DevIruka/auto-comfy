/**
 * Track RunPod usage across multiple jobs to prevent premature shutdown
 */
class PodUsageTrackerService {
  // Map: podId -> count of active jobs using this pod
  private activePods: Map<string, number> = new Map();

  /**
   * Register that a job is starting to use a pod
   */
  acquire(podId: string): void {
    const currentCount = this.activePods.get(podId) || 0;
    this.activePods.set(podId, currentCount + 1);
    console.log(`📊 Pod ${podId} usage count: ${currentCount + 1}`);
  }

  /**
   * Register that a job has finished using a pod
   * Returns true if the pod can be safely stopped (no other jobs using it)
   */
  release(podId: string): boolean {
    const currentCount = this.activePods.get(podId) || 0;
    
    if (currentCount <= 1) {
      // Last job using this pod
      this.activePods.delete(podId);
      console.log(`✅ Pod ${podId} can be safely stopped (no other jobs using it)`);
      return true;
    } else {
      // Other jobs still using this pod
      this.activePods.set(podId, currentCount - 1);
      console.log(`⚠️ Pod ${podId} still in use by ${currentCount - 1} other job(s) - NOT stopping`);
      return false;
    }
  }

  /**
   * Get current usage count for a pod
   */
  getUsageCount(podId: string): number {
    return this.activePods.get(podId) || 0;
  }

  /**
   * Check if a pod is currently in use
   */
  isInUse(podId: string): boolean {
    return this.getUsageCount(podId) > 0;
  }
}

export const podUsageTracker = new PodUsageTrackerService();
