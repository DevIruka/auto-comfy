import type { AutomationProgressStats } from "./progressTypes";

interface AutomationProgressSummaryProps {
  stats: AutomationProgressStats;
}

export function AutomationProgressSummary({ stats }: AutomationProgressSummaryProps) {
  return (
    <>
      <div style={{ marginBottom: "10px" }}>
        <div
          style={{
            color: "#000",
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "4px",
            fontSize: "0.9rem",
          }}
        >
          <span>
            Completed {stats.finished} of {stats.total}
          </span>
          <span>{stats.percent}%</span>
        </div>
        <div
          style={{
            height: "20px",
            background: "#333",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${stats.percent}%`,
              background: "linear-gradient(90deg, #4a9eff, #6b7fff)",
              borderRadius: "10px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      <p
        style={{
          color: "#000",
          margin: "0 0 8px 0",
          fontSize: "0.9rem",
        }}
      >
        Pending <strong style={{ color: "#000" }}>{stats.queued}</strong> / Processing{" "}
        <strong style={{ color: "#000" }}>{stats.processing}</strong> / Done{" "}
        <strong style={{ color: "#000" }}>{stats.done}</strong> / Failed{" "}
        <strong style={{ color: "#000" }}>{stats.failed}</strong> / Stopped{" "}
        <strong style={{ color: "#000" }}>{stats.stopped}</strong>
      </p>
    </>
  );
}
