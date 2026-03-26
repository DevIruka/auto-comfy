import type { ImageFile } from "../../types/app";
import type { BatchSettingsPatch } from "./types";

interface BatchVideoToggleOptionsProps {
  img: ImageFile;
  loading: boolean;
  onUpdateImageSettings: (id: string, settings: BatchSettingsPatch) => void;
}

export function BatchVideoToggleOptions({
  img,
  loading,
  onUpdateImageSettings,
}: BatchVideoToggleOptionsProps) {
  return (
    <div className="checkbox-group-small">
      <label>
        <input
          type="checkbox"
          checked={img.watermark || false}
          onChange={(e) =>
            onUpdateImageSettings(img.id, {
              watermark: e.target.checked,
            })
          }
          disabled={loading}
        />
        Watermark
      </label>
      <label>
        <input
          type="checkbox"
          checked={img.cameraFixed !== undefined ? img.cameraFixed : true}
          onChange={(e) =>
            onUpdateImageSettings(img.id, {
              cameraFixed: e.target.checked,
            })
          }
          disabled={loading}
        />
        Fixed Camera
      </label>
    </div>
  );
}
