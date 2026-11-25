import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { FolderPair, IdlePromptOption } from "../../types/app";
import { pathDisplayTail } from "../../utils/workspacePaths";

const EMOTION_OPTIONS = ["Angry", "Sad", "Aroused", "Neutral", "Happy"] as const;

interface AutomationFolderPairsEditorProps {
  folderPairs: FolderPair[];
  setFolderPairs: Dispatch<SetStateAction<FolderPair[]>>;
  automationRunning: boolean;
  onRunRow: (rowIndex: number) => Promise<void>;
  onToggleRowPause: (rowIndex: number) => Promise<void>;
  rowEndpointByIndex: Record<number, number>;
  rowPausedByIndex: Record<number, boolean>;
  rowControlLoadingByIndex: Record<number, boolean>;
  idlePromptOptions: IdlePromptOption[];
}

export function AutomationFolderPairsEditor({
  folderPairs,
  setFolderPairs,
  automationRunning,
  onRunRow,
  onToggleRowPause,
  rowEndpointByIndex,
  rowPausedByIndex,
  rowControlLoadingByIndex,
  idlePromptOptions,
}: AutomationFolderPairsEditorProps) {
  const [expandedIdleRows, setExpandedIdleRows] = useState<Record<number, boolean>>({});
  const allIdlePromptIds = idlePromptOptions.map((option) => option.id);

  const getRowSelectedIdlePrompts = (pair: FolderPair) => {
    if (pair.selectedIdlePrompts === undefined) return allIdlePromptIds;
    return pair.selectedIdlePrompts;
  };
  const parseEndpoint = (value: FolderPair["endpointIndex"]): number | null => {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 3) {
      return numeric;
    }
    return null;
  };

  const updateRow = (rowIndex: number, patch: Partial<FolderPair>) => {
    setFolderPairs((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], ...patch };
      return next;
    });
  };

  const getRowTargetEmotions = (pair: FolderPair) => {
    return Array.isArray(pair.targetEmotions) && pair.targetEmotions.length > 0
      ? pair.targetEmotions
      : [...EMOTION_OPTIONS];
  };

  const getRowStatus = (pair: FolderPair) => {
    if (!pair.inputPath?.trim()) return { label: "Input Required", tone: "warn" as const };
    if (!(pair.prompt || "").trim()) return { label: "Prompt Required", tone: "warn" as const };
    return { label: "Ready", tone: "ok" as const };
  };

  return (
    <div className="input-group">
      <label>Input Folders (row options)</label>
      <p className="helper-text" style={{ marginTop: "4px", marginBottom: "8px" }}>
        입력 경로는 작업 공간의 <strong>감정별 이미지/Emotions</strong>로 고정됩니다. 상단에서
        캐릭터·스팟을 선택하세요.
      </p>
      {folderPairs.map((pair, idx) => {
        const knownEndpoint = rowEndpointByIndex[idx] ?? parseEndpoint(pair.endpointIndex);
        const rowPaused = Boolean(rowPausedByIndex[idx]);
        const rowControlLoading = Boolean(rowControlLoadingByIndex[idx]);
        return (
          <div key={idx} className="folder-pair-row">
          <div className="folder-pair-header">
            <strong>Row {idx + 1}</strong>
            <div className="folder-pair-header-right">
              <span className={`folder-row-status ${getRowStatus(pair).tone}`}>
                {getRowStatus(pair).label}
              </span>
            </div>
          </div>

          <div className="folder-pair-path-grid">
            <div className="folder-path-picker">
              <label className="folder-path-label">Input Path (workspace)</label>
              <div className="folder-path-box folder-path-readonly">
                <span
                  className={`folder-path-text ${pair.inputPath.trim() ? "" : "empty"}`}
                  title={pair.inputPath.trim() || "작업 공간을 선택하면 채워집니다"}
                >
                  {pair.inputPath.trim()
                    ? pathDisplayTail(pair.inputPath, 4)
                    : "작업 공간을 선택하면 채워집니다"}
                </span>
              </div>
            </div>
          </div>
          <div className="folder-pair-meta-row">
            <textarea
              value={pair.prompt || ""}
              onChange={(e) => {
                updateRow(idx, { prompt: e.target.value });
              }}
              onInput={(e) => {
                const target = e.currentTarget;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 220)}px`;
              }}
              placeholder="Row prompt (required)"
              className="path-input row-prompt-textarea"
              disabled={automationRunning}
              rows={2}
            />
          </div>

          <div className="folder-row-options">
            <div className="input-group-small">
              <label>Endpoint Box</label>
              <select
                value={pair.endpointIndex || "auto"}
                onChange={(e) => {
                  updateRow(idx, {
                    endpointIndex:
                      e.target.value === "auto" ? "auto" : Number(e.target.value),
                  });
                }}
                className="folder-endpoint-select"
                disabled={automationRunning}
              >
                <option value="auto">Auto</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>

            <div className="input-group-small">
              <label>Videos Per Clip</label>
              <select
                value={pair.videosPerClip ?? 1}
                onChange={(e) => updateRow(idx, { videosPerClip: Number(e.target.value) })}
                disabled={automationRunning}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </div>

            <div className="input-group-small">
              <label>Idle Per Prompt</label>
              <select
                value={pair.idleTargetCount ?? 1}
                onChange={(e) => updateRow(idx, { idleTargetCount: Number(e.target.value) })}
                disabled={automationRunning}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </div>

            <div className="input-group-small">
              <label>Target Clothing</label>
              <select
                value={pair.targetClothing ?? "all"}
                onChange={(e) =>
                  updateRow(idx, {
                    targetClothing: e.target.value as "all" | "clothed" | "naked",
                  })
                }
                disabled={automationRunning}
              >
                <option value="all">All</option>
                <option value="clothed">Clothed</option>
                <option value="naked">Naked</option>
              </select>
            </div>

            <div className="input-group-small">
              <label>Regeneration Combo</label>
              <select
                value={pair.targetTransition ?? "all"}
                onChange={(e) =>
                  updateRow(idx, {
                    targetTransition: e.target.value as "all" | "same" | "toneutral",
                  })
                }
                disabled={automationRunning}
              >
                <option value="all">All</option>
                <option value="same">Emotion+Emotion</option>
                <option value="toneutral">Emotion+Neutral</option>
              </select>
            </div>
          </div>

          <div className="folder-row-emotions">
            <label className="folder-path-label">Target Emotions</label>
            <div className="folder-row-emotions-grid">
              {EMOTION_OPTIONS.map((emotion) => {
                const selected = getRowTargetEmotions(pair);
                const checked = selected.includes(emotion);
                return (
                  <button
                    key={`${idx}-${emotion}`}
                    type="button"
                    className={`emotion-chip ${checked ? "active" : ""}`}
                    disabled={automationRunning}
                    onClick={() => {
                      const current = getRowTargetEmotions(pair);
                      const next = checked
                        ? current.filter((v) => v !== emotion)
                        : [...current, emotion];
                      updateRow(idx, {
                        targetEmotions: next.length > 0 ? next : [...EMOTION_OPTIONS],
                      });
                    }}
                  >
                    {emotion}
                  </button>
                );
              })}
            </div>
          </div>

          {idlePromptOptions.length > 0 ? (() => {
            const selectedIdle = getRowSelectedIdlePrompts(pair);
            const perPrompt = Math.min(5, Math.max(1, Number(pair.idleTargetCount) || 1));
            const expanded = Boolean(expandedIdleRows[idx]);
            const applyCommonToNaked = Boolean(pair.applyCommonToNaked);
            // Target total is fixed by the full prompt list; selection is only the fill pool.
            const allCount = idlePromptOptions.length;
            const allBaseCount = idlePromptOptions.filter(
              (o) => o.kind === "base",
            ).length;
            const clothedTargetPrompts = allCount;
            const nakedTargetPrompts = applyCommonToNaked ? allCount : allBaseCount;
            const poolBaseSelected = selectedIdle.filter(
              (id) => !id.startsWith("common:"),
            ).length;
            const setSelectedIdle = (next: string[]) => {
              // Preserve config order; store explicit array (even when "all") so it round-trips.
              const ordered = allIdlePromptIds.filter((id) => next.includes(id));
              updateRow(idx, { selectedIdlePrompts: ordered });
            };
            return (
              <div className="folder-row-idle-prompts">
                <button
                  type="button"
                  className="folder-row-idle-toggle"
                  onClick={() =>
                    setExpandedIdleRows((prev) => ({ ...prev, [idx]: !prev[idx] }))
                  }
                  disabled={automationRunning}
                >
                  <span>{expanded ? "▾" : "▸"} Idle 프롬프트</span>
                  <span className="folder-row-idle-summary">
                    풀 {selectedIdle.length} / {idlePromptOptions.length} · 목표 Clothed{" "}
                    {perPrompt * clothedTargetPrompts}개
                  </span>
                </button>
                {expanded ? (
                  <div className="folder-row-idle-body">
                    <div className="folder-row-idle-actions">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setSelectedIdle([...allIdlePromptIds])}
                        disabled={automationRunning}
                      >
                        전체 선택
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setSelectedIdle([])}
                        disabled={automationRunning}
                      >
                        전체 해제
                      </button>
                    </div>
                    <div className="folder-row-idle-grid">
                      {idlePromptOptions.map((option) => {
                        const checked = selectedIdle.includes(option.id);
                        return (
                          <button
                            key={`${idx}-${option.id}`}
                            type="button"
                            className={`emotion-chip ${checked ? "active" : ""}`}
                            disabled={automationRunning}
                            onClick={() => {
                              const next = checked
                                ? selectedIdle.filter((v) => v !== option.id)
                                : [...selectedIdle, option.id];
                              setSelectedIdle(next);
                            }}
                            title={option.kind === "common" ? "common 프롬프트" : "기본 idle"}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <label
                      className="folder-row-checkbox folder-row-checkbox-compact"
                      style={{ marginTop: "8px" }}
                    >
                      <input
                        type="checkbox"
                        checked={applyCommonToNaked}
                        onChange={(e) =>
                          updateRow(idx, { applyCommonToNaked: e.target.checked })
                        }
                        disabled={automationRunning}
                      />
                      Naked에도 common 프롬프트 적용 (기본 해제)
                    </label>
                    <p className="helper-text" style={{ marginTop: "6px" }}>
                      목표 개수는 전체 프롬프트 수로 고정되고, 이번 스캔/실행에서 새로 만드는
                      개수는 <strong>min(목표 − 기존, 선택 풀 × Idle Per Prompt)</strong>입니다.
                      즉, 선택한 풀이 적으면 그만큼만 추가 생성됩니다.
                    </p>
                    <p className="helper-text" style={{ marginTop: "2px" }}>
                      Clothed: 목표 {perPrompt * clothedTargetPrompts}개(={perPrompt}×
                      {clothedTargetPrompts}) · 이번 추가 한도 {perPrompt * selectedIdle.length}개(=
                      {perPrompt}×풀 {selectedIdle.length}). Naked: 목표{" "}
                      {perPrompt * nakedTargetPrompts}개 · 이번 추가 한도{" "}
                      {perPrompt * (applyCommonToNaked ? selectedIdle.length : poolBaseSelected)}개
                      {applyCommonToNaked ? "" : " (common 제외)"}. (선택이 비어 있거나 Neutral
                      미선택 시 idle은 생성되지 않습니다.)
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })() : null}

          <div className="folder-pair-footer">
            <div className="folder-pair-footer-left">
              <label className="folder-row-checkbox folder-row-checkbox-compact">
                <input
                  type="checkbox"
                  checked={Boolean(pair.ignoreExistingOutput)}
                  onChange={(e) => updateRow(idx, { ignoreExistingOutput: e.target.checked })}
                  disabled={automationRunning}
                />
                Ignore existing output (force regeneration)
              </label>
              {rowPaused && knownEndpoint ? (
                <span className="row-queue-warning">
                  Warning: Queue {knownEndpoint} is paused for all jobs using this endpoint.
                </span>
              ) : null}
            </div>
            <div className="folder-pair-footer-right">
              <button
                type="button"
                className="toggle-btn"
                onClick={() => onRunRow(idx)}
                disabled={
                  automationRunning ||
                  rowControlLoading ||
                  !pair.inputPath.trim() ||
                  !(pair.prompt || "").trim()
                }
              >
                Run
              </button>
              <button
                type="button"
                className="toggle-btn"
                onClick={() => onToggleRowPause(idx)}
                disabled={
                  automationRunning ||
                  rowControlLoading ||
                  !knownEndpoint
                }
                title={
                  knownEndpoint
                    ? `Queue ${knownEndpoint}`
                    : "Endpoint unknown (choose 1/2/3 or run once first)"
                }
              >
                {rowPaused ? "Resume" : "Stop"}
              </button>
              <button
                type="button"
                className="toggle-btn"
                onClick={() => setFolderPairs(folderPairs.filter((_, i) => i !== idx))}
                disabled={folderPairs.length <= 1 || automationRunning}
              >
                Delete
              </button>
            </div>
          </div>
          </div>
        );
      })}
      <button
        type="button"
        className="toggle-btn"
        onClick={() => {
          const templateInput = folderPairs[0]?.inputPath?.trim() || "";
          setFolderPairs([
            ...folderPairs,
            {
              inputPath: templateInput,
              outputPath: folderPairs[0]?.outputPath?.trim() || "",
              prompt: "",
              endpointIndex: "auto",
              videosPerClip: 1,
              idleTargetCount: 1,
              ignoreExistingOutput: false,
              targetEmotions: [...EMOTION_OPTIONS],
              targetClothing: "all",
              targetTransition: "all",
              selectedIdlePrompts: [...allIdlePromptIds],
            },
          ]);
        }}
      >
        + Add Folder Pair
      </button>
    </div>
  );
}
