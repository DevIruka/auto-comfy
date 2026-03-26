import type { Dispatch, SetStateAction } from "react";

interface SingleCommonSettingsSectionProps {
  prompt: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  batchCount: number;
  watermark: boolean;
  cameraFixed: boolean;
  setPrompt: Dispatch<SetStateAction<string>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setResolution: Dispatch<SetStateAction<string>>;
  setAspectRatio: Dispatch<SetStateAction<string>>;
  setBatchCount: Dispatch<SetStateAction<number>>;
  setWatermark: Dispatch<SetStateAction<boolean>>;
  setCameraFixed: Dispatch<SetStateAction<boolean>>;
}

export function SingleCommonSettingsSection({
  prompt,
  duration,
  resolution,
  aspectRatio,
  batchCount,
  watermark,
  cameraFixed,
  setPrompt,
  setDuration,
  setResolution,
  setAspectRatio,
  setBatchCount,
  setWatermark,
  setCameraFixed,
}: SingleCommonSettingsSectionProps) {
  return (
    <div className="common-settings">
      <div className="input-group">
        <label htmlFor="prompt">Prompt (Optional)</label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe motion or style for the video..."
          rows={3}
        />
      </div>

      <div className="settings-grid">
        <div className="input-group">
          <label htmlFor="duration">Duration (seconds)</label>
          <select
            id="duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            <option value={3}>3s</option>
            <option value={4}>4s</option>
            <option value={5}>5s</option>
            <option value={6}>6s</option>
            <option value={7}>7s</option>
            <option value={8}>8s</option>
            <option value={9}>9s</option>
            <option value={10}>10s</option>
            <option value={11}>11s</option>
            <option value={12}>12s</option>
            <option value={13}>13s</option>
            <option value={14}>14s</option>
            <option value={15}>15s</option>
          </select>
        </div>

        <div className="input-group">
          <label htmlFor="resolution">Resolution</label>
          <select
            id="resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </div>

        <div className="input-group">
          <label htmlFor="aspectRatio">Aspect Ratio</label>
          <select
            id="aspectRatio"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
          >
            <option value="3:4">3:4 (Portrait)</option>
            <option value="16:9">16:9 (Landscape)</option>
            <option value="9:16">9:16 (Portrait)</option>
            <option value="1:1">1:1 (Square)</option>
            <option value="4:3">4:3 (Standard)</option>
          </select>
        </div>

        <div className="input-group">
          <label htmlFor="batchCount">Generation Count</label>
          <select
            id="batchCount"
            value={batchCount}
            onChange={(e) => setBatchCount(Number(e.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
          </select>
        </div>
      </div>

      <div className="checkbox-group">
        <div className="checkbox-item">
          <input
            type="checkbox"
            id="watermark"
            checked={watermark}
            onChange={(e) => setWatermark(e.target.checked)}
          />
          <label htmlFor="watermark">Include Watermark</label>
        </div>

        <div className="checkbox-item">
          <input
            type="checkbox"
            id="cameraFixed"
            checked={cameraFixed}
            onChange={(e) => setCameraFixed(e.target.checked)}
          />
          <label htmlFor="cameraFixed">Fixed Camera</label>
        </div>
      </div>
    </div>
  );
}
