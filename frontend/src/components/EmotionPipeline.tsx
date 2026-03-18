import { useState, useEffect, useCallback } from "react";
import { comfyClient, type ComfyInstanceInfo } from "../api/comfy-client";
import PresetPicker from "./PresetPicker";
import type { CharacterPreset } from "../api/presets-client";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3002";

interface PromptBlocks {
  styleTrigger: string;
  character: string;
  pose: string;
  emotion: string;
  background: string;
  /** Negative 보조: 배경 및 자잘한 걸 고치기 위한 프롬프트 */
  negativeExtra: string;
}

interface LoraSlot {
  enabled: boolean;
  loraName: string;
  strengthModel: number;
  strengthClip: number;
}

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

const defaultBlocks: PromptBlocks = {
  styleTrigger: "masterpiece, best quality, detailed eyes",
  character: "",
  pose: "looking at viewer, facing forward, cowboy shot",
  emotion: "",
  background: "",
  negativeExtra: "",
};

const DEFAULT_LORAS: LoraSlot[] = [
  { enabled: true, loraName: "", strengthModel: 1, strengthClip: 1 },
  { enabled: true, loraName: "", strengthModel: 1, strengthClip: 1 },
  { enabled: false, loraName: "", strengthModel: 1, strengthClip: 1 },
  { enabled: false, loraName: "", strengthModel: 1, strengthClip: 1 },
];

export default function EmotionPipeline() {
  const [instances, setInstances] = useState<ComfyInstanceInfo[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [promptBlocks, setPromptBlocks] = useState<PromptBlocks>(defaultBlocks);
  const [loraList, setLoraList] = useState<string[]>([]);
  const [loraSlots, setLoraSlots] = useState<LoraSlot[]>(() => JSON.parse(JSON.stringify(DEFAULT_LORAS)));
  const [loadingLoras, setLoadingLoras] = useState(false);
  const [upscaleSeedCount, setUpscaleSeedCount] = useState(3);
  const [useOriginSubfolder, setUseOriginSubfolder] = useState(true);
  const [videoPrefixPrompt, setVideoPrefixPrompt] = useState("");
  const [showVideoPrompt, setShowVideoPrompt] = useState(false);
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    comfyClient.getComfyInstances().then((list) => {
      setInstances(list);
      if (list.length && !selectedInstance) setSelectedInstance(list[0].id);
    });
  }, []);

  const fetchLoras = useCallback(async () => {
    if (!selectedInstance) return;
    setLoadingLoras(true);
    try {
      const loras = await comfyClient.getLoraList(selectedInstance);
      setLoraList(loras);
    } finally {
      setLoadingLoras(false);
    }
  }, [selectedInstance]);

  useEffect(() => {
    if (selectedInstance) fetchLoras();
  }, [selectedInstance, fetchLoras]);

  const updateLoraSlot = (index: number, updates: Partial<LoraSlot>) => {
    setLoraSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, ...updates } : slot))
    );
  };

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
      ...(preset.character !== undefined && { character: preset.character }),
      ...(preset.pose !== undefined && { pose: preset.pose }),
      ...(preset.backgroundPositive !== undefined && { background: preset.backgroundPositive }),
      ...(negValue !== undefined && { negativeExtra: negValue }),
    }));
    if (preset.prefixPrompt !== undefined) setVideoPrefixPrompt(preset.prefixPrompt);
    if (preset.loraSlots?.length) {
      setLoraSlots(preset.loraSlots.map((s) => ({
        enabled: s.enabled,
        loraName: s.loraName,
        strengthModel: s.strengthModel,
        strengthClip: s.strengthClip,
      })));
    }
  };

  const getCurrentSettingsForPreset = () => ({
    character: promptBlocks.character,
    pose: promptBlocks.pose,
    backgroundPositive: promptBlocks.background,
    negativeExtra: promptBlocks.negativeExtra,
    backgroundNegative: promptBlocks.negativeExtra,
    prefixPrompt: videoPrefixPrompt,
    loraSlots: loraSlots.map((s) => ({
      enabled: s.enabled,
      loraName: s.loraName,
      strengthModel: s.strengthModel,
      strengthClip: s.strengthClip,
    })),
  });

  const handleStop = async (jobId: string) => {
    try {
      await fetch(`${API_BASE}/api/emotion-pipeline/${jobId}/stop`, { method: "POST" });
      fetchQueue();
    } catch {
      // ignore
    }
  };

  const handleStart = async () => {
    if (!folderPath.trim()) {
      setError("이미지 폴더 경로를 입력하세요 (서버에서 접근 가능한 경로)");
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
            pose: promptBlocks.pose,
            emotion: promptBlocks.emotion,
            background: promptBlocks.background,
            negativeExtra: promptBlocks.negativeExtra,
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
          이미지 폴더를 스캔 → 얼굴 마스킹 → 4종 감정(Happy, Aroused, Sad, Angry)별 Inpaint → 업스케일(시드 N회) → Emotions/감정별 폴더에 저장.
          서버에서 접근 가능한 폴더 경로를 입력하세요. 작업은 큐에 쌓이며 순서대로 실행됩니다.
        </p>
      </header>

      <PresetPicker onLoad={handlePresetLoad} getCurrentSettings={getCurrentSettingsForPreset} />
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
          <label>이미지 폴더 경로</label>
          <input
            type="text"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            placeholder="예: c:\Users\...\이미지\침실"
            disabled={loading}
          />
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
          <button
            type="button"
            className="ep-btn-sm"
            onClick={fetchLoras}
            disabled={loadingLoras || !selectedInstance}
          >
            {loadingLoras ? "..." : "목록 새로고침"}
          </button>
          <div className="ep-lora-slots">
            {loraSlots.map((slot, i) => (
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
                    <select
                      value={slot.loraName}
                      onChange={(e) => updateLoraSlot(i, { loraName: e.target.value })}
                      className="ep-select"
                    >
                      <option value="">-- 선택 --</option>
                      {loraList.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
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
            ))}
          </div>
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
          <label>업스케일 시드 횟수 (최소 3)</label>
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
          <button type="button" onClick={handleStart} disabled={loading}>
            {loading ? "큐에 추가 중..." : "파이프라인 큐에 추가"}
          </button>
        </div>

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
