import type { AutomationQueuesStatus } from "../../types/app";

interface AutomationQueueStatusListProps {
  queuesStatus: AutomationQueuesStatus | null;
}

export function AutomationQueueStatusList({
  queuesStatus,
}: AutomationQueueStatusListProps) {
  if (!queuesStatus?.queues || queuesStatus.queues.length === 0) return null;

  return (
    <div
      style={{
        marginTop: "10px",
        paddingTop: "10px",
        borderTop: "1px solid #444",
      }}
    >
      <strong style={{ color: "#000", fontSize: "0.9rem" }}>
        Endpoint Queue Status
      </strong>
      <ul
        style={{
          color: "#000",
          margin: "6px 0 0 0",
          paddingLeft: "20px",
          fontSize: "0.85rem",
        }}
      >
        {queuesStatus.queues.map((q) => (
          <li key={q.queue}>
            Endpoint {q.queue}: Pending <strong>{q.pending}</strong>
            {q.paused ? " / Paused" : ""}
            {q.processing ? " / Processing" : ""}
            {q.currentJobId ? ` / Job ${q.currentJobId}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
