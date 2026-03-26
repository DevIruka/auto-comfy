import type { ImageFile } from "../../types/app";
import type { BatchSettingsPatch } from "./types";
import { BatchEmotionSettings } from "./BatchEmotionSettings";

interface BatchOutputMetadataSectionProps {
  img: ImageFile;
  loading: boolean;
  onUpdateImageSettings: (id: string, settings: BatchSettingsPatch) => void;
}

export function BatchOutputMetadataSection({
  img,
  loading,
  onUpdateImageSettings,
}: BatchOutputMetadataSectionProps) {
  return (
    <div className="save-settings-section">
      <h4 className="section-title">Output Metadata</h4>
      <div className="settings-grid-small">
        <div className="input-group-small">
          <label>Pose</label>
          <select
            value={img.pose || "Stand"}
            onChange={(e) =>
              onUpdateImageSettings(img.id, {
                pose: e.target.value,
              })
            }
            disabled={loading}
          >
            <option value="Stand">Stand</option>
            <option value="Sit">Sit</option>
          </select>
        </div>

        <div className="input-group-small">
          <label>Outfit</label>
          <select
            value={img.clothing || "Clothed"}
            onChange={(e) =>
              onUpdateImageSettings(img.id, {
                clothing: e.target.value,
              })
            }
            disabled={loading}
          >
            <option value="Clothed">Clothed</option>
            <option value="Naked">Naked</option>
          </select>
        </div>

        <div className="input-group-small">
          <label>Action</label>
          <select
            value={img.action || "Idle"}
            onChange={(e) =>
              onUpdateImageSettings(img.id, {
                action: e.target.value,
              })
            }
            disabled={loading || Boolean(img.startEmotion && img.startEmotion !== "Neutral")}
          >
            <option value="Idle">Idle</option>
            <option value="SpeakNatural">SpeakNatural</option>
          </select>
          {img.startEmotion && img.startEmotion !== "Neutral" && (
            <p className="auto-set-note">Auto-fixed to SpeakNatural from start emotion.</p>
          )}
        </div>
      </div>

      <BatchEmotionSettings
        img={img}
        loading={loading}
        onUpdateImageSettings={onUpdateImageSettings}
      />
    </div>
  );
}
