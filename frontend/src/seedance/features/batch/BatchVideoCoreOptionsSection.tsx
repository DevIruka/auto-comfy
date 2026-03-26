import type { ImageFile } from "../../types/app";
import type { BatchSettingsPatch } from "./types";

interface BatchVideoCoreOptionsSectionProps {
  img: ImageFile;
  loading: boolean;
  onUpdateImageSettings: (id: string, settings: BatchSettingsPatch) => void;
}

export function BatchVideoCoreOptionsSection({
  img,
  loading,
  onUpdateImageSettings,
}: BatchVideoCoreOptionsSectionProps) {
  return (
    <div className="settings-grid-small">
      <div className="input-group-small">
        <label>Duration (seconds)</label>
        <select
          value={img.duration}
          onChange={(e) =>
            onUpdateImageSettings(img.id, {
              duration: Number(e.target.value),
            })
          }
          disabled={loading}
        >
          {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((d) => (
            <option key={d} value={d}>
              {d}s
            </option>
          ))}
        </select>
      </div>

      <div className="input-group-small">
        <label>Resolution</label>
        <select
          value={img.resolution}
          onChange={(e) =>
            onUpdateImageSettings(img.id, {
              resolution: e.target.value,
            })
          }
          disabled={loading}
        >
          <option value="480p">480p</option>
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
        </select>
      </div>

      <div className="input-group-small">
        <label>Aspect Ratio</label>
        <select
          value={img.aspectRatio}
          onChange={(e) =>
            onUpdateImageSettings(img.id, {
              aspectRatio: e.target.value,
            })
          }
          disabled={loading}
        >
          <option value="3:4">3:4</option>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
          <option value="4:3">4:3</option>
        </select>
      </div>
    </div>
  );
}
