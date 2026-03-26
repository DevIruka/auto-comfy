import type { AutomationQueuesStatus } from "../../types/app";

interface AutomationQueueControlBarProps {
  queuesStatus: AutomationQueuesStatus | null;
  controlLoading: boolean;
  controlMessage: string | null;
  onPauseAll: () => void | Promise<void>;
  onResumeAll: () => void | Promise<void>;
  onForceStopAll: () => void | Promise<void>;
}

export function AutomationQueueControlBar({
  queuesStatus,
  controlLoading,
  controlMessage,
  onPauseAll,
  onResumeAll,
  onForceStopAll,
}: AutomationQueueControlBarProps) {
  const queues = queuesStatus?.queues || [];
  const anyPaused = queues.some((q) => q.paused);
  const allPaused = queues.length > 0 && queues.every((q) => q.paused);

  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          type="button"
          className="toggle-btn"
          disabled={controlLoading || allPaused}
          onClick={onPauseAll}
        >
          {controlLoading ? "Working..." : "Pause Queues"}
        </button>
        <button
          type="button"
          className="toggle-btn"
          disabled={controlLoading || !anyPaused}
          onClick={onResumeAll}
        >
          {controlLoading ? "Working..." : "Resume Queues"}
        </button>
        <button
          type="button"
          className="toggle-btn"
          disabled={controlLoading}
          onClick={onForceStopAll}
          style={{ backgroundColor: "#b23a3a", color: "#fff" }}
        >
          {controlLoading ? "Working..." : "Force Stop"}
        </button>
      </div>
      {controlMessage && (
        <p className="helper-text" style={{ marginTop: "8px", marginBottom: 0 }}>
          {controlMessage}
        </p>
      )}
    </div>
  );
}
