import { useState, useEffect, useCallback, useRef } from "react";
import {
  presetsClient,
  type CharacterPreset,
  type PresetSummary,
} from "../api/presets-client";
import { resolveWorkspacePresetName } from "../utils/resolve-workspace-preset";

interface PresetPickerProps {
  /** Called when user loads a preset */
  onLoad: (preset: CharacterPreset) => void;
  /** Returns the current settings to be saved as a preset */
  getCurrentSettings: () => Omit<CharacterPreset, "name" | "createdAt" | "updatedAt">;
  /** If set, prefer this preset selection when it exists (e.g. `${character} ${spot}`) */
  preferredPresetName?: string;
  /** If true, automatically loads preferred preset when it changes (silently ignores missing). */
  autoLoadOnPreferredChange?: boolean;
}

export default function PresetPicker({
  onLoad,
  getCurrentSettings,
  preferredPresetName,
  autoLoadOnPreferredChange = false,
}: PresetPickerProps) {
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [presetsReady, setPresetsReady] = useState(false);
  const [selected, setSelected] = useState("");
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Preset name last successfully loaded via "불러오기" — used for overwrite save */
  const [lastLoadedPresetName, setLastLoadedPresetName] = useState<string | null>(null);
  const lastAutoLoadedPreferred = useRef<string | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  const refresh = useCallback(async () => {
    try {
      const list = await presetsClient.listPresets();
      setPresets(list);
    } catch {
      /* ignore */
    } finally {
      setPresetsReady(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const p = (preferredPresetName || "").trim();
    if (!p) {
      lastAutoLoadedPreferred.current = null;
      return;
    }
    if (!autoLoadOnPreferredChange) return;
    if (!presetsReady) return;
    if (lastAutoLoadedPreferred.current === p) return;
    lastAutoLoadedPreferred.current = p;

    const names = presets.map((x) => x.name);
    const resolved = resolveWorkspacePresetName(p, names);
    if (!resolved) return;

    let cancelled = false;
    (async () => {
      try {
        const preset = await presetsClient.getPreset(resolved);
        if (cancelled) return;
        onLoadRef.current(preset);
        setSelected(resolved);
        setLastLoadedPresetName(resolved);
      } catch {
        /* Ignore missing preset or network errors for auto-load. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preferredPresetName, autoLoadOnPreferredChange, presets, presetsReady]);

  const handleLoad = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const preset = await presetsClient.getPreset(selected);
      onLoad(preset);
      setLastLoadedPresetName(selected);
      setMessage(`"${selected}" 불러옴`);
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setBusy(false);
    }
  };

  const upsertPreset = async (name: string) => {
    const settings = getCurrentSettings();
    const existing = presets.find((p) => p.name === name);
    if (existing) {
      await presetsClient.updatePreset(name, { ...settings, name });
    } else {
      await presetsClient.savePreset({ ...settings, name });
    }
  };

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) return;
    setBusy(true);
    setMessage(null);
    try {
      await upsertPreset(name);
      setMessage(`"${name}" 저장 완료`);
      setSelected(name);
      setLastLoadedPresetName(name);
      setSaveName("");
      setShowSave(false);
      await refresh();
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAsWorkspace = async () => {
    const name = (preferredPresetName || "").trim();
    if (!name) return;
    setBusy(true);
    setMessage(null);
    try {
      await upsertPreset(name);
      setMessage(`"${name}" 저장 완료`);
      setSelected(name);
      setLastLoadedPresetName(name);
      await refresh();
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleOverwriteLoaded = async () => {
    if (!lastLoadedPresetName) return;
    setBusy(true);
    setMessage(null);
    try {
      const settings = getCurrentSettings();
      await presetsClient.updatePreset(lastLoadedPresetName, {
        ...settings,
        name: lastLoadedPresetName,
      });
      setMessage(`"${lastLoadedPresetName}" 업데이트됨`);
      await refresh();
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "업데이트 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`프리셋 "${selected}"을(를) 삭제하시겠습니까?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await presetsClient.deletePreset(selected);
      if (selected === lastLoadedPresetName) setLastLoadedPresetName(null);
      setSelected("");
      await refresh();
      setMessage("삭제 완료");
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="preset-picker">
      <div className="preset-picker-row">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="preset-picker-select"
          disabled={busy}
        >
          <option value="">-- 프리셋 선택 --</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button onClick={handleLoad} disabled={busy || !selected} className="preset-btn preset-btn-load">
          불러오기
        </button>
        <button onClick={handleDelete} disabled={busy || !selected} className="preset-btn preset-btn-delete">
          삭제
        </button>
        <button
          onClick={handleOverwriteLoaded}
          disabled={busy || !lastLoadedPresetName}
          className="preset-btn preset-btn-overwrite"
          title={lastLoadedPresetName ? `"${lastLoadedPresetName}"에 덮어씁니다` : "먼저 프리셋을 불러오세요"}
        >
          불러온 프리셋에 저장
        </button>
        <button
          onClick={handleSaveAsWorkspace}
          disabled={busy || !(preferredPresetName || "").trim()}
          className="preset-btn preset-btn-workspace"
          title={
            (preferredPresetName || "").trim()
              ? `"${(preferredPresetName || "").trim()}"(으)로 저장합니다`
              : "상단에서 작업 공간(캐릭터·스팟)을 선택하세요"
          }
        >
          현재 작업 공간의 이름으로 저장
        </button>
        <button onClick={() => setShowSave(!showSave)} className="preset-btn preset-btn-save-toggle" disabled={busy}>
          {showSave ? "취소" : "새 이름으로 저장"}
        </button>
      </div>
      {showSave && (
        <div className="preset-picker-save-row">
          <input
            type="text"
            placeholder="새 프리셋 이름 (예: 캐릭터A_스팟1)"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            disabled={busy}
            className="preset-save-input"
          />
          <button onClick={handleSave} disabled={busy || !saveName.trim()} className="preset-btn preset-btn-confirm">
            저장
          </button>
        </div>
      )}
      {message && <div className="preset-message">{message}</div>}
    </div>
  );
}
