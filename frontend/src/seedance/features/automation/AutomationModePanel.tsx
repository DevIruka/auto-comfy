import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import PresetPicker from "../../../components/PresetPicker";
import type { CharacterPreset } from "../../../api/presets-client";
import { AutomationProgressPanel } from "./AutomationProgressPanel";
import { AutomationFolderPairsEditor } from "./AutomationFolderPairsEditor";
import {
  AutomationRunResultPanel,
  AutomationScanResultPanel,
} from "./AutomationResultPanels";
import {
  postSystemOpenFolder,
  postSystemPickFolder,
} from "../../services/seedanceApi";
import type {
  AutomationJobStatus,
  AutomationQueuesStatus,
  AutomationRunResult,
  AutomationScanResult,
  FolderPair,
} from "../../types/app";

interface AutomationModePanelProps {
  folderPairs: FolderPair[];
  setFolderPairs: Dispatch<SetStateAction<FolderPair[]>>;
  outputRootPath: string;
  setOutputRootPath: Dispatch<SetStateAction<string>>;
  automationRunning: boolean;
  onRun: () => Promise<void>;
  onRunRow: (rowIndex: number) => Promise<void>;
  onToggleRowPause: (rowIndex: number) => Promise<void>;
  onScan: () => Promise<void>;
  rowEndpointByIndex: Record<number, number>;
  rowPausedByIndex: Record<number, boolean>;
  rowControlLoadingByIndex: Record<number, boolean>;
  scanResult: AutomationScanResult | null;
  automationResult: AutomationRunResult | null;
  trackedJobIds: string[];
  jobStatuses: Record<string, AutomationJobStatus>;
  progressLoading: boolean;
  queuesStatus: AutomationQueuesStatus | null;
  queueControlLoading: boolean;
  queueControlMessage: string | null;
  onRefreshProgress: (jobIds: string[]) => void;
  onClearProgress: () => void;
  onPauseQueues: () => void | Promise<void>;
  onResumeQueues: () => void | Promise<void>;
  onForceStopQueues: () => void | Promise<void>;
}

export function AutomationModePanel({
  folderPairs,
  setFolderPairs,
  outputRootPath,
  setOutputRootPath,
  automationRunning,
  onRun,
  onRunRow,
  onToggleRowPause,
  onScan,
  rowEndpointByIndex,
  rowPausedByIndex,
  rowControlLoadingByIndex,
  scanResult,
  automationResult,
  trackedJobIds,
  jobStatuses,
  progressLoading,
  queuesStatus,
  queueControlLoading,
  queueControlMessage,
  onRefreshProgress,
  onClearProgress,
  onPauseQueues,
  onResumeQueues,
  onForceStopQueues,
}: AutomationModePanelProps) {
  const [rootPathLoading, setRootPathLoading] = useState(false);
  const [rootPathMessage, setRootPathMessage] = useState("");

  const handleAutomationPresetLoad = useCallback(
    (preset: CharacterPreset) => {
      if (preset.prefixPrompt === undefined) return;
      const text = String(preset.prefixPrompt).trim();
      setFolderPairs((prev) => prev.map((p) => ({ ...p, prompt: text })));
    },
    [setFolderPairs],
  );

  const getAutomationPresetSettings = useCallback((): Omit<
    CharacterPreset,
    "name" | "createdAt" | "updatedAt"
  > => {
    const rowWithPrompt = folderPairs.find((p) => (p.prompt || "").trim());
    return {
      prefixPrompt: (rowWithPrompt?.prompt || folderPairs[0]?.prompt || "").trim(),
    };
  }, [folderPairs]);

  const handlePickRootPath = async () => {
    setRootPathLoading(true);
    setRootPathMessage("");
    try {
      const { ok, data } = await postSystemPickFolder();
      if (!ok || !data.success) {
        if (data.cancelled) return;
        throw new Error(data.error || "Failed to pick folder");
      }
      if (data.path) setOutputRootPath(data.path);
    } catch (e: unknown) {
      setRootPathMessage(e instanceof Error ? e.message : "Failed to pick folder");
    } finally {
      setRootPathLoading(false);
    }
  };

  const handleOpenRootPath = async () => {
    const pathValue = outputRootPath.trim();
    if (!pathValue) return;
    const { ok, data } = await postSystemOpenFolder(pathValue);
    if (!ok || !data.success) {
      setRootPathMessage(data.error || "Failed to open folder");
    }
  };

  return (
    <div className="automation-mode-section">
      <h2>Automation Run (Idle / SpeakNatural)</h2>
      <p className="helper-text" style={{ marginBottom: "12px" }}>
        Supported structure: 1) Pose/Clothed|Naked/Emotion 2) Pose/Emotion 3)
        Pose/Emotion/Clothed|Naked (under emotion), one image per folder. Row
        prompt is required.
      </p>

      <div className="input-group" style={{ marginBottom: "14px" }}>
        <label>캐릭터 프리셋</label>
        <p className="helper-text" style={{ marginTop: "4px", marginBottom: "8px" }}>
          불러오기: 프리셋의 prefixPrompt가 모든 행의 Row prompt에 들어갑니다. 저장 시에는 첫 번째로
          비어 있지 않은 Row prompt를 prefixPrompt로 씁니다.
        </p>
        <PresetPicker
          onLoad={handleAutomationPresetLoad}
          getCurrentSettings={getAutomationPresetSettings}
        />
      </div>

      <AutomationFolderPairsEditor
        folderPairs={folderPairs}
        setFolderPairs={setFolderPairs}
        automationRunning={automationRunning}
        onRunRow={onRunRow}
        onToggleRowPause={onToggleRowPause}
        rowEndpointByIndex={rowEndpointByIndex}
        rowPausedByIndex={rowPausedByIndex}
        rowControlLoadingByIndex={rowControlLoadingByIndex}
      />

      <div className="input-group">
        <div className="inline-label-with-note">
          <label htmlFor="automationOutputRootPath">
            Common Output Root Path (Optional)
          </label>
          <span className="helper-text">Auto: root + input folder name</span>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            id="automationOutputRootPath"
            type="text"
            value={outputRootPath}
            onChange={(e) => setOutputRootPath(e.target.value)}
            placeholder="Example: E:\\twiv"
            disabled={automationRunning || rootPathLoading}
            style={{ flex: "1", minWidth: "220px" }}
          />
          <button
            type="button"
            className="toggle-btn"
            onClick={handlePickRootPath}
            disabled={automationRunning || rootPathLoading}
          >
            Root Select
          </button>
          <button
            type="button"
            className="toggle-btn"
            onClick={handleOpenRootPath}
            disabled={
              automationRunning || rootPathLoading || !outputRootPath.trim()
            }
          >
            Root Open
          </button>
        </div>
        {rootPathMessage && (
          <p className="helper-text" style={{ marginTop: "6px" }}>
            {rootPathMessage}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <button
          type="button"
          className="generate-btn"
          disabled={
            automationRunning ||
            folderPairs.every((p) => !p.inputPath.trim()) ||
            folderPairs.some((p) => p.inputPath.trim() && !(p.prompt || "").trim())
          }
          onClick={onRun}
        >
          {automationRunning ? "Running..." : "Run Automation"}
        </button>
        <button
          type="button"
          className="toggle-btn"
          disabled={automationRunning || folderPairs.every((p) => !p.inputPath.trim())}
          onClick={onScan}
        >
          Scan (All Rows)
        </button>
      </div>

      <AutomationScanResultPanel scanResult={scanResult} />
      <AutomationRunResultPanel automationResult={automationResult} />

      <AutomationProgressPanel
        trackedJobIds={trackedJobIds}
        jobStatuses={jobStatuses}
        progressLoading={progressLoading}
        queuesStatus={queuesStatus}
        queueControlLoading={queueControlLoading}
        queueControlMessage={queueControlMessage}
        onRefresh={onRefreshProgress}
        onClear={onClearProgress}
        onPauseAll={onPauseQueues}
        onResumeAll={onResumeQueues}
        onForceStopAll={onForceStopQueues}
      />
    </div>
  );
}
