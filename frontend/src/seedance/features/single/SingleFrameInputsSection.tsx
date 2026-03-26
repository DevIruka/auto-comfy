import type { ChangeEvent } from "react";

interface SingleFrameInputsSectionProps {
  loading: boolean;
  firstFrameImage: string;
  lastFrameImage: string;
  onFirstFrameUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onLastFrameUpload: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function SingleFrameInputsSection({
  loading,
  firstFrameImage,
  lastFrameImage,
  onFirstFrameUpload,
  onLastFrameUpload,
}: SingleFrameInputsSectionProps) {
  return (
    <div className="single-mode-section">
      <div className="images-upload-section">
        <div className="input-group">
          <label htmlFor="firstFrame">First Frame Image (Required)</label>
          <input
            type="file"
            id="firstFrame"
            accept="image/*"
            onChange={onFirstFrameUpload}
            className="file-input"
            disabled={loading}
          />
          {firstFrameImage && (
            <div className="image-preview">
              <img src={firstFrameImage} alt="First Frame" className="preview-image" />
            </div>
          )}
        </div>

        <div className="input-group">
          <label htmlFor="lastFrame">Last Frame Image (Optional)</label>
          <input
            type="file"
            id="lastFrame"
            accept="image/*"
            onChange={onLastFrameUpload}
            className="file-input"
            disabled={loading}
          />
          {lastFrameImage && (
            <div className="image-preview">
              <img src={lastFrameImage} alt="Last Frame" className="preview-image" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
