import type { ChangeEvent } from "react";
import type { ImageFile } from "../../types/app";
import type { BatchSettingsPatch } from "./types";

interface BatchLastFramePromptSectionProps {
  img: ImageFile;
  loading: boolean;
  onUpdateImageSettings: (id: string, settings: BatchSettingsPatch) => void;
  onLastFrameUploadForImage: (
    id: string,
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
}

export function BatchLastFramePromptSection({
  img,
  loading,
  onUpdateImageSettings,
  onLastFrameUploadForImage,
}: BatchLastFramePromptSectionProps) {
  return (
    <div className="settings-row">
      <div className="input-group-small">
        <label>Last Frame (Optional)</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => onLastFrameUploadForImage(img.id, e)}
          className="file-input-small"
          disabled={loading}
        />
        {img.lastFrameImage && (
          <div className="preview-tiny">
            <img src={img.lastFrameImage} alt="Last frame" />
            <p className="file-name-text">{img.lastFrameFileName}</p>
          </div>
        )}
      </div>

      <div className="input-group-small">
        <label>Prompt</label>
        <textarea
          value={img.prompt || ""}
          onChange={(e) =>
            onUpdateImageSettings(img.id, {
              prompt: e.target.value,
            })
          }
          placeholder="Prompt for this image only..."
          rows={2}
          disabled={loading}
        />
      </div>
    </div>
  );
}
