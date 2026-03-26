import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { ImageFile } from "../../types/app";
import { BatchImageCard } from "./BatchImageCard";

interface BatchModePanelProps {
  loading: boolean;
  videoBasePath: string;
  setVideoBasePath: Dispatch<SetStateAction<string>>;
  prefixPrompt: string;
  setPrefixPrompt: Dispatch<SetStateAction<string>>;
  suffixPrompt: string;
  setSuffixPrompt: Dispatch<SetStateAction<string>>;
  uploadedImages: ImageFile[];
  expandedImageId: string | null;
  setExpandedImageId: Dispatch<SetStateAction<string | null>>;
  maxConcurrent: number;
  setMaxConcurrent: Dispatch<SetStateAction<number>>;
  handleMultipleImagesUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  handleDuplicateImage: (id: string) => void;
  removeImage: (id: string) => void;
  updateImageSettings: (
    id: string,
    settings: Partial<Omit<ImageFile, "id" | "file" | "preview" | "name">>,
  ) => void;
  handleLastFrameUploadForImage: (
    id: string,
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
}

export function BatchModePanel({
  loading,
  videoBasePath,
  setVideoBasePath,
  prefixPrompt,
  setPrefixPrompt,
  suffixPrompt,
  setSuffixPrompt,
  uploadedImages,
  expandedImageId,
  setExpandedImageId,
  maxConcurrent,
  setMaxConcurrent,
  handleMultipleImagesUpload,
  handleDuplicateImage,
  removeImage,
  updateImageSettings,
  handleLastFrameUploadForImage,
}: BatchModePanelProps) {
  return (
    <div className="batch-mode-section">
      <h2>Parallel Batch Generation</h2>

      <div className="save-path-section">
        <div className="input-group">
          <label htmlFor="videoBasePath">Video Output Base Path</label>
          <input
            type="text"
            id="videoBasePath"
            value={videoBasePath}
            onChange={(e) => setVideoBasePath(e.target.value)}
            placeholder="C:\\Users\\username\\Desktop\\videos"
            className="path-input"
            disabled={loading}
          />
          <p className="helper-text">
            Base path where generated videos are saved with automatic subfolder
            grouping.
          </p>
        </div>
      </div>

      <div className="prefix-suffix-section">
        <div className="input-group">
          <label htmlFor="prefixPrompt">Prefix Prompt (prepended to all prompts)</label>
          <textarea
            id="prefixPrompt"
            value={prefixPrompt}
            onChange={(e) => setPrefixPrompt(e.target.value)}
            placeholder="Example: A beautiful woman..."
            rows={2}
            disabled={loading}
          />
          <p className="helper-text">Applied to the beginning of every prompt.</p>
        </div>

        <div className="input-group">
          <label htmlFor="suffixPrompt">Suffix Prompt (appended to all prompts)</label>
          <textarea
            id="suffixPrompt"
            value={suffixPrompt}
            onChange={(e) => setSuffixPrompt(e.target.value)}
            placeholder="Example: lip must move, mouth must move. she must talk."
            rows={2}
            disabled={loading}
          />
          <p className="helper-text">Applied to the end of every prompt.</p>
        </div>
      </div>

      <div className="input-group">
        <label htmlFor="multipleImages">Upload Multiple Images</label>
        <input
          type="file"
          id="multipleImages"
          accept="image/*"
          multiple
          onChange={handleMultipleImagesUpload}
          className="file-input"
          disabled={loading}
        />
        <p className="helper-text">
          Select multiple images and generate videos in parallel.
        </p>
      </div>

      {uploadedImages.length > 0 && (
        <div className="uploaded-images-list">
          {uploadedImages.map((img) => (
            <BatchImageCard
              key={img.id}
              img={img}
              uploadedImages={uploadedImages}
              expandedImageId={expandedImageId}
              setExpandedImageId={setExpandedImageId}
              loading={loading}
              onRemoveImage={removeImage}
              onDuplicateImage={handleDuplicateImage}
              onUpdateImageSettings={updateImageSettings}
              onLastFrameUploadForImage={handleLastFrameUploadForImage}
            />
          ))}
        </div>
      )}

      <div className="input-group">
        <label htmlFor="maxConcurrent">Max Concurrent Jobs</label>
        <select
          id="maxConcurrent"
          value={maxConcurrent}
          onChange={(e) => setMaxConcurrent(Number(e.target.value))}
          disabled={loading}
        >
          <option value={1}>1 (sequential)</option>
          <option value={2}>2</option>
          <option value={3}>3 (recommended)</option>
          <option value={4}>4</option>
          <option value={5}>5</option>
        </select>
        <p className="helper-text">
          Tune based on server capacity. 3 is usually stable.
        </p>
      </div>
    </div>
  );
}
