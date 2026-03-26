import type { AutomationRunResult, AutomationScanResult } from "../../types/app";

interface AutomationScanResultPanelProps {
  scanResult: AutomationScanResult | null;
}

export function AutomationScanResultPanel({
  scanResult,
}: AutomationScanResultPanelProps) {
  if (!scanResult) return null;

  const hasMultiRow = Array.isArray(scanResult.scans);

  return (
    <div
      className={`folder-result ${scanResult.success ? "success" : "error"}`}
      style={{ marginTop: "8px" }}
    >
      {scanResult.success ? (
        hasMultiRow ? (
          <>
            <p>
              Scan Summary: rows {scanResult.totals?.rows || 0} / success{" "}
              {scanResult.totals?.successRows || 0} / error{" "}
              {scanResult.totals?.errorRows || 0}
            </p>
            <p>
              Planned Jobs: total {scanResult.totals?.jobs || 0} / Idle{" "}
              {scanResult.totals?.idleJobs || 0} / SpeakNatural{" "}
              {scanResult.totals?.speakJobs || 0}
            </p>
            <p>
              Planned Clips: total {scanResult.totals?.clips || 0} / Idle{" "}
              {scanResult.totals?.idleClips || 0} / SpeakNatural{" "}
              {scanResult.totals?.speakClips || 0}
            </p>
            <p>
              By Clothing: Clothed jobs {scanResult.totals?.clothedJobs || 0} / clips{" "}
              {scanResult.totals?.clothedClips || 0}, Naked jobs{" "}
              {scanResult.totals?.nakedJobs || 0} / clips{" "}
              {scanResult.totals?.nakedClips || 0}
            </p>
            {(scanResult.scans || []).map((row) => (
              <p key={`scan-row-${row.rowIndex}`} className="helper-text">
                Row {row.rowIndex + 1} {row.error ? "(error)" : "->"}{" "}
                {row.error
                  ? row.error
                  : `Q${row.endpoint} ${row.endpointMode === "auto" ? "[auto]" : "[fixed]"}, jobs ${row.planned?.total || 0}, clips ${row.planned?.videoTotal || 0}, clothed ${row.planned?.byClothing?.Clothed?.jobs || 0}/${row.planned?.byClothing?.Clothed?.clips || 0}, naked ${row.planned?.byClothing?.Naked?.jobs || 0}/${row.planned?.byClothing?.Naked?.clips || 0}, emotions ${Object.entries(row.planned?.speakByEmotion || {}).map(([emotion, count]) => `${emotion} ${count}`).join(", ") || "None"}`}
              </p>
            ))}
          </>
        ) : (
          <>
            <p>Input Path: {scanResult.root}</p>
            <p>Pose: {Object.keys(scanResult.poses || {}).join(", ") || "None"}</p>
            <p>
              Planned Jobs: total {scanResult.planned?.total || 0} / Idle{" "}
              {scanResult.planned?.idle || 0} / SpeakNatural{" "}
              {scanResult.planned?.speakTotal || 0}
            </p>
            <p>
              Planned Clips: total {scanResult.planned?.videoTotal || 0} / Idle{" "}
              {scanResult.planned?.idleVideos || 0} / SpeakNatural{" "}
              {scanResult.planned?.speakVideos || 0}
            </p>
            {scanResult.filters && (
              <p className="helper-text">
                Filters: clothing({scanResult.filters.clothing?.join(", ") || "-"}) / emotions(
                {scanResult.filters.emotions?.join(", ") || "-"}) / transition(
                {scanResult.filters.transition || "-"})
              </p>
            )}
            {(scanResult.warnings || []).length > 0 && (
              <p>Warnings: {scanResult.warnings?.length}</p>
            )}
          </>
        )
      ) : (
        <p>{scanResult.error || "Scan failed"}</p>
      )}
    </div>
  );
}

interface AutomationRunResultPanelProps {
  automationResult: AutomationRunResult | null;
}

export function AutomationRunResultPanel({
  automationResult,
}: AutomationRunResultPanelProps) {
  if (!automationResult) return null;

  const acceptedRows = automationResult.acceptedRows || [];
  const rejectedRows = automationResult.rejectedRows || [];

  return (
    <div
      className={`folder-result ${automationResult.success ? "success" : "error"}`}
      style={{ marginTop: "8px" }}
    >
      {automationResult.success ? (
        <>
          <p>
            Queued: {automationResult.queued || 0} jobs /{" "}
            {automationResult.queuedVideos || 0} clips
          </p>
          {acceptedRows.length > 0 && (
            <p className="helper-text">
              Accepted Rows:{" "}
              {acceptedRows
                .map(
                  (row) =>
                    `row ${row.rowIndex + 1} -> endpoint ${row.endpoint}, jobs ${row.queued}, clips ${row.queuedVideos || 0}`,
                )
                .join(" | ")}
            </p>
          )}
          {automationResult.endpointCounts && (
            <p className="helper-text">
              Endpoint Distribution (jobs): 1={automationResult.endpointCounts["1"] || 0},
              2={automationResult.endpointCounts["2"] || 0}, 3={automationResult.endpointCounts["3"] || 0}
            </p>
          )}
          {automationResult.endpointVideoCounts && (
            <p className="helper-text">
              Endpoint Distribution (clips): 1={automationResult.endpointVideoCounts["1"] || 0},
              2={automationResult.endpointVideoCounts["2"] || 0}, 3={automationResult.endpointVideoCounts["3"] || 0}
            </p>
          )}
          {rejectedRows.length > 0 && (
            <p className="helper-text">
              Rejected Rows:{" "}
              {rejectedRows
                .map((row) => `row ${row.rowIndex + 1} (${row.reason})`)
                .join(" | ")}
            </p>
          )}
          <p className="helper-text">
            Job IDs: {automationResult.jobIds?.slice(0, 5).join(", ")}
            {automationResult.jobIds && automationResult.jobIds.length > 5
              ? " ..."
              : ""}
          </p>
        </>
      ) : (
        <p>{automationResult.message || automationResult.error}</p>
      )}
    </div>
  );
}
