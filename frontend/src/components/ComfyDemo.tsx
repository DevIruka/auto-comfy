import { useState, useEffect, useCallback, useMemo } from "react";
import {
  comfyClient,
  type ComfyInstanceInfo,
  groupInstancesByPod,
} from "../api/comfy-client";
import "./ComfyDemo.css";

interface LoraSlot {
  enabled: boolean;
  loraName: string;
  strengthModel: number;
  strengthClip: number;
}


interface GeneratedImage {
  url: string;
  filename: string;
}

interface PositiveBlocks {
  fixedPrefix: string;
  styleTrigger: string;
  character: string;
  outfit: string;
  composition: string;
  backgroundPositive: string;
  fixedSuffix: string;
}

interface NegativeBlocks {
  fixedNegative: string;
  minorFixes: string;
  includeNsfw: boolean;
  nsfwNegative: string;
  backgroundNegative: string;
}

const DEFAULT_LORAS: LoraSlot[] = [
  { enabled: true, loraName: "", strengthModel: 1, strengthClip: 1 },
  { enabled: true, loraName: "", strengthModel: 1, strengthClip: 1 },
  { enabled: false, loraName: "", strengthModel: 1, strengthClip: 1 },
  { enabled: false, loraName: "", strengthModel: 1, strengthClip: 1 },
];

const DEFAULT_POSITIVE_BLOCKS: PositiveBlocks = {
  fixedPrefix:
    "(artist:tianliang duohe fangdongye:0.9), artist:ciloranko, artist:noyu, noyu23386566,ningen mame, (artist:sho:0.8264462809917354), (sho lwlw:0.9090909090909091),(artist:kedama_milk:0.5),(bee_\\(deadflow\\):0.7),artist:dino,(artist:fkey:0.8),(artist:wlop:1),year 2023,",
  styleTrigger: "",
  character: "",
  outfit: "",
  composition: "",
  backgroundPositive: "",
  fixedSuffix:
    "depth of field,dynamic lighting,light particle, best quality, very aesthetic, highres, absurdres",
};

const DEFAULT_NEGATIVE_BLOCKS: NegativeBlocks = {
  fixedNegative:
    "censored,censor,censor bar,negative_hand, NegfeetV2, bad anatomy,blurry,(worst quality:1.8),low quality,hands bad,face bad,(normal quality:1.3),bad hands,[extra fingers],mutated hands and fingers,extra legs,extra arms,duplicate,cropped,text,jpeg,artifacts,signature,watermark,username,blurry,artist name,trademark,title,multiple view,Reference sheet,long body,multiple breasts,mutated,bad anatomy,disfigured,bad proportions,duplicate,bad feet,artist name,ugly,text font ui,missing limb,monochrome",
  minorFixes: "",
  includeNsfw: false,
  nsfwNegative: "",
  backgroundNegative: "",
};

function combineBlocks(parts: string[]): string {
  return parts.filter((p) => p.trim()).join("\n\n");
}

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
    <div className={`prompt-block collapsible ${open ? "open" : ""}`}>
      <div className="prompt-block-header" onClick={() => setOpen(!open)}>
        <span className="collapse-arrow">{open ? "▼" : "▶"}</span>
        <span className="prompt-block-label">{label}</span>
        <span className="prompt-block-tag fixed">고정</span>
      </div>
      {open && <div className="prompt-block-body">{children}</div>}
    </div>
  );
}

export default function ComfyDemo() {
  const [instances, setInstances] = useState<ComfyInstanceInfo[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [loraList, setLoraList] = useState<string[]>([]);
  const [loraSlots, setLoraSlots] = useState<LoraSlot[]>(DEFAULT_LORAS);

  const [posBlocks, setPosBlocks] = useState<PositiveBlocks>(
    DEFAULT_POSITIVE_BLOCKS,
  );
  const [negBlocks, setNegBlocks] = useState<NegativeBlocks>(
    DEFAULT_NEGATIVE_BLOCKS,
  );
  const [showPosPreview, setShowPosPreview] = useState(false);
  const [showNegPreview, setShowNegPreview] = useState(false);

  const [seed, setSeed] = useState(327435532408452);
  const [batchSize, setBatchSize] = useState(4);
  const [outputPath, setOutputPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLoras, setLoadingLoras] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [savedPaths, setSavedPaths] = useState<string[]>([]);

  const positivePrompt = useMemo(
    () =>
      combineBlocks([
        posBlocks.fixedPrefix,
        posBlocks.styleTrigger,
        posBlocks.character,
        posBlocks.outfit,
        posBlocks.composition,
        posBlocks.backgroundPositive,
        posBlocks.fixedSuffix,
      ]),
    [posBlocks],
  );

  const negativePrompt = useMemo(
    () =>
      combineBlocks([
        negBlocks.fixedNegative,
        negBlocks.minorFixes,
        ...(negBlocks.includeNsfw ? [negBlocks.nsfwNegative] : []),
        negBlocks.backgroundNegative,
      ]),
    [negBlocks],
  );

  useEffect(() => {
    comfyClient
      .getComfyInstances()
      .then((list) => {
        setInstances(list);
        if (list.length > 0) setSelectedInstance(list[0].id);
      })
      .catch((err) => console.error("Failed to load instances:", err));
  }, []);

  const fetchLoras = useCallback(async () => {
    if (!selectedInstance) return;
    setLoadingLoras(true);
    try {
      const loras = await comfyClient.getLoraList(selectedInstance);
      setLoraList(loras);
    } catch (err) {
      console.error("Failed to fetch LoRA list:", err);
      setError("LoRA 목록을 불러오지 못했습니다.");
    } finally {
      setLoadingLoras(false);
    }
  }, [selectedInstance]);

  useEffect(() => {
    if (selectedInstance) fetchLoras();
  }, [selectedInstance, fetchLoras]);

  const updateLoraSlot = (index: number, updates: Partial<LoraSlot>) => {
    setLoraSlots((prev) =>
      prev.map((slot, i) => (i === index ? { ...slot, ...updates } : slot)),
    );
  };

  const updatePos = (key: keyof PositiveBlocks, value: string) => {
    setPosBlocks((prev) => ({ ...prev, [key]: value }));
  };

  const updateNeg = (key: keyof NegativeBlocks, value: string | boolean) => {
    setNegBlocks((prev) => ({ ...prev, [key]: value }));
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await comfyClient.generateImage({
        instanceId: selectedInstance || undefined,
        loras: loraSlots,
        positivePrompt,
        negativePrompt,
        seed,
        batchSize,
        outputPath: outputPath || undefined,
      });

      const newImages = result.images.map((img) => ({
        url: comfyClient.getImageGenUrl(
          img.filename,
          img.subfolder,
          img.type,
          selectedInstance || undefined,
        ),
        filename: img.filename,
      }));

      setImages((prev) => [...newImages, ...prev]);
      if (result.savedPaths && result.savedPaths.length > 0) {
        setSavedPaths(result.savedPaths);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "이미지 생성에 실패했습니다.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRandomSeed = () => {
    setSeed(Math.floor(Math.random() * 1e15));
  };

  return (
    <div className="comfy-demo">
      <header className="demo-header">
        <h1>🖼️ Image Generation</h1>
        <p>LoRA + 프롬프트 블록 시스템</p>
      </header>

      <div className="demo-container">
        <div className="controls">
          {/* ComfyUI Instance */}
          <div className="form-group">
            <label>ComfyUI Instance</label>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="form-select"
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
          <div className="lora-section">
            <div className="lora-section-header">
              <h3>LoRA Configuration</h3>
              <button
                className="btn-small"
                onClick={fetchLoras}
                disabled={loadingLoras}
              >
                {loadingLoras ? "⏳" : "🔄"} Refresh
              </button>
            </div>

            {loraSlots.map((slot, i) => (
              <div
                key={i}
                className={`lora-slot ${!slot.enabled ? "disabled" : ""}`}
              >
                <div className="lora-slot-header">
                  <label className="lora-checkbox">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={(e) =>
                        updateLoraSlot(i, { enabled: e.target.checked })
                      }
                    />
                    <span>LoRA {i + 1}</span>
                  </label>
                </div>

                {slot.enabled && (
                  <div className="lora-slot-body">
                    <select
                      value={slot.loraName}
                      onChange={(e) =>
                        updateLoraSlot(i, { loraName: e.target.value })
                      }
                      className="form-select lora-select"
                    >
                      <option value="">-- Select LoRA --</option>
                      {loraList.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>

                    <div className="lora-strengths">
                      <div className="strength-input">
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
                      <div className="strength-input">
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
            ))}
          </div>

          <div className="section-divider" />

          {/* Positive Prompt Blocks */}
          <div className="prompt-blocks-section">
            <h3 className="prompt-section-title">Positive Prompt</h3>

            <CollapsibleBlock label="Fixed Prefix (아티스트)">
              <textarea
                value={posBlocks.fixedPrefix}
                onChange={(e) => updatePos("fixedPrefix", e.target.value)}
                rows={3}
              />
            </CollapsibleBlock>

            <div className="prompt-block">
              <div className="prompt-block-header">
                <span className="prompt-block-label">Style LoRA Trigger</span>
              </div>
              <div className="prompt-block-body">
                <textarea
                  value={posBlocks.styleTrigger}
                  onChange={(e) => updatePos("styleTrigger", e.target.value)}
                  rows={1}
                  placeholder="예: ahemaru, ahemaru style,"
                />
              </div>
            </div>

            <div className="prompt-block">
              <div className="prompt-block-header">
                <span className="prompt-block-label">Character</span>
              </div>
              <div className="prompt-block-body">
                <textarea
                  value={posBlocks.character}
                  onChange={(e) => updatePos("character", e.target.value)}
                  rows={2}
                  placeholder="캐릭터 외형 (머리색, 눈, 체형 등)"
                />
              </div>
            </div>

            <div className="prompt-block">
              <div className="prompt-block-header">
                <span className="prompt-block-label">Outfit</span>
              </div>
              <div className="prompt-block-body">
                <textarea
                  value={posBlocks.outfit}
                  onChange={(e) => updatePos("outfit", e.target.value)}
                  rows={2}
                  placeholder="의상 묘사 (옷, 액세서리 등)"
                />
              </div>
            </div>

            <div className="prompt-block">
              <div className="prompt-block-header">
                <span className="prompt-block-label">Composition</span>
              </div>
              <div className="prompt-block-body">
                <textarea
                  value={posBlocks.composition}
                  onChange={(e) => updatePos("composition", e.target.value)}
                  rows={1}
                  placeholder="구도, 포즈, 시선 (예: cowboy shot, looking at viewer)"
                />
              </div>
            </div>

            <div className="prompt-block">
              <div className="prompt-block-header">
                <span className="prompt-block-label">Background</span>
              </div>
              <div className="prompt-block-body">
                <textarea
                  value={posBlocks.backgroundPositive}
                  onChange={(e) =>
                    updatePos("backgroundPositive", e.target.value)
                  }
                  rows={2}
                  placeholder="배경/장소 묘사"
                />
              </div>
            </div>

            <CollapsibleBlock label="Fixed Suffix (품질)">
              <textarea
                value={posBlocks.fixedSuffix}
                onChange={(e) => updatePos("fixedSuffix", e.target.value)}
                rows={2}
              />
            </CollapsibleBlock>

            <button
              className="btn-preview"
              onClick={() => setShowPosPreview(!showPosPreview)}
            >
              {showPosPreview ? "▼ 미리보기 닫기" : "▶ 최종 프롬프트 미리보기"}
            </button>
            {showPosPreview && (
              <div className="prompt-preview">{positivePrompt}</div>
            )}
          </div>

          <div className="section-divider" />

          {/* Negative Prompt Blocks */}
          <div className="prompt-blocks-section">
            <h3 className="prompt-section-title">Negative Prompt</h3>

            <CollapsibleBlock label="Fixed Negative (표준)">
              <textarea
                value={negBlocks.fixedNegative}
                onChange={(e) => updateNeg("fixedNegative", e.target.value)}
                rows={3}
              />
            </CollapsibleBlock>

            <div className="prompt-block">
              <div className="prompt-block-header">
                <span className="prompt-block-label">Minor Fixes</span>
              </div>
              <div className="prompt-block-body">
                <textarea
                  value={negBlocks.minorFixes}
                  onChange={(e) => updateNeg("minorFixes", e.target.value)}
                  rows={1}
                  placeholder="사소한 보정 (선택사항)"
                />
              </div>
            </div>

            <div className="prompt-block">
              <div className="prompt-block-header">
                <label className="lora-checkbox">
                  <input
                    type="checkbox"
                    checked={negBlocks.includeNsfw}
                    onChange={(e) => updateNeg("includeNsfw", e.target.checked)}
                  />
                  <span className="prompt-block-label">NSFW Negative</span>
                </label>
              </div>
              {negBlocks.includeNsfw && (
                <div className="prompt-block-body">
                  <textarea
                    value={negBlocks.nsfwNegative}
                    onChange={(e) => updateNeg("nsfwNegative", e.target.value)}
                    rows={1}
                    placeholder="NSFW 전용 네거티브"
                  />
                </div>
              )}
            </div>

            <div className="prompt-block">
              <div className="prompt-block-header">
                <span className="prompt-block-label">Background Negative</span>
              </div>
              <div className="prompt-block-body">
                <textarea
                  value={negBlocks.backgroundNegative}
                  onChange={(e) =>
                    updateNeg("backgroundNegative", e.target.value)
                  }
                  rows={2}
                  placeholder="배경 제외 키워드 (예: outdoor, bedroom, kitchen)"
                />
              </div>
            </div>

            <button
              className="btn-preview"
              onClick={() => setShowNegPreview(!showNegPreview)}
            >
              {showNegPreview ? "▼ 미리보기 닫기" : "▶ 최종 프롬프트 미리보기"}
            </button>
            {showNegPreview && (
              <div className="prompt-preview">{negativePrompt}</div>
            )}
          </div>

          <div className="section-divider" />

          {/* Output Path */}
          <div className="form-group">
            <label htmlFor="output-path">저장 경로 (비우면 저장 안 함)</label>
            <input
              id="output-path"
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              placeholder="예: C:\output\images"
              className="form-text-input"
            />
          </div>

          {/* Seed & Batch */}
          <div className="form-row">
            <div className="form-group flex-1">
              <label htmlFor="seed-input">Seed</label>
              <div className="seed-row">
                <input
                  id="seed-input"
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
                <button className="btn-small" onClick={handleRandomSeed}>
                  🎲
                </button>
              </div>
            </div>
            <div className="form-group" style={{ width: "100px" }}>
              <label htmlFor="batch-input">Batch</label>
              <input
                id="batch-input"
                type="number"
                min={1}
                max={16}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Generate Button */}
          <div className="button-group">
            <button
              onClick={handleGenerate}
              disabled={loading || !positivePrompt}
              className="btn-primary"
            >
              {loading ? "⏳ 생성 중..." : "🖼️ 이미지 생성"}
            </button>
          </div>

          {error && <div className="error-message">❌ {error}</div>}

          {savedPaths.length > 0 && (
            <div className="save-success">
              💾 {savedPaths.length}개 이미지 저장 완료
              <small>
                {savedPaths[0].substring(
                  0,
                  savedPaths[0].lastIndexOf("\\") + 1,
                ) ||
                  savedPaths[0].substring(
                    0,
                    savedPaths[0].lastIndexOf("/") + 1,
                  )}
              </small>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="results">
          <h2>생성된 이미지 ({images.length})</h2>

          {loading && (
            <div className="loading">
              <div className="spinner" />
              <p>이미지를 생성하고 있습니다... (시간이 걸릴 수 있습니다)</p>
            </div>
          )}

          {images.length === 0 && !loading && (
            <div className="empty-state">
              <p>아직 생성된 이미지가 없습니다.</p>
              <p>LoRA와 프롬프트를 설정하고 생성해보세요!</p>
            </div>
          )}

          <div className="image-grid">
            {images.map((image, index) => (
              <div key={index} className="image-card">
                <img src={image.url} alt={`Generated ${index}`} />
                <div className="image-info">
                  <small>{image.filename}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
