import type { ImageFile } from "../../types/app";
import type { BatchSettingsPatch } from "./types";

interface BatchEmotionSettingsProps {
  img: ImageFile;
  loading: boolean;
  onUpdateImageSettings: (id: string, settings: BatchSettingsPatch) => void;
}

export function BatchEmotionSettings({
  img,
  loading,
  onUpdateImageSettings,
}: BatchEmotionSettingsProps) {
  if (img.action !== "SpeakNatural") return null;

  return (
    <div className="emotion-settings">
      <h5 className="emotion-title">Emotion Settings</h5>
      <div className="settings-grid-small">
        <div className="input-group-small">
          <label>Start Emotion</label>
          <select
            value={img.startEmotion || "Neutral"}
            onChange={(e) =>
              onUpdateImageSettings(img.id, {
                startEmotion: e.target.value,
              })
            }
            disabled={loading}
          >
            <option value="Happy">Happy</option>
            <option value="Neutral">Neutral</option>
            <option value="Aroused">Aroused</option>
            <option value="Sad">Sad</option>
            <option value="Angry">Angry</option>
          </select>
          {img.startEmotion && img.startEmotion !== "Neutral" && (
            <p className="auto-set-note">Auto-set from filename.</p>
          )}
        </div>

        <div className="input-group-small">
          <label>End Emotion</label>
          <select
            value={img.endEmotion || "Idle"}
            onChange={(e) => {
              const selectedValue = e.target.value;
              const finalValue = selectedValue === "Neutral" ? "Idle" : selectedValue;
              onUpdateImageSettings(img.id, {
                endEmotion: finalValue,
              });
            }}
            disabled={loading}
          >
            <option value="Happy">Happy</option>
            <option value="Neutral">Neutral (maps to Idle)</option>
            <option value="Aroused">Aroused</option>
            <option value="Sad">Sad</option>
            <option value="Angry">Angry</option>
            <option value="Idle">Idle</option>
          </select>
          {img.lastFrameImage && <p className="auto-set-note">Auto-set from last frame.</p>}
        </div>
      </div>
    </div>
  );
}
