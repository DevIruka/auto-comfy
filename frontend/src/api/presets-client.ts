const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3002";

export interface LoraSlotPreset {
  enabled: boolean;
  loraName: string;
  strengthModel: number;
  strengthClip: number;
}

export interface CharacterPreset {
  name: string;
  createdAt?: string;
  updatedAt?: string;
  fixedPrefix?: string;
  styleTrigger?: string;
  character?: string;
  outfit?: string;
  backgroundPositive?: string;
  fixedSuffix?: string;
  fixedNegative?: string;
  backgroundNegative?: string;
  loraSlots?: LoraSlotPreset[];
  prefixPrompt?: string;
  pose?: string;
  negativeExtra?: string;
  /** 앵커 이미지 탭: Composition / Pose 자유 입력 */
  compositionPose?: string;
  /** 앵커 이미지: portrait = 1024×1536, landscape = 1536×1024 (배너 lying down 규칙과 동일) */
  anchorAspect?: "portrait" | "landscape";
}

export interface PresetSummary {
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

class PresetsClient {
  async listPresets(): Promise<PresetSummary[]> {
    const res = await fetch(`${API_BASE}/api/presets`);
    const data = await res.json();
    if (!data.success) throw new Error("Failed to list presets");
    return data.presets;
  }

  async getPreset(name: string): Promise<CharacterPreset> {
    const res = await fetch(`${API_BASE}/api/presets/${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Preset not found");
    return data.preset;
  }

  async savePreset(preset: CharacterPreset): Promise<CharacterPreset> {
    const res = await fetch(`${API_BASE}/api/presets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preset),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to save preset");
    return data.preset;
  }

  async updatePreset(name: string, preset: CharacterPreset): Promise<CharacterPreset> {
    const res = await fetch(`${API_BASE}/api/presets/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preset),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to update preset");
    return data.preset;
  }

  async deletePreset(name: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/presets/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to delete preset");
  }
}

export const presetsClient = new PresetsClient();
