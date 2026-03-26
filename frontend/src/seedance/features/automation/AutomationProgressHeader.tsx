interface AutomationProgressHeaderProps {
  progressLoading: boolean;
  trackedJobIds: string[];
  onRefresh: (jobIds: string[]) => void;
  onClear: () => void;
}

export function AutomationProgressHeader({
  progressLoading,
  trackedJobIds,
  onRefresh,
  onClear,
}: AutomationProgressHeaderProps) {
  return (
    <div
      style={{
        color: "#000",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginBottom: "10px",
      }}
    >
      <strong style={{ color: "#000" }}>Progress</strong>
      <button
        type="button"
        className="toggle-btn"
        disabled={progressLoading}
        onClick={() => onRefresh(trackedJobIds)}
      >
        {progressLoading ? "Refreshing..." : "Refresh"}
      </button>
      <button
        type="button"
        className="toggle-btn"
        style={{ marginLeft: "auto" }}
        onClick={onClear}
      >
        Clear List
      </button>
    </div>
  );
}
