import { useState, useEffect, useCallback } from "react";
import { comfyClient, type ComfyInstanceInfo } from "../api/comfy-client";
import PresetPicker from "./PresetPicker";
import type { CharacterPreset } from "../api/presets-client";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  defaultLoraSlots,
  padLoraSlots,
  extraLoraLabel,
  EXTRA_LORA_START,
  type LoraSlotState,
} from "../utils/lora-slots";
import { resolvePresetInstanceId } from "../utils/resolve-preset-instance";
import { useInstanceLoras } from "../context/LoraListContext";
import { LoraNameSelect, LoraSearchInput } from "./LoraNameSelect";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3002";

interface PromptBlocks {
  styleTrigger: string;
  character: string;
  outfit: string;
  pose: string;
  emotion: string;
  background: string;
  /** Negative 보조: 배경 및 자잘한 걸 고치기 위한 프롬프트 */
  negativeExtra: string;
  fixedPrefix: string;
}

type LoraSlot = LoraSlotState;

interface JobStatus {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  totalSteps: number;
  currentStep: number;
  logs: string[];
  error?: string;
  createdAt?: string;
}

interface QueueState {
  queue: string[];
  currentJobId: string | null;
  /** Running job IDs (one per instance; multiple when different ports run in parallel) */
  currentJobIds?: string[];
  jobs: JobStatus[];
}

const DEFAULT_FIXED_PREFIX =
  "(artist:tianliang duohe fangdongye:0.9), artist:ciloranko, artist:noyu, noyu23386566,ningen mame, (artist:sho:0.8264462809917354), (sho lwlw:0.9090909090909091),(artist:kedama_milk:0.5),(bee_\\(deadflow\\):0.7),artist:dino,(artist:fkey:0.8),(artist:wlop:1),year 2023,";

const defaultBlocks: PromptBlocks = {
  styleTrigger: "masterpiece, best quality, detailed eyes",
  character: "",
  outfit: "",
  pose: "looking at viewer, facing forward, cowboy shot",
  emotion: "",
  background: "",
  negativeExtra: "",
  fixedPrefix: DEFAULT_FIXED_PREFIX,
};

function ExtraLoraFold({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ep-lora-extra ${open ? "open" : ""}`}>
      <button
        type="button"
        className="ep-lora-extra-header"
        onClick={() => setOpen(!open)}
      >
        <span className="ep-lora-extra-arrow">{open ? "▼" : "▶"}</span>
        <span>{label}</span>
      </button>
      {open && <div className="ep-lora-extra-body">{children}</div>}
    </div>
  );
}

export default function EmotionPipeline() {
  const { character: wsCharacter, spot: wsSpot, paths, workspaceReady, resolveError } = useWorkspace();
  const folderPath = paths?.emotionImages ?? "";
  const workspacePresetName = wsCharacter.trim() && wsSpot.trim() ? `${wsCharacter.trim()} ${wsSpot.trim()}` : "";
  const [instances, setInstances] = useState<ComfyInstanceInfo[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [promptBlocks, setPromptBlocks] = useState<PromptBlocks>(defaultBlocks);
  const [loraSlots, setLoraSlots] = useState<LoraSlot[]>(() => defaultLoraSlots());
  const [loraFilter, setLoraFilter] = useState("");
  const { loraList, loadingLoras, listReady, listError, refreshLoras } =
    useInstanceLoras(selectedInstance);
  const [upscaleSeedCount, setUpscaleSeedCount] = useState(3);
  const [useOriginSubfolder, setUseOriginSubfolder] = useState(true);
  const [videoPrefixPrompt, setVideoPrefixPrompt] = useState("");
  const [showVideoPrompt, setShowVideoPrompt] = useState(false);
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{
    images: number;
    pending: number;
    skipped: number;
  } | null>(null);

  useEffect(() => {
    comfyClient.getComfyInstances().then((list) => {
      setInstances(list);
      if (list.length) {
        setSelectedInstance((prev) => prev || list[0].id);
      }
    });
  }, []);

  const updateLoraSlot = (index: number, updates: Partial<LoraSlot>) => {
    setLoraSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, ...updates } : slot))
    );
  };

  const renderLoraSlot = (slot: LoraSlot, i: number) => (
    <div
      key={i}
      className={`ep-lora-slot ${!slot.enabled ? "disabled" : ""}`}
    >
      <label className="ep-check">
        <input
          type="checkbox"
          checked={slot.enabled}
          onChange={(e) => updateLoraSlot(i, { enabled: e.target.checked })}
        />
        <span>LoRA {i + 1}</span>
      </label>
      {slot.enabled && (
        <div className="ep-lora-body">
          <LoraNameSelect
            names={loraList}
            value={slot.loraName}
            onChange={(name) => updateLoraSlot(i, { loraName: name })}
            filter={loraFilter}
            className="ep-select"
            placeholder="-- 선택 --"
            loading={loadingLoras}
            listReady={listReady}
            listError={listError}
          />
          <div className="ep-strengths">
            <div>
              <label>Model</label>
              <input
                type="number"
                step="0.1"
                value={slot.strengthModel}
                onChange={(e) =>
                  updateLoraSlot(i, { strengthModel: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <label>CLIP</label>
              <input
                type="number"
                step="0.1"
                value={slot.strengthClip}
                onChange={(e) =>
                  updateLoraSlot(i, { strengthClip: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/emotion-pipeline/queue`);
      const data = await res.json();
      if (data.success && data.data) setQueueState(data.data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const t = setInterval(fetchQueue, 4000);
    return () => clearInterval(t);
  }, [fetchQueue]);

  const selectedJob: JobStatus | undefined = selectedJobId
    ? queueState?.jobs.find((j) => j.jobId === selectedJobId)
    : undefined;

  useEffect(() => {
    if (selectedJob?.status === "running") {
      const t = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/emotion-pipeline/${selectedJobId}/status`);
          const data = await res.json();
          if (data.success && data.data) {
            setQueueState((prev) => {
              if (!prev) return prev;
              const jobs = prev.jobs.map((j) => (j.jobId === selectedJobId ? data.data : j));
              return { ...prev, jobs };
            });
          }
        } catch {
          // ignore
        }
      }, 3000);
      return () => clearInterval(t);
    }
  }, [selectedJobId, selectedJob?.status]);

  const handlePresetLoad = (preset: CharacterPreset) => {
    const negValue = preset.negativeExtra ?? preset.backgroundNegative;
    setPromptBlocks((prev) => ({
      ...prev,
      ...(preset.styleTrigger !== undefined && { styleTrigger: preset.styleTrigger }),
      ...(preset.character !== undefined && { character: preset.character }),
      ...(preset.outfit !== undefined && { outfit: preset.outfit }),
      ...(preset.pose !== undefined && { pose: preset.pose }),
      ...(preset.backgroundPositive !== undefined && { background: preset.backgroundPositive }),
      ...(negValue !== undefined && { negativeExtra: negValue }),
      ...(preset.fixedPrefix !== undefined && { fixedPrefix: preset.fixedPrefix }),
    }));
    if (preset.prefixPrompt !== undefined) setVideoPrefixPrompt(preset.prefixPrompt);
    setSelectedInstance(resolvePresetInstanceId(preset.comfyInstanceId, instances));
    if (preset.loraSlots?.length) {
      setLoraSlots(padLoraSlots(preset.loraSlots));
    }
  };

  const getCurrentSettingsForPreset = () => ({
    styleTrigger: promptBlocks.styleTrigger,
    character: promptBlocks.character,
    outfit: promptBlocks.outfit,
    pose: promptBlocks.pose,
    backgroundPositive: promptBlocks.background,
    negativeExtra: promptBlocks.negativeExtra,
    backgroundNegative: promptBlocks.negativeExtra,
    prefixPrompt: videoPrefixPrompt,
    comfyInstanceId: selectedInstance,
    fixedPrefix: promptBlocks.fixedPrefix,
    loraSlots: loraSlots.map((s) => ({
      enabled: s.enabled,
      loraName: s.loraName,
      strengthModel: s.strengthModel,
      strengthClip: s.strengthClip,
    })),
  });

  useEffect(() => {
    setScanResult(null);
  }, [folderPath, upscaleSeedCount, useOriginSubfolder]);

  const handleScan = async () => {
    if (!workspaceReady || !folderPath.trim()) {
      setError(
        resolveError ||
          "상단에서 작업 공간(캐릭터·스팟)을 선택하세요. 작업 루트는 감정별 이미지 폴더입니다.",
      );
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/emotion-pipeline/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: folderPath.trim(),
          upscaleSeedCount: Math.max(3, upscaleSeedCount),
          useOriginSubfolder,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setScanResult({
        images: data.data?.images ?? 0,
        pending: data.data?.pending ?? 0,
        skipped: data.data?.skipped ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "스캔 실패");
      setScanResult(null);
    } finally {
      setScanning(false);
    }
  };

  const handleStop = async (jobId: string) => {
    try {
      await fetch(`${API_BASE}/api/emotion-pipeline/${jobId}/stop`, { method: "POST" });
      fetchQueue();
    } catch {
      // ignore
    }
  };

  const handleStart = async () => {
    if (!workspaceReady || !folderPath.trim()) {
      setError(
        resolveError ||
          "상단에서 작업 공간(캐릭터·스팟)을 선택하세요. 작업 루트는 감정별 이미지 폴더입니다.",
      );
      return;
    }
    if (!selectedInstance) {
      setError("ComfyUI 인스턴스를 선택하세요");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const loraPayload = loraSlots.map((s) => ({
        enabled: s.enabled,
        loraName: s.loraName,
        modelStr: s.strengthModel,
        clipStr: s.strengthClip,
      }));

      const res = await fetch(`${API_BASE}/api/emotion-pipeline/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: folderPath.trim(),
          comfyInstanceId: selectedInstance,
          promptBlocks: {
            styleTrigger: promptBlocks.styleTrigger,
            character: promptBlocks.character,
            outfit: promptBlocks.outfit,
            pose: promptBlocks.pose,
            emotion: promptBlocks.emotion,
            background: promptBlocks.background,
            negativeExtra: promptBlocks.negativeExtra,
            fixedPrefix: promptBlocks.fixedPrefix,
          },
          loraSlots: loraPayload,
          upscaleSeedCount: Math.max(3, upscaleSeedCount),
          useOriginSubfolder,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const id = data.data?.jobId;
      if (id) {
        setSelectedJobId(id);
        fetchQueue();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "시작 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="emotion-pipeline">
      <header className="emotion-pipeline-header">
        <h1>Emotion Inpaint + Upscale Pipeline</h1>
        <p>
          작업 공간의 <strong>감정별 이미지</strong> 폴더를 루트로 스캔 → 얼굴 마스킹 → Neutral은 업스케일 1회 고정 → 4종 감정별 Inpaint → 업스케일(시드 N회) → 같은 트리 아래에 결과 저장.
          상단에서 캐릭터·스팟을 선택하면 경로가 자동으로 맞춰집니다. 작업은 큐에 쌓이며 순서대로 실행됩니다.
        </p>
      </header>

      <PresetPicker
        onLoad={handlePresetLoad}
        getCurrentSettings={getCurrentSettingsForPreset}
        preferredPresetName={workspacePresetName}
        autoLoadOnPreferredChange
      />
      <div className="video-prompt-for-preset">
        <button
          className="video-prompt-toggle"
          onClick={() => setShowVideoPrompt(!showVideoPrompt)}
        >
          {showVideoPrompt ? "▼" : "▶"} 영상용 자연어 프롬프트 (프리셋 저장용)
        </button>
        {showVideoPrompt && (
          <textarea
            className="video-prompt-textarea"
            value={videoPrefixPrompt}
            onChange={(e) => setVideoPrefixPrompt(e.target.value)}
            rows={2}
            placeholder="영상 자동화에서 쓸 접두 프롬프트를 여기에 입력하면 프리셋에 함께 저장됩니다"
          />
        )}
      </div>

      <div className="emotion-pipeline-card">
        <div className="form-group">
          <label>작업 루트 (감정별 이미지)</label>
          <div className="ib-readonly-path" title={folderPath}>
            {workspaceReady ? folderPath : "작업 공간을 선택하세요"}
          </div>
          <p className="form-hint">
            스캔 폴더(또는 작업 루트)에 <code>masked</code> 폴더가 있고 그 안에 이미지가 있으면
            얼굴 마스킹 단계는 건너뛰고, 해당 이미지로 바로 인페인팅합니다. 파일명은 자동 마스킹 결과와
            동일해야 합니다(원본 1장: <code>이름.png</code>, 여러 장: <code>0000_이름.png</code> 형식).
          </p>
        </div>

        <div className="form-group">
          <label>ComfyUI 인스턴스</label>
          <select
            value={selectedInstance}
            onChange={(e) => setSelectedInstance(e.target.value)}
            disabled={loading}
          >
            {instances.length === 0 && <option value="">로딩 중...</option>}
            {instances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.id})
              </option>
            ))}
          </select>
        </div>

        {/* LoRA */}
        <div className="ep-section">
          <h3 className="ep-section-title">LoRA</h3>
          <div className="ep-lora-toolbar">
            <LoraSearchInput value={loraFilter} onChange={setLoraFilter} />
            <button
              type="button"
              className="ep-btn-sm"
              onClick={refreshLoras}
              disabled={loadingLoras || !selectedInstance}
            >
              {loadingLoras ? "..." : "목록 새로고침"}
            </button>
          </div>
          <div className="ep-lora-slots">
            {loraSlots.slice(0, EXTRA_LORA_START).map((slot, i) => renderLoraSlot(slot, i))}
            <ExtraLoraFold label={extraLoraLabel(loraSlots)}>
              {loraSlots
                .slice(EXTRA_LORA_START)
                .map((slot, j) => renderLoraSlot(slot, j + EXTRA_LORA_START))}
            </ExtraLoraFold>
          </div>
        </div>

        <div className="form-group">
          <label>고정 접두 프롬프트</label>
          <input
            type="text"
            value={promptBlocks.fixedPrefix}
            onChange={(e) => setPromptBlocks((p) => ({ ...p, fixedPrefix: e.target.value }))}
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label>스타일 / LoRA 트리거</label>
          <input
            type="text"
            value={promptBlocks.styleTrigger}
            onChange={(e) => setPromptBlocks((p) => ({ ...p, styleTrigger: e.target.value }))}
            placeholder="masterpiece, best quality, detailed eyes"
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label>캐릭터</label>
          <input
            type="text"
            value={promptBlocks.character}
            onChange={(e) => setPromptBlocks((p) => ({ ...p, character: e.target.value }))}
            placeholder="1girl, solo, ..."
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label>의상</label>
          <input
            type="text"
            value={promptBlocks.outfit}
            onChange={(e) => setPromptBlocks((p) => ({ ...p, outfit: e.target.value }))}
            placeholder="clothing, accessories..."
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label>구도</label>
          <input
            type="text"
            value={promptBlocks.pose}
            onChange={(e) => setPromptBlocks((p) => ({ ...p, pose: e.target.value }))}
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label>배경</label>
          <input
            type="text"
            value={promptBlocks.background}
            onChange={(e) => setPromptBlocks((p) => ({ ...p, background: e.target.value }))}
            placeholder="선택 입력"
            disabled={loading}
          />
        </div>
        <p className="form-hint">감정 프롬프트는 img-emotion-config.json에서 자동 적용됩니다 (구도와 배경 사이).</p>

        <div className="form-group ep-negative-extra">
          <label>Negative (배경 및 기타 수정)</label>
          <textarea
            value={promptBlocks.negativeExtra}
            onChange={(e) => setPromptBlocks((p) => ({ ...p, negativeExtra: e.target.value }))}
            placeholder="고정 negative 뒤에 붙는 보조 프롬프트 (배경·기타 수정용)"
            rows={3}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label>업스케일 시드 횟수 (최소 3, Neutral 제외)</label>
          <input
            type="number"
            min={3}
            value={upscaleSeedCount}
            onChange={(e) => setUpscaleSeedCount(Math.max(3, parseInt(e.target.value, 10) || 3))}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={useOriginSubfolder}
              onChange={(e) => setUseOriginSubfolder(e.target.checked)}
              disabled={loading}
            />
            <span>하위 폴더 &quot;원본&quot; 사용 (있을 경우)</span>
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="button-row">
          <button
            type="button"
            onClick={handleScan}
            disabled={scanning || loading || !workspaceReady}
          >
            {scanning ? "스캔 중..." : "📂 스캔"}
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={loading || !workspaceReady}
          >
            {loading ? "큐에 추가 중..." : "파이프라인 큐에 추가"}
          </button>
        </div>
        {scanResult && (
          <div className="scan-results-mini">
            <p>✅ {scanResult.images}개 원본</p>
            <p>
              생성 {scanResult.pending} · 스킵 {scanResult.skipped}
            </p>
          </div>
        )}

        {/* Queue & Jobs */}
        {queueState && queueState.jobs.length > 0 && (
          <div className="pipeline-queue-section">
            <h3>작업 목록 (대기 {queueState.queue.length} / 실행 중: {queueState.currentJobIds?.length ?? (queueState.currentJobId ? 1 : 0)})</h3>
            <ul className="pipeline-job-list">
              {queueState.jobs.map((j) => (
                <li
                  key={j.jobId}
                  className={`pipeline-job-item ${j.status} ${selectedJobId === j.jobId ? "selected" : ""}`}
                  onClick={() => setSelectedJobId(j.jobId)}
                >
                  <span className="job-id">{j.jobId.slice(0, 8)}</span>
                  <span className="job-status">{j.status}</span>
                  {j.totalSteps > 0 && (
                    <span className="job-progress">
                      {j.currentStep}/{j.totalSteps}
                    </span>
                  )}
                  {(j.status === "running" || j.status === "pending") && (
                    <button
                      className="job-stop-btn"
                      onClick={(e) => { e.stopPropagation(); handleStop(j.jobId); }}
                    >
                      정지
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {selectedJob && (
              <div className="pipeline-status">
                <h4>
                  선택 작업: {selectedJob.jobId.slice(0, 8)} — {selectedJob.status}
                  {(selectedJob.status === "running" || selectedJob.status === "pending") && (
                    <button
                      className="job-stop-btn"
                      style={{ marginLeft: "0.5rem" }}
                      onClick={() => handleStop(selectedJob.jobId)}
                    >
                      정지
                    </button>
                  )}
                </h4>
                {selectedJob.totalSteps > 0 && (
                  <p>
                    진행: {selectedJob.currentStep} / {selectedJob.totalSteps}
                  </p>
                )}
                {selectedJob.error && <p className="status-error">{selectedJob.error}</p>}
                <div className="pipeline-logs">
                  {selectedJob.logs.map((line, i) => (
                    <div key={i} className="log-line">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
