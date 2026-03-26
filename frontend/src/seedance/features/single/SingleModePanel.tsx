import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { SingleCommonSettingsSection } from "./SingleCommonSettingsSection";
import { SingleFrameInputsSection } from "./SingleFrameInputsSection";

interface SingleModePanelProps {
  loading: boolean;
  firstFrameImage: string;
  lastFrameImage: string;
  prompt: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  batchCount: number;
  watermark: boolean;
  cameraFixed: boolean;
  onFirstFrameUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onLastFrameUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  setPrompt: Dispatch<SetStateAction<string>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setResolution: Dispatch<SetStateAction<string>>;
  setAspectRatio: Dispatch<SetStateAction<string>>;
  setBatchCount: Dispatch<SetStateAction<number>>;
  setWatermark: Dispatch<SetStateAction<boolean>>;
  setCameraFixed: Dispatch<SetStateAction<boolean>>;
}

export function SingleModePanel({
  loading,
  firstFrameImage,
  lastFrameImage,
  prompt,
  duration,
  resolution,
  aspectRatio,
  batchCount,
  watermark,
  cameraFixed,
  onFirstFrameUpload,
  onLastFrameUpload,
  setPrompt,
  setDuration,
  setResolution,
  setAspectRatio,
  setBatchCount,
  setWatermark,
  setCameraFixed,
}: SingleModePanelProps) {
  return (
    <>
      <SingleFrameInputsSection
        loading={loading}
        firstFrameImage={firstFrameImage}
        lastFrameImage={lastFrameImage}
        onFirstFrameUpload={onFirstFrameUpload}
        onLastFrameUpload={onLastFrameUpload}
      />
      <SingleCommonSettingsSection
        prompt={prompt}
        duration={duration}
        resolution={resolution}
        aspectRatio={aspectRatio}
        batchCount={batchCount}
        watermark={watermark}
        cameraFixed={cameraFixed}
        setPrompt={setPrompt}
        setDuration={setDuration}
        setResolution={setResolution}
        setAspectRatio={setAspectRatio}
        setBatchCount={setBatchCount}
        setWatermark={setWatermark}
        setCameraFixed={setCameraFixed}
      />
    </>
  );
}
