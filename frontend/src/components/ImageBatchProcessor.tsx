import { useState, useEffect, useMemo, useRef } from "react";
import {
  comfyClient,
  type ComfyInstanceInfo,
  groupInstancesByPod,
} from "../api/comfy-client";
import {
  imageBatchClient,
  type PoseInfo,
  type ImageBatchJobStatus,
  type ImageBatchQueueState,
} from "../api/image-batch-client";
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
import "./ImageBatchProcessor.css";

type LoraSlot = LoraSlotState;

interface PoseRow {
  name: string;
  selected: boolean;
  expression: string;
  availableExpressions: string[];
  handFix: boolean;
}

const DEFAULT_HAND_FIX_POSITIVE =
  "clear fingers, distinct fingers, defined fingers, separated fingers, detailed hand, correct finger count, five fingers, anatomically correct hand, proper finger spacing, clean hand anatomy";

const DEFAULT_HAND_FIX_NEGATIVE =
  "4 fingers, 6 fingers, fused fingers, merged fingers, extra fingers, missing fingers, deformed fingers, twisted fingers, bent fingers, broken fingers, bad hands, poorly drawn hands, mutated hands, extra hands, missing hands";

const DEFAULT_FIXED_PREFIX =
  "(artist:tianliang duohe fangdongye:0.9), artist:ciloranko, artist:noyu, noyu23386566,ningen mame, (artist:sho:0.8264462809917354), (sho lwlw:0.9090909090909091),(artist:kedama_milk:0.5),(bee_\\(deadflow\\):0.7),artist:dino,(artist:fkey:0.8),(artist:wlop:1),year 2023,";
const DEFAULT_FIXED_SUFFIX =
  "depth of field,dynamic lighting,light particle, best quality, very aesthetic, highres, absurdres";
const DEFAULT_FIXED_NEGATIVE =
  "censored,censor,censor bar,negative_hand, NegfeetV2, bad anatomy,blurry,(worst quality:1.8),low quality,hands bad,face bad,(normal quality:1.3),bad hands,[extra fingers],mutated hands and fingers,extra legs,extra arms,duplicate,cropped,text,jpeg,artifacts,signature,watermark,username,blurry,artist name,trademark,title,multiple view,Reference sheet,long body,multiple breasts,mutated,bad anatomy,disfigured,bad proportions,duplicate,bad feet,artist name,ugly,text font ui,missing limb,monochrome";
const DEFAULT_NUDE_SUFFIX = 
"nude, completely nude, fully nude, naked, completely naked, fully naked, no clothes, bare body, nude body, naked body, bare skin, exposed body, all nude, totally nude, no clothing, undressed, unclothed,"

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3002/ws";

function CollapsibleBlock({
  label,
  children,
  defaultOpen = false,
  tag,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  tag?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`ib-prompt-block collapsible ${open ? "open" : ""}`}>
      <div className="ib-prompt-block-header" onClick={() => setOpen(!open)}>
        <span className="ib-collapse-arrow">{open ? "▼" : "▶"}</span>
        <span className="ib-prompt-block-label">{label}</span>
        {tag ? <span className="ib-prompt-block-tag fixed">{tag}</span> : null}
      </div>
      {open && <div className="ib-prompt-block-body">{children}</div>}
    </div>
  );
}

export default function ImageBatchProcessor() {
  // ComfyUI instances
  const [instances, setInstances] = useState<ComfyInstanceInfo[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [loraSlots, setLoraSlots] = useState<LoraSlot[]>(() => defaultLoraSlots());
  const [loraFilter, setLoraFilter] = useState("");
  const { loraList, loadingLoras, listReady, listError, refreshLoras } =
    useInstanceLoras(selectedInstance);

  // Prompt blocks (shared)
  const [fixedPrefix, setFixedPrefix] = useState(DEFAULT_FIXED_PREFIX);
  const [styleTrigger, setStyleTrigger] = useState("");
  const [character, setCharacter] = useState("");
  const [outfit, setOutfit] = useState(DEFAULT_NUDE_SUFFIX);
  const [backgroundPositive, setBackgroundPositive] = useState("");
  const [fixedSuffix, setFixedSuffix] = useState(DEFAULT_FIXED_SUFFIX);
  const [fixedNegative, setFixedNegative] = useState(DEFAULT_FIXED_NEGATIVE);
  const [backgroundNegative, setBackgroundNegative] = useState("");

  // Hand/foot fix prompts
  const [handFixPositive, setHandFixPositive] = useState(DEFAULT_HAND_FIX_POSITIVE);
  const [handFixNegative, setHandFixNegative] = useState(DEFAULT_HAND_FIX_NEGATIVE);

  // Pose selection
  const [poseRows, setPoseRows] = useState<PoseRow[]>([]);
  const [defaultExpression, setDefaultExpression] = useState("Normal");
  const [allSelected, setAllSelected] = useState(true);
  const [promptPatchEnabled, setPromptPatchEnabled] = useState(false);
  const [promptPatchAdd, setPromptPatchAdd] = useState("");
  const [promptPatchRemove, setPromptPatchRemove] = useState("");
  const [promptPatchAddPosition, setPromptPatchAddPosition] = useState<
    "prepend" | "append"
  >("append");

  // Video prefix prompt (preset storage only, not used for image generation)
  const [videoPrefixPrompt, setVideoPrefixPrompt] = useState("");
  const [showVideoPrompt, setShowVideoPrompt] = useState(false);

  // Preset outfit mode: load from preset or force nude
  const [presetOutfitMode, setPresetOutfitMode] = useState<"preset" | "nude">("nude");

  // Canvas size + batch size + output (포즈당 3회 완전 랜덤 시드)
  const [imageAspect, setImageAspect] = useState<
    "portrait" | "shortform" | "custom"
  >("shortform");
  const [customWidth, setCustomWidth] = useState(720);
  const [customHeight, setCustomHeight] = useState(1280);
  const [batchSize, setBatchSize] = useState(4);
  const { character: wsCharacter, spot: wsSpot, paths, workspaceReady, resolveError } = useWorkspace();
  const outputPath = paths?.imageAdult ?? "";
  const workspacePresetName = wsCharacter.trim() && wsSpot.trim() ? `${wsCharacter.trim()} ${wsSpot.trim()}` : "";

  // Job queue state (대기/실행/완료 목록)
  const [queueState, setQueueState] = useState<ImageBatchQueueState | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);

  // Load instances
  useEffect(() => {
    comfyClient
      .getComfyInstances()
      .then((list) => {
        setInstances(list);
        if (list.length > 0) setSelectedInstance((prev) => prev || list[0].id);
      })
      .catch(console.error);
  }, []);

  // Load poses
  useEffect(() => {
    imageBatchClient
      .getPoses()
      .then((poses) => {
        setPoseRows(
          poses.map((p: PoseInfo) => {
            const defaultHandFix = ["CumInMouth", "CumInMouth2", "CumInMouth3", "Handjob", "Masturbation"].includes(p.name);
            return {
              name: p.name,
              selected: true,
              expression: p.expressions.includes("Normal")
                ? "Normal"
                : p.expressions[0],
              availableExpressions: p.expressions,
              handFix: defaultHandFix,
            };
          }),
        );
      })
      .catch(console.error);
  }, []);

  // WebSocket: queue state + progress
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "image_batch_queue" && msg.data) {
          setQueueState(msg.data as ImageBatchQueueState);
        }
        if (msg.type === "image_batch_progress" && msg.data) {
          const job = msg.data as ImageBatchJobStatus;
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

  // 초기 큐 상태 로드
  useEffect(() => {
    imageBatchClient.getQueue().then(setQueueState).catch(console.error);
  }, []);

  // Apply default expression to all poses
  const applyDefaultExpression = (expr: string) => {
    setDefaultExpression(expr);
    setPoseRows((prev) =>
      prev.map((r) => ({
        ...r,
        expression: r.availableExpressions.includes(expr) ? expr : r.expression,
      })),
    );
  };

  const toggleAll = (val: boolean) => {
    setAllSelected(val);
    setPoseRows((prev) => prev.map((r) => ({ ...r, selected: val })));
  };

  const updatePoseRow = (idx: number, updates: Partial<PoseRow>) => {
    setPoseRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...updates } : r)),
    );
  };

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

  const defaultExpressionOptions = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const row of poseRows) {
      for (const ex of row.availableExpressions) {
        if (!seen.has(ex)) {
          seen.add(ex);
          ordered.push(ex);
        }
      }
    }
    return ordered;
  }, [poseRows]);

  useEffect(() => {
    if (
      defaultExpressionOptions.length > 0 &&
      !defaultExpressionOptions.includes(defaultExpression)
    ) {
      setDefaultExpression(defaultExpressionOptions[0]);
    }
  }, [defaultExpressionOptions, defaultExpression]);

  const selectedPoses = poseRows.filter((r) => r.selected);
  const RUNS_PER_POSE = 3;
  const totalTasks = selectedPoses.reduce(
    (acc, p) => acc + RUNS_PER_POSE * (p.handFix ? 2 : 1),
    0,
  );
  const estimatedMinutes = Math.ceil((totalTasks * 60) / 60);

  const handlePresetLoad = (preset: CharacterPreset) => {
    if (preset.fixedPrefix !== undefined) setFixedPrefix(preset.fixedPrefix);
    if (preset.styleTrigger !== undefined) setStyleTrigger(preset.styleTrigger);
    if (preset.character !== undefined) setCharacter(preset.character);
    if (presetOutfitMode === "nude") {
      setOutfit(DEFAULT_NUDE_SUFFIX);
    } else if (preset.outfit !== undefined) {
      setOutfit(preset.outfit);
    }
    if (preset.backgroundPositive !== undefined) setBackgroundPositive(preset.backgroundPositive);
    if (preset.fixedSuffix !== undefined) setFixedSuffix(preset.fixedSuffix);
    if (preset.fixedNegative !== undefined) setFixedNegative(preset.fixedNegative);
    if (preset.backgroundNegative !== undefined) setBackgroundNegative(preset.backgroundNegative);
    if (preset.prefixPrompt !== undefined) setVideoPrefixPrompt(preset.prefixPrompt);
    setSelectedInstance(resolvePresetInstanceId(preset.comfyInstanceId, instances));
    if (preset.loraSlots?.length) {
      setLoraSlots(padLoraSlots(preset.loraSlots));
    }
    if (
      preset.imageAspect === "portrait" ||
      preset.imageAspect === "shortform" ||
      preset.imageAspect === "custom"
    ) {
      setImageAspect(preset.imageAspect);
    }
    if (typeof preset.imageWidth === "number") setCustomWidth(preset.imageWidth);
    if (typeof preset.imageHeight === "number") setCustomHeight(preset.imageHeight);
    if (preset.promptPatch) {
      setPromptPatchEnabled(!!preset.promptPatch.enabled);
      setPromptPatchAdd(preset.promptPatch.addText ?? "");
      setPromptPatchRemove(preset.promptPatch.removeText ?? "");
      setPromptPatchAddPosition(
        preset.promptPatch.addPosition === "prepend" ? "prepend" : "append",
      );
    } else {
      setPromptPatchEnabled(false);
      setPromptPatchAdd("");
      setPromptPatchRemove("");
      setPromptPatchAddPosition("append");
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
    comfyInstanceId: selectedInstance,
    loraSlots: loraSlots.map((s) => ({
      enabled: s.enabled,
      loraName: s.loraName,
      strengthModel: s.strengthModel,
      strengthClip: s.strengthClip,
    })),
    imageAspect,
    imageWidth: customWidth,
    imageHeight: customHeight,
    promptPatch: {
      enabled: promptPatchEnabled,
      addText: promptPatchAdd,
      removeText: promptPatchRemove,
      addPosition: promptPatchAddPosition,
    },
  });

  const resetFormForNextJob = () => {
    setFixedPrefix(DEFAULT_FIXED_PREFIX);
    setStyleTrigger("");
    setCharacter("");
    setOutfit("");
    setBackgroundPositive("");
    setFixedSuffix(DEFAULT_FIXED_SUFFIX);
    setFixedNegative(DEFAULT_FIXED_NEGATIVE);
    setBackgroundNegative("");
    setHandFixPositive(DEFAULT_HAND_FIX_POSITIVE);
    setHandFixNegative(DEFAULT_HAND_FIX_NEGATIVE);
    setLoraSlots(defaultLoraSlots());
    setImageAspect("shortform");
    setCustomWidth(720);
    setCustomHeight(1280);
  };

  const handleStart = async () => {
    setError(null);
    if (selectedPoses.length === 0) {
      setError("포즈를 하나 이상 선택하세요.");
      return;
    }
    if (!workspaceReady || !outputPath) {
      setError(
        resolveError ||
          "상단에서 작업 공간(캐릭터·스팟)을 선택하고 경로가 확인된 뒤 실행하세요.",
      );
      return;
    }

    try {
      await imageBatchClient.startBatch({
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
        handFixPositive,
        handFixNegative,
        poses: selectedPoses.map((p) => ({
          poseName: p.name,
          expression: p.expression,
          handFix: p.handFix,
        })),
        promptPatch: {
          enabled: promptPatchEnabled,
          addText: promptPatchAdd,
          removeText: promptPatchRemove,
          addPosition: promptPatchAddPosition,
        },
        batchSize,
        outputPath,
        aspect: imageAspect,
        ...(imageAspect === "custom"
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
      await imageBatchClient.stopBatch(currentId);
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
        <h1>Image Batch Generation</h1>
        <p>pose config + prompt blocks + auto generation</p>
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
              name="outfitMode"
              checked={presetOutfitMode === "nude"}
              onChange={() => setPresetOutfitMode("nude")}
            />
            Nude
          </label>
          <label className="preset-outfit-radio">
            <input
              type="radio"
              name="outfitMode"
              checked={presetOutfitMode === "preset"}
              onChange={() => setPresetOutfitMode("preset")}
            />
            프리셋 의상 그대로
          </label>
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
      </div>

      <div className="ib-layout">
        {/* Left Panel: Settings */}
        <div className="ib-settings">
          {/* ComfyUI Instance */}
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

          {/* LoRA Configuration */}
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

          {/* Positive Prompt Blocks */}
          <h3 className="ib-section-title">Positive Prompt</h3>

          <CollapsibleBlock label="Fixed Prefix (artists)" tag="fixed">
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
              <span className="ib-prompt-block-label">
                Composition / Pose
              </span>
              <span className="ib-prompt-block-tag config">from config</span>
            </div>
            <div className="ib-prompt-block-body">
              <p className="ib-hint">
                Composition is loaded per pose from img-pose-config.json
              </p>
            </div>
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

          <CollapsibleBlock label="Fixed Suffix (quality)" tag="fixed">
            <textarea
              value={fixedSuffix}
              onChange={(e) => setFixedSuffix(e.target.value)}
              rows={2}
            />
          </CollapsibleBlock>

          <div className="ib-divider" />

          {/* Negative Prompt Blocks */}
          <h3 className="ib-section-title">Negative Prompt</h3>

          <CollapsibleBlock label="Fixed Negative (standard)" tag="fixed">
            <textarea
              value={fixedNegative}
              onChange={(e) => setFixedNegative(e.target.value)}
              rows={3}
            />
          </CollapsibleBlock>

          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">
                NSFW Negative
              </span>
              <span className="ib-prompt-block-tag config">from config</span>
            </div>
            <div className="ib-prompt-block-body">
              <p className="ib-hint">
                NSFW negatives are loaded per pose from img-pose-config.json
              </p>
            </div>
          </div>

          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Background Negative</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={backgroundNegative}
                onChange={(e) => setBackgroundNegative(e.target.value)}
                rows={2}
                placeholder="outdoor, bedroom, kitchen, ..."
              />
            </div>
          </div>

          <div className="ib-divider" />

          {/* Hand/Foot Fix */}
          <h3 className="ib-section-title">Hand/Foot Fix (global text)</h3>
          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Positive</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={handFixPositive}
                onChange={(e) => setHandFixPositive(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <div className="ib-prompt-block">
            <div className="ib-prompt-block-header">
              <span className="ib-prompt-block-label">Negative</span>
            </div>
            <div className="ib-prompt-block-body">
              <textarea
                value={handFixNegative}
                onChange={(e) => setHandFixNegative(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="ib-divider" />

          {/* 포즈당 3회 완전 랜덤 시드 */}
          <p className="ib-meta" style={{ marginBottom: "0.75rem" }}>
            포즈당 3번 요청 (시드 완전 랜덤)
          </p>

          <div className="ib-section">
            <label className="ib-label">캔버스 비율</label>
            <div className="ib-hint" style={{ marginBottom: "0.5rem" }}>
              {imageAspect === "custom"
                ? "직접 입력: 가로·세로를 지정 (8의 배수로 자동 보정, 256~2048)"
                : "숏폼 720×1280 · 세로 1024×1536"}
            </div>
            <select
              className="ib-select"
              value={imageAspect}
              onChange={(e) =>
                setImageAspect(
                  e.target.value as "portrait" | "shortform" | "custom",
                )
              }
            >
              <option value="shortform">숏폼 (720×1280)</option>
              <option value="portrait">세로 (1024×1536)</option>
              <option value="custom">직접 입력</option>
            </select>
            {imageAspect === "custom" && (
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

          <div className="ib-row">
            <div className="ib-section" style={{ flex: 1 }}>
              <label className="ib-label">Batch Size</label>
              <input
                type="number"
                min={1}
                max={16}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="ib-input"
              />
            </div>
          </div>

          <div className="ib-section">
            <label className="ib-label">저장 위치 (성인용 이미지)</label>
            <div className="ib-readonly-path" title={outputPath}>
              {workspaceReady ? outputPath : "작업 공간을 선택하세요"}
            </div>
          </div>
        </div>

        {/* Right Panel: Pose Selection + Progress */}
        <div className="ib-right">
          {/* Pose Selection */}
          <div className="ib-card">
            <h3>Pose Selection</h3>

            <div className="ib-pose-controls">
              <label className="ib-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
                <span>Select All</span>
              </label>

              <div className="ib-default-expr">
                <label>Default Expression:</label>
                <select
                  value={defaultExpression}
                  onChange={(e) => applyDefaultExpression(e.target.value)}
                  className="ib-select ib-select-sm"
                  disabled={defaultExpressionOptions.length === 0}
                >
                  {defaultExpressionOptions.map((ex) => (
                    <option key={ex} value={ex}>
                      {ex}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="ib-prompt-patch">
              <label className="ib-check">
                <input
                  type="checkbox"
                  checked={promptPatchEnabled}
                  onChange={(e) => setPromptPatchEnabled(e.target.checked)}
                />
                <span>포즈 프롬프트 가감</span>
              </label>
              {promptPatchEnabled && (
                <div className="ib-prompt-patch-fields">
                  <div className="ib-prompt-patch-field">
                    <label>추가 텍스트</label>
                    <textarea
                      value={promptPatchAdd}
                      onChange={(e) => setPromptPatchAdd(e.target.value)}
                      rows={2}
                      placeholder="예: closed mouth, looking at viewer,"
                    />
                    <div className="ib-prompt-patch-position">
                      <span>추가 위치</span>
                      <label>
                        <input
                          type="radio"
                          name="promptPatchAddPosition"
                          checked={promptPatchAddPosition === "prepend"}
                          onChange={() => setPromptPatchAddPosition("prepend")}
                        />
                        맨 앞
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="promptPatchAddPosition"
                          checked={promptPatchAddPosition === "append"}
                          onChange={() => setPromptPatchAddPosition("append")}
                        />
                        맨 뒤
                      </label>
                    </div>
                  </div>
                  <div className="ib-prompt-patch-field">
                    <label>제거 텍스트</label>
                    <textarea
                      value={promptPatchRemove}
                      onChange={(e) => setPromptPatchRemove(e.target.value)}
                      rows={2}
                      placeholder="예: tongue out, ahegao,"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="ib-pose-list">
              {poseRows.map((row, idx) => (
                <div
                  key={row.name}
                  className={`ib-pose-row ${row.selected ? "" : "dimmed"}`}
                >
                  <label className="ib-check ib-pose-name">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(e) =>
                        updatePoseRow(idx, { selected: e.target.checked })
                      }
                    />
                    <span>{row.name}</span>
                  </label>

                  <select
                    value={row.expression}
                    onChange={(e) =>
                      updatePoseRow(idx, { expression: e.target.value })
                    }
                    className="ib-select ib-select-xs"
                    disabled={!row.selected}
                  >
                    {row.availableExpressions.map((ex) => (
                      <option key={ex} value={ex}>
                        {ex}
                      </option>
                    ))}
                  </select>

                  <label className="ib-check ib-handfix-toggle">
                    <input
                      type="checkbox"
                      checked={row.handFix}
                      onChange={(e) =>
                        updatePoseRow(idx, { handFix: e.target.checked })
                      }
                      disabled={!row.selected}
                    />
                    <span>Hand Fix</span>
                  </label>
                </div>
              ))}
            </div>

            <div className="ib-summary">
              <span>
                {selectedPoses.length} poses x 3 random ={" "}
                <strong>{totalTasks} tasks</strong>
              </span>
              <span className="ib-time">
                ~{estimatedMinutes} min
              </span>
            </div>
          </div>

          {/* Start / Stop / Reset */}
          <div className="ib-actions">
            <button
              className="ib-btn-primary"
              onClick={handleStart}
              disabled={!workspaceReady}
            >
              Start Batch
            </button>
            {isRunning && (
              <button className="ib-btn-danger" onClick={handleStop}>
                현재 작업 중지
              </button>
            )}
            <button
              type="button"
              className="ib-btn-secondary"
              onClick={resetFormForNextJob}
              title="프롬프트·로라만 기본값으로 초기화"
            >
              초기화
            </button>
          </div>

          {error && <div className="ib-error">{error}</div>}

          {/* Queue & Progress */}
          {queueState && (queueState.queue.length > 0 || queueState.currentJobId || queueState.jobs.length > 0) && (
            <div className="ib-card ib-progress-card">
              <h3>작업 큐</h3>
              <div className="ib-queue-summary">
                <span>대기: {queueState.queue.length}건</span>
                {(queueState.currentJobIds?.length ?? (queueState.currentJobId ? 1 : 0)) > 0 && (
                  <span>실행 중: {queueState.currentJobIds?.length ?? 1}건</span>
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
                      {currentJob.completedTasks} / {currentJob.totalTasks} tasks
                    </span>
                    {currentJob.currentPose && (
                      <span>Current: {currentJob.currentPose}</span>
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
    </div>
  );
}
