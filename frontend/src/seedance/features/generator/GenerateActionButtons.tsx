import type { AppMode } from "../../types/app";

interface GenerateActionButtonsProps {
  mode: AppMode;
  loading: boolean;
  hasFirstFrameImage: boolean;
  onSingleGenerate: () => void;
  /** Top workspace (캐릭터·스팟) 미선택 */
  workspaceBlocked?: boolean;
}

export function GenerateActionButtons({
  mode,
  loading,
  hasFirstFrameImage,
  onSingleGenerate,
  workspaceBlocked = false,
}: GenerateActionButtonsProps) {
  const blocked = loading || workspaceBlocked;
  return (
    <div className="action-buttons">
      {workspaceBlocked && (
        <p className="info-message">
          상단에서 작업 공간(캐릭터·스팟)을 선택하면 입력은 감정별 이미지/Emotions, 저장은 일반 영상
          폴더로 맞춰집니다.
        </p>
      )}

      {mode === "single" && hasFirstFrameImage && (
        <button className="generate-btn single-btn" onClick={onSingleGenerate} disabled={blocked}>
          {loading ? "Generating video..." : "Start Single Generate"}
        </button>
      )}

      {mode === "automation" && (
        <p className="helper-text">Set options, then click Run Automation.</p>
      )}

      {mode === "single" && !hasFirstFrameImage && (
        <p className="info-message">Upload the first frame image in the left panel.</p>
      )}
    </div>
  );
}
