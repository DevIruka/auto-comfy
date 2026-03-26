import type { ComponentProps, ChangeEvent, Dispatch, SetStateAction } from "react";
import { AutomationModePanel } from "../automation/AutomationModePanel";
import { GeneratorMainPanel } from "./GeneratorMainPanel";
import { SingleModePanel } from "../single/SingleModePanel";

interface BuildGeneratorMainPanelPropsParams {
  automationPanelProps: ComponentProps<typeof AutomationModePanel>;
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
  hasFirstFrameImage: boolean;
  onSingleGenerate: () => void | Promise<void>;
  error: string;
}

export function buildGeneratorMainPanelProps({
  automationPanelProps,
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
  hasFirstFrameImage,
  onSingleGenerate,
  error,
}: BuildGeneratorMainPanelPropsParams): ComponentProps<typeof GeneratorMainPanel> {
  const singlePanelProps: ComponentProps<typeof SingleModePanel> = {
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
  };

  return {
    automationPanelProps,
    singlePanelProps,
    actionButtons: {
      loading,
      hasFirstFrameImage,
      onSingleGenerate,
    },
    error,
  };
}
