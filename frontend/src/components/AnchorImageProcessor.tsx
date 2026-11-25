import { useState, useEffect, useRef, useMemo } from "react";
import {
  comfyClient,
  type ComfyInstanceInfo,
  groupInstancesByPod,
} from "../api/comfy-client";
import {
  anchorImageClient,
  ANCHOR_IMAGE_LABELS,
  type AnchorImageJobStatus,
  type AnchorImageLabel,
  type AnchorImageQueueState,
} from "../api/anchor-image-client";
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
import "./BannerProcessor.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3002/ws";

type LoraSlot = LoraSlotState;

const DEFAULT_FIXED_PREFIX =
  "(artist:tianliang duohe fangdongye:0.9), artist:ciloranko, artist:noyu, noyu23386566,ningen mame, (artist:sho:0.8264462809917354), (sho lwlw:0.9090909090909091),(artist:kedama_milk:0.5),(bee_\\(deadflow\\):0.7),artist:dino,(artist:fkey:0.8),(artist:wlop:1),year 2023,";
const DEFAULT_FIXED_SUFFIX =
  "depth of field,dynamic lighting,light particle, best quality, very aesthetic, highres, absurdres";
const DEFAULT_FIXED_NEGATIVE =
  "censored,censor,censor bar,negative_hand, NegfeetV2, bad anatomy,blurry,(worst quality:1.8),low quality,hands bad,face bad,(normal quality:1.3),bad hands,[extra fingers],mutated hands and fingers,extra legs,extra arms,duplicate,cropped,text,jpeg,artifacts,signature,watermark,username,blurry,artist name,trademark,title,multiple view,Reference sheet,long body,multiple breasts,mutated,bad anatomy,disfigured,bad proportions,duplicate,bad feet,artist name,ugly,text font ui,missing limb,monochrome";

const DEFAULT_COMPOSITION_POSE =
  "looking at viewer, facing forward, cowboy shot,";
const DEFAULT_NUDE_SUFFIX =
  "nude, completely nude, fully nude, naked, completely naked, fully naked, no clothes, bare body, nude body, naked body, bare skin, exposed body, all nude, totally nude, no clothing, undressed, unclothed,";

function CollapsibleBlock({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`ib-prompt-block collapsible ${open ? "open" : ""}`}>
      <div className="ib-prompt-block-header" onClick={() => setOpen(!open)}>
        <span className="ib-collapse-arrow">{open ? "▼" : "▶"}</span>
        <span className="ib-prompt-block-label">{label}</span>
      </div>
      {open && <div className="ib-prompt-block-body">{children}</div>}
    </div>
  );
}

export default function AnchorImageProcessor() {
  const [instances, setInstances] = useState<ComfyInstanceInfo[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [loraSlots, setLoraSlots] = useState<LoraSlot[]>(() => defaultLoraSlots());
  const [loraFilter, setLoraFilter] = useState("");
  const { loraList, loadingLoras, listReady, listError, refreshLoras } =
    useInstanceLoras(selectedInstance);

  const [fixedPrefix, setFixedPrefix] = useState(DEFAULT_FIXED_PREFIX);
  const [styleTrigger, setStyleTrigger] = useState("");
  const [character, setCharacter] = useState("");
  const [outfit, setOutfit] = useState("");
  const [backgroundPositive, setBackgroundPositive] = useState("");
  const [fixedSuffix, setFixedSuffix] = useState(DEFAULT_FIXED_SUFFIX);
  const [fixedNegative, setFixedNegative] = useState(DEFAULT_FIXED_NEGATIVE);
  const [backgroundNegative, setBackgroundNegative] = useState("");
  const [videoPrefixPrompt, setVideoPrefixPrompt] = useState("");
  const [showVideoPrompt, setShowVideoPrompt] = useState(false);
  const [presetOutfitMode, setPresetOutfitMode] = useState<"preset" | "nude">(
    "preset",
  );

  const [compositionPose, setCompositionPose] = useState(DEFAULT_COMPOSITION_POSE);
  const [anchorAspect, setAnchorAspect] = useState<
    "portrait" | "landscape" | "shortform" | "custom"
  >("shortform");
  const [customWidth, setCustomWidth] = useState(720);
  const [customHeight, setCustomHeight] = useState(1280);

  const [batchSize, setBatchSize] = useState(4);
  const { character: wsCharacter, spot: wsSpot, paths, workspaceReady, resolveError } = useWorkspace();
  const outputPath = paths?.emotionImages ?? "";
  const workspacePresetName = wsCharacter.trim() && wsSpot.trim() ? `${wsCharacter.trim()} ${wsSpot.trim()}` : "";

  const [queueState, setQueueState] = useState<AnchorImageQueueState | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [anchorUiMessage, setAnchorUiMessage] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const previewJob = useMemo(() => {
    if (!queueState?.jobs.length) return undefined;
    return queueState.jobs.find(
      (j) =>
        j.status === "completed" &&
        j.resultFiles &&
        j.resultFiles.length > 0,
    );
  }, [queueState]);

  const handleSaveAs = async (
    jobId: string,
    imageIndex: number,
    label: AnchorImageLabel,
  ) => {
    const key = `${jobId}-${imageIndex}-${label}`;
    setSavingKey(key);
    setAnchorUiMessage(null);
    setError(null);
    try {
      const { fileName } = await anchorImageClient.saveResultAs(
        jobId,
        imageIndex,
        label,
      );
      setAnchorUiMessage(`저장됨: ${fileName} (감정별 이미지)`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  useEffect(() => {
    comfyClient
      .getComfyInstances()
      .then((list) => {
        setInstances(list);
        if (list.length > 0) setSelectedInstance((prev) => prev || list[0].id);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "anchor_image_queue" && msg.data) {
          setQueueState(msg.data as AnchorImageQueueState);
        }
        if (msg.type === "anchor_image_progress" && msg.data) {
          const job = msg.data as AnchorImageJobStatus;
          setQueueState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              jobs: prev.jobs.map((j) =>
                j.id === job.id ? { ...j, ...job } : j,
              ),
            };
          });
        }
      } catch {
        /* ignore */
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  useEffect(() => {
    anchorImageClient.getQueue().then(setQueueState).catch(console.error);
  }, []);

  const updateLoraSlot = (index: number, updates: Partial<LoraSlot>) => {
    setLoraSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, ...updates } : slot)),
    );
  };

  const renderLoraSlot = (slot: LoraSlot, i: number) => (
    <div
      key={i}
      className={`ib-lora-slot ${!slot.enabled ? "disabled" : ""}`}
    >
      <label className="ib-check">
        <input
          type="checkbox"
          checked={slot.enabled}
          onChange={(e) =>
            updateLoraSlot(i, { enabled: e.target.checked })
          }
        />
        <span>LoRA {i + 1}</span>
      </label>
      {slot.enabled && (
        <div className="ib-lora-body">
          <LoraNameSelect
            names={loraList}
            value={slot.loraName}
            onChange={(name) => updateLoraSlot(i, { loraName: name })}
            filter={loraFilter}
            className="ib-select ib-select-sm"
            loading={loadingLoras}
            listReady={listReady}
            listError={listError}
          />
          <div className="ib-strengths">
            <div>
              <label>Model</label>
              <input
                type="number"
                step="0.1"
                value={slot.strengthModel}
                onChange={(e) =>
                  updateLoraSlot(i, {
                    strengthModel: parseFloat(e.target.value) || 0,
                  })
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
                  updateLoraSlot(i, {
                    strengthClip: parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const handlePresetLoad = (preset: CharacterPreset) => {
    if (preset.fixedPrefix !== undefined) setFixedPrefix(preset.fixedPrefix);
    if (preset.styleTrigger !== undefined) setStyleTrigger(preset.styleTrigger);
    if (preset.character !== undefined) setCharacter(preset.character);
    if (presetOutfitMode === "nude") {
      setOutfit(DEFAULT_NUDE_SUFFIX);
    } else if (preset.outfit !== undefined) {
      setOutfit(preset.outfit);
    }
    if (preset.backgroundPositive !== undefined)
      setBackgroundPositive(preset.backgroundPositive);
    if (preset.fixedSuffix !== undefined) setFixedSuffix(preset.fixedSuffix);
    if (preset.fixedNegative !== undefined) setFixedNegative(preset.fixedNegative);
    if (preset.backgroundNegative !== undefined)
      setBackgroundNegative(preset.backgroundNegative);
    if (preset.prefixPrompt !== undefined) setVideoPrefixPrompt(preset.prefixPrompt);
    if (preset.compositionPose !== undefined)
      setCompositionPose(preset.compositionPose);
    if (
      preset.anchorAspect === "portrait" ||
      preset.anchorAspect === "landscape" ||
      preset.anchorAspect === "shortform" ||
      preset.anchorAspect === "custom"
    ) {
      setAnchorAspect(preset.anchorAspect);
    }
    if (typeof preset.anchorWidth === "number") setCustomWidth(preset.anchorWidth);
    if (typeof preset.anchorHeight === "number") setCustomHeight(preset.anchorHeight);
    setSelectedInstance(resolvePresetInstanceId(preset.comfyInstanceId, instances));
    if (preset.loraSlots?.length) {
      setLoraSlots(padLoraSlots(preset.loraSlots));
    }
  };

  const getCurrentSettingsForPreset = () => ({
    fixedPrefix,
    styleTrigger,
    character,
    outfit,
    backgroundPositive,
    fixedSuffix,
    fixedNegative,
    backgroundNegative,
    prefixPrompt: videoPrefixPrompt,
    compositionPose,
    anchorAspect,
    anchorWidth: customWidth,
    anchorHeight: customHeight,
    comfyInstanceId: selectedInstance,
    loraSlots: loraSlots.map((s) => ({
      enabled: s.enabled,
      loraName: s.loraName,
      strengthModel: s.strengthModel,
      strengthClip: s.strengthClip,
    })),
  });

  const resetForm = () => {
    setFixedPrefix(DEFAULT_FIXED_PREFIX);
    setStyleTrigger("");
    setCharacter("");
    setOutfit("");
    setBackgroundPositive("");
    setFixedSuffix(DEFAULT_FIXED_SUFFIX);
    setFixedNegative(DEFAULT_FIXED_NEGATIVE);
    setBackgroundNegative("");
    setCompositionPose(DEFAULT_COMPOSITION_POSE);
    setAnchorAspect("shortform");
    setCustomWidth(720);
    setCustomHeight(1280);
    setLoraSlots(defaultLoraSlots());
  };

  const handleStart = async () => {
    setError(null);
    if (!workspaceReady || !outputPath) {
      setError(
        resolveError ||
          "상단에서 작업 공간(캐릭터·스팟)을 선택하세요. 생성 결과는 메모리 미리보기이며, 라벨 저장 시에만 감정별 이미지 폴더에 기록됩니다.",
      );
      return;
    }
    try {
      await anchorImageClient.startJob({
        instanceId: selectedInstance,
        loras: loraSlots,
        positiveBlocks: {
          fixedPrefix,
          styleTrigger,
          character,
          outfit,
          backgroundPositive,
          fixedSuffix,
        },
        negativeBlocks: {
          fixedNegative,
          backgroundNegative,
        },
        batchSize,
        outputPath,
        compositionPose: compositionPose.trim() || "",
        aspect: anchorAspect,
        ...(anchorAspect === "custom"
          ? { width: customWidth, height: customHeight }
          : {}),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handleStop = async () => {
    const currentId = queueState?.currentJobId;
    if (!currentId) return;
    try {
      await anchorImageClient.stopJob(currentId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const currentJob = queueState?.currentJobId
    ? queueState.jobs.find((j) => j.id === queueState.currentJobId)
    : undefined;
  const isRunning = Boolean(currentJob?.status === "running");
  const progressPct =
    currentJob && currentJob.totalTasks > 0
      ? Math.round((currentJob.completedTasks / currentJob.totalTasks) * 100)
      : 0;

  return (
    <div className="ib-container">
      <header className="ib-header">
        <h1>앵커 이미지 제작</h1>
        <p>
          단일 랜덤 시드 · 배치 크기만 조절 · 프롬프트 공란으로 시험 실행 가능 · 완료 후
          메모리 미리보기만 제공 · 라벨 버튼으로만 감정별 이미지 폴더에 PNG 저장
        </p>
      </header>

      <div className="preset-with-outfit-mode">
        <PresetPicker
          onLoad={handlePresetLoad}
          getCurrentSettings={getCurrentSettingsForPreset}
          preferredPresetName={workspacePresetName}
          autoLoadOnPreferredChange
        />
        <div className="preset-outfit-mode">
          <span className="preset-outfit-label">불러오기 시 의상:</span>
          <label className="preset-outfit-radio">
            <input
              type="radio"
              name="anchorOutfitMode"
              checked={presetOutfitMode === "nude"}
              onChange={() => setPresetOutfitMode("nude")}
            />
            Nude
          </label>
          <label className="preset-outfit-radio">
            <input
              type="radio"
              name="anchorOutfitMode"
              checked={presetOutfitMode === "preset"}
              onChange={() => setPresetOutfitMode("preset")}
            />
            프리셋 의상 그대로
          </label>
        </div>
      </div>
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

      <div className="ib-layout">
        <div className="ib-settings">
          <div className="ib-section">
            <label className="ib-label">ComfyUI Instance</label>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="ib-select"
            >
              {groupInstancesByPod(instances).map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.instances.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}
                      {inst.port ? ` :${inst.port}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="ib-section ib-lora-section">
            <div className="ib-section-row">
              <h3>LoRA Configuration</h3>
              <LoraSearchInput value={loraFilter} onChange={setLoraFilter} />
              <button
                className="ib-btn-sm"
                onClick={refreshLoras}
                disabled={loadingLoras}
              >
                {loadingLoras ? "..." : "Refresh"}
              </button>
            </div>
            {loraSlots.slice(0, EXTRA_LORA_START).map((slot, i) => renderLoraSlot(slot, i))}
            <CollapsibleBlock label={extraLoraLabel(loraSlots)}>
              {loraSlots
                .slice(EXTRA_LORA_START)
                .map((slot, j) => renderLoraSlot(slot, j + EXTRA_LORA_START))}
            </CollapsibleBlock>
          </div>

          <div className="ib-divider" />
          <h3 className="ib-section-title">Positive Prompt</h3>

          <CollapsibleBlock label="Fixed Prefix (artists)">
            <textarea
              value={fixedPrefix}
              onChange={(e) => setFixedPrefix(e.target.value)}
              rows={3}
            />
          </CollapsibleBlock>

          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Style LoRA Trigger</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={styleTrigger}
                onChange={(e) => setStyleTrigger(e.target.value)}
                rows={1}
                placeholder="e.g. ahemaru, ahemaru style,"
              />
            </div>
          </div>

          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Character</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={character}
                onChange={(e) => setCharacter(e.target.value)}
                rows={2}
                placeholder="1 girl, solo, hair, eyes, body..."
              />
            </div>
          </div>

          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Outfit</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={outfit}
                onChange={(e) => setOutfit(e.target.value)}
                rows={2}
                placeholder="clothing, accessories..."
              />
            </div>
          </div>

          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Composition / Pose</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={compositionPose}
                onChange={(e) => setCompositionPose(e.target.value)}
                rows={5}
                placeholder="구도·포즈·액션 등 자유 입력 (배너 config 대신 직접 편집)"
              />
            </div>
          </div>

          <div className="ib-section">
            <label className="ib-label">캔버스 비율</label>
            <div className="ib-hint" style={{ marginBottom: "0.5rem" }}>
              {anchorAspect === "custom"
                ? "직접 입력: 가로·세로를 지정 (8의 배수로 자동 보정, 256~2048)"
                : "숏폼 720×1280 · 세로 1024×1536 · 가로 1536×1024"}
            </div>
            <select
              className="ib-select"
              value={anchorAspect}
              onChange={(e) =>
                setAnchorAspect(
                  e.target.value as
                    | "portrait"
                    | "landscape"
                    | "shortform"
                    | "custom",
                )
              }
            >
              <option value="shortform">숏폼 (720×1280)</option>
              <option value="portrait">세로 (1024×1536)</option>
              <option value="landscape">가로 (1536×1024)</option>
              <option value="custom">직접 입력</option>
            </select>
            {anchorAspect === "custom" && (
              <div className="ib-strengths" style={{ marginTop: "0.5rem" }}>
                <div>
                  <label>가로 (width)</label>
                  <input
                    type="number"
                    min={256}
                    max={2048}
                    step={8}
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label>세로 (height)</label>
                  <input
                    type="number"
                    min={256}
                    max={2048}
                    step={8}
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Background Positive</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={backgroundPositive}
                onChange={(e) => setBackgroundPositive(e.target.value)}
                rows={2}
                placeholder="background / scene description"
              />
            </div>
          </div>

          <CollapsibleBlock label="Fixed Suffix (quality)">
            <textarea
              value={fixedSuffix}
              onChange={(e) => setFixedSuffix(e.target.value)}
              rows={2}
            />
          </CollapsibleBlock>

          <div className="ib-divider" />
          <h3 className="ib-section-title">Negative Prompt</h3>

          <CollapsibleBlock label="Fixed Negative (standard)">
            <textarea
              value={fixedNegative}
              onChange={(e) => setFixedNegative(e.target.value)}
              rows={3}
            />
          </CollapsibleBlock>

          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Background Negative</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={backgroundNegative}
                onChange={(e) => setBackgroundNegative(e.target.value)}
                rows={2}
                placeholder="outdoor, bedroom, ..."
              />
            </div>
          </div>

          <div className="ib-divider" />

          <div className="ib-section">
            <label className="ib-label">Batch Size</label>
            <p className="ib-hint" style={{ margin: "0 0 0.35rem" }}>
              한 번의 요청에서 생성할 이미지 수입니다. 랜덤 시드는 1회만 사용됩니다.
            </p>
            <input
              type="number"
              min={1}
              max={16}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="ib-input"
            />
          </div>

          <div className="ib-section">
            <label className="ib-label">라벨 저장 위치 (감정별 이미지)</label>
            <div className="ib-readonly-path" title={outputPath}>
              {workspaceReady ? outputPath : "작업 공간을 선택하세요"}
            </div>
          </div>
        </div>

        <div className="ib-right">
          <div className="ib-card">
            <h3>실행 요약</h3>
            <div className="ib-summary">
              <span>
                <strong>1</strong>회 생성 · 시드 1개 · 배치 <strong>{batchSize}</strong>
              </span>
            </div>
          </div>

          <div className="ib-actions">
            <button
              className="ib-btn-primary"
              onClick={handleStart}
              disabled={!workspaceReady}
            >
              생성 시작
            </button>
            {isRunning && (
              <button className="ib-btn-danger" onClick={handleStop}>
                현재 작업 중지
              </button>
            )}
            <button
              type="button"
              className="ib-btn-secondary"
              onClick={resetForm}
              title="프롬프트·로라만 기본값으로 초기화"
            >
              초기화
            </button>
          </div>

          {error && <div className="ib-error">{error}</div>}

          {queueState &&
            (queueState.queue.length > 0 ||
              queueState.currentJobId ||
              queueState.jobs.length > 0) && (
              <div className="ib-card ib-progress-card">
                <h3>작업 큐</h3>
                <div className="ib-queue-summary">
                  <span>대기: {queueState.queue.length}건</span>
                  {(queueState.currentJobIds?.length ??
                    (queueState.currentJobId ? 1 : 0)) > 0 && (
                    <span>
                      실행 중: {queueState.currentJobIds?.length ?? 1}건
                    </span>
                  )}
                </div>
                <ul className="ib-job-list">
                  {queueState.jobs.slice(0, 20).map((j) => (
                    <li key={j.id} className="ib-job-item">
                      <span className="ib-job-id">{j.id.slice(0, 8)}</span>
                      <span className={`ib-status-badge ${j.status}`}>
                        {j.status}
                      </span>
                      <span className="ib-job-tasks">
                        {j.completedTasks}/{j.totalTasks}
                      </span>
                    </li>
                  ))}
                </ul>

                {currentJob && (
                  <>
                    <h4 className="ib-current-title">현재 작업</h4>
                    <div className="ib-progress-bar-wrap">
                      <div className="ib-progress-bar">
                        <div
                          className="ib-progress-fill"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="ib-progress-pct">{progressPct}%</span>
                    </div>
                    <div className="ib-progress-meta">
                      <span>
                        {currentJob.completedTasks} / {currentJob.totalTasks}{" "}
                        tasks
                      </span>
                      {currentJob.currentTask && (
                        <span>Current: {currentJob.currentTask}</span>
                      )}
                    </div>
                    <div className="ib-logs">
                      {currentJob.logs
                        .slice(-30)
                        .reverse()
                        .map((log, i) => (
                          <div key={i} className="ib-log-line">
                            {log}
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}
        </div>
      </div>

      {previewJob && previewJob.resultFiles && (
        <div className="anchor-results">
          <h2 className="anchor-results-title">생성 결과 (미리보기)</h2>
          <p className="anchor-results-hint">
            다운로드 없이 확인합니다. 버튼은 출력 경로에{" "}
            <code>sit_neutral.png</code> 형식으로 복사합니다. 같은 라벨을 다시 누르면
            덮어씁니다.
          </p>
          <div className="anchor-results-grid">
            {previewJob.resultFiles.map((fname, imageIndex) => (
              <div key={`${previewJob.id}-${fname}-${imageIndex}`} className="anchor-result-card">
                <div className="anchor-result-thumb">
                  <img
                    src={anchorImageClient.previewUrl(previewJob.id, imageIndex)}
                    alt={fname}
                    loading="lazy"
                  />
                </div>
                <div className="anchor-result-meta">{fname}</div>
                <div className="anchor-label-buttons">
                  {ANCHOR_IMAGE_LABELS.map((label) => {
                    const busy =
                      savingKey === `${previewJob.id}-${imageIndex}-${label}`;
                    return (
                      <button
                        key={label}
                        type="button"
                        className="anchor-label-btn"
                        disabled={!!savingKey}
                        onClick={() =>
                          handleSaveAs(previewJob.id, imageIndex, label)
                        }
                      >
                        {busy ? "…" : `${label}.png 로 저장`}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {anchorUiMessage && (
            <div className="anchor-results-message">{anchorUiMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
