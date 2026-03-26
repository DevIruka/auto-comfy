import type {
  AutomationJobStatus,
  AutomationQueuesStatus,
} from "../../types/app";
import { AutomationProgressHeader } from "./AutomationProgressHeader";
import { AutomationQueueControlBar } from "./AutomationQueueControlBar";
import { AutomationProgressSummary } from "./AutomationProgressSummary";
import { AutomationQueueStatusList } from "./AutomationQueueStatusList";
import type { AutomationProgressStats } from "./progressTypes";

interface AutomationProgressPanelProps {
  trackedJobIds: string[];
  jobStatuses: Record<string, AutomationJobStatus>;
  progressLoading: boolean;
  queuesStatus: AutomationQueuesStatus | null;
  queueControlLoading: boolean;
  queueControlMessage: string | null;
  onRefresh: (jobIds: string[]) => void;
  onClear: () => void;
  onPauseAll: () => void | Promise<void>;
  onResumeAll: () => void | Promise<void>;
  onForceStopAll: () => void | Promise<void>;
}

export function AutomationProgressPanel({
  trackedJobIds,
  jobStatuses,
  progressLoading,
  queuesStatus,
  queueControlLoading,
  queueControlMessage,
  onRefresh,
  onClear,
  onPauseAll,
  onResumeAll,
  onForceStopAll,
}: AutomationProgressPanelProps) {
  if (trackedJobIds.length === 0) return null;

  const total = trackedJobIds.length;
  const queued = trackedJobIds.filter(
    (id) => jobStatuses[id]?.status === "queued",
  ).length;
  const processing = trackedJobIds.filter((id) => {
    const s = jobStatuses[id]?.status;
    return s === "processing" || s === "retrying";
  }).length;
  const done = trackedJobIds.filter((id) => jobStatuses[id]?.status === "done")
    .length;
  const failed = trackedJobIds.filter(
    (id) => jobStatuses[id]?.status === "failed",
  ).length;
  const stopped = trackedJobIds.filter(
    (id) => jobStatuses[id]?.status === "stopped",
  ).length;
  const finished = done + failed + stopped;
  const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
  const stats: AutomationProgressStats = {
    total,
    queued,
    processing,
    done,
    failed,
    stopped,
    finished,
    percent,
  };

  return (
    <div
      className="automation-progress"
      style={{
        marginTop: "12px",
        padding: "12px",
        border: "1px solid #444",
        borderRadius: "8px",
      }}
    >
      <AutomationProgressHeader
        progressLoading={progressLoading}
        trackedJobIds={trackedJobIds}
        onRefresh={onRefresh}
        onClear={onClear}
      />
      <AutomationQueueControlBar
        queuesStatus={queuesStatus}
        controlLoading={queueControlLoading}
        controlMessage={queueControlMessage}
        onPauseAll={onPauseAll}
        onResumeAll={onResumeAll}
        onForceStopAll={onForceStopAll}
      />

      <AutomationProgressSummary stats={stats} />
      <AutomationQueueStatusList queuesStatus={queuesStatus} />

      <p className="helper-text" style={{ marginTop: "8px", marginBottom: 0 }}>
        Progress is job-based (not clip-based). Auto-refreshes every 5 seconds while jobs are still running.
      </p>
    </div>
  );
}
