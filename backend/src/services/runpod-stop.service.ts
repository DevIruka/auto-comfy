import { execFile } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";
import { comfyManager } from "./comfy-manager.service.js";
import { instanceQueueManager } from "./instance-queue-manager.service.js";
import { runPodService } from "./runpod.service.js";

const execFileAsync = promisify(execFile);

export interface RunPodStopJob {
  id: string;
  entryId: string;
  instanceId: string;
  podId: string;
  shutdownPc: boolean;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  createdAt: Date;
  finishedAt?: Date;
  logs: string[];
}

export interface ScheduleStopResult {
  jobId: string;
  entryId: string;
  queued: "running" | "pending";
}

class RunPodStopService {
  private jobs: Map<string, RunPodStopJob> = new Map();

  private addLog(job: RunPodStopJob, message: string) {
    const line = `[${new Date().toISOString()}] ${message}`;
    job.logs.push(line);
    console.log(`[RunPodStop] ${message}`);
  }

  /**
   * Schedule a RunPod stop on the given instance's queue.
   * Resolves the pod ID from the request or the instance metadata.
   */
  scheduleStop(params: {
    instanceId: string;
    podId?: string;
    shutdownPc?: boolean;
  }): ScheduleStopResult {
    const { instanceId } = params;

    if (!comfyManager.hasInstance(instanceId)) {
      throw new Error(`ComfyUI instance '${instanceId}' not found`);
    }

    const info = comfyManager
      .getAllInstances()
      .find((i) => i.id === instanceId);

    const podId = (params.podId?.trim() || info?.podId || "").trim();
    if (!podId || podId === "root") {
      throw new Error(
        "이 인스턴스의 Pod ID를 확인할 수 없습니다. 탭에서 Pod ID를 직접 입력해 주세요.",
      );
    }

    if (!process.env.RUNPOD_API_KEY) {
      throw new Error(
        "RUNPOD_API_KEY가 설정되지 않아 Pod를 종료할 수 없습니다. 백엔드 .env를 확인하세요.",
      );
    }

    const jobId = uuidv4();
    const job: RunPodStopJob = {
      id: jobId,
      entryId: "",
      instanceId,
      podId,
      shutdownPc: params.shutdownPc === true,
      status: "pending",
      createdAt: new Date(),
      logs: [],
    };
    this.jobs.set(jobId, job);
    this.addLog(
      job,
      `RunPod 종료 예약: instance=${instanceId}, pod=${podId}${
        job.shutdownPc ? ", PC 자동 종료" : ""
      }`,
    );

    const wasIdle =
      instanceQueueManager.getRunningEntry(instanceId) === null;

    const entryId = instanceQueueManager.enqueue({
      jobId,
      serviceType: "runpod-stop",
      label: `RunPod 종료 (${podId})`,
      instanceId,
      onStart: () => this.runStop(jobId),
    });

    job.entryId = entryId;

    return {
      jobId,
      entryId,
      queued: wasIdle ? "running" : "pending",
    };
  }

  /**
   * Executed by the queue manager when the instance is free.
   * Note: the queue manager calls release() automatically after this resolves,
   * so we must NOT call release() here.
   */
  private async runStop(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = "running";
    this.addLog(job, "RunPod 종료 실행 시작");

    try {
      if (this.isPodBusyElsewhere(job.instanceId, job.podId)) {
        job.status = "skipped";
        job.finishedAt = new Date();
        this.addLog(
          job,
          "동일 Pod를 사용하는 다른 작업이 남아 있어 종료를 건너뜁니다.",
        );
        return;
      }

      const stopped = await runPodService.stopPod(job.podId);
      job.finishedAt = new Date();
      if (stopped) {
        job.status = "completed";
        this.addLog(job, "RunPod을 정상적으로 종료했습니다.");
        if (job.shutdownPc) {
          await this.schedulePcShutdown(job);
        }
      } else {
        job.status = "failed";
        this.addLog(job, "RunPod 종료에 실패했습니다. (로그 확인)");
      }
    } catch (error: any) {
      job.status = "failed";
      job.finishedAt = new Date();
      this.addLog(job, `RunPod 종료 중 오류: ${error?.message ?? error}`);
    }
  }

  /**
   * Check whether the same pod is still used by other instances that have
   * running or pending (non-stop) work. Prevents shutting down a multi-GPU pod
   * while sibling instances are still processing.
   */
  private isPodBusyElsewhere(instanceId: string, podId: string): boolean {
    const siblingIds = comfyManager
      .getAllInstances()
      .filter((i) => i.id !== instanceId && i.podId === podId)
      .map((i) => i.id);

    if (siblingIds.length === 0) return false;

    const allStatus = instanceQueueManager.getAllStatus();
    for (const sid of siblingIds) {
      const status = allStatus[sid];
      if (!status) continue;
      if (status.running && status.running.serviceType !== "runpod-stop") {
        return true;
      }
      if (
        status.pending.some((e) => e.serviceType !== "runpod-stop")
      ) {
        return true;
      }
    }
    return false;
  }

  /** After a successful stopPod, schedule a Windows shutdown in 5 minutes. */
  private async schedulePcShutdown(job: RunPodStopJob): Promise<void> {
    if (process.platform !== "win32") {
      this.addLog(
        job,
        "이 OS에서는 PC 자동 종료를 지원하지 않아 건너뜁니다.",
      );
      return;
    }

    try {
      await execFileAsync("shutdown", ["/s", "/t", "300"]);
      this.addLog(job, "5분 후 이 PC 종료를 예약했습니다.");
    } catch (error: any) {
      this.addLog(
        job,
        `PC 종료 예약에 실패했습니다: ${error?.message ?? error}`,
      );
    }
  }

  /** Called from the dashboard stop switch. Running stop jobs cannot be aborted. */
  stopJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.addLog(job, "실행 중인 RunPod 종료 작업은 중단할 수 없습니다.");
  }

  getJob(jobId: string): RunPodStopJob | undefined {
    return this.jobs.get(jobId);
  }

  getRecentJobs(limit = 20): RunPodStopJob[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export const runPodStopService = new RunPodStopService();
