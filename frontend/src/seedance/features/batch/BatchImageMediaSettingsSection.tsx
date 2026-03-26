import type { ChangeEvent } from "react";
import type { ImageFile } from "../../types/app";
import { BatchLastFramePromptSection } from "./BatchLastFramePromptSection";
import { BatchVideoCoreOptionsSection } from "./BatchVideoCoreOptionsSection";
import { BatchVideoToggleOptions } from "./BatchVideoToggleOptions";
import type { BatchSettingsPatch } from "./types";

interface BatchImageMediaSettingsSectionProps {
  img: ImageFile;
  loading: boolean;
  onUpdateImageSettings: (id: string, settings: BatchSettingsPatch) => void;
  onLastFrameUploadForImage: (
    id: string,
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
}

export function BatchImageMediaSettingsSection({
  img,
  loading,
  onUpdateImageSettings,
  onLastFrameUploadForImage,
}: BatchImageMediaSettingsSectionProps) {
  return (
    <>
      <BatchLastFramePromptSection
        img={img}
        loading={loading}
        onUpdateImageSettings={onUpdateImageSettings}
        onLastFrameUploadForImage={onLastFrameUploadForImage}
      />
      <BatchVideoCoreOptionsSection
        img={img}
        loading={loading}
        onUpdateImageSettings={onUpdateImageSettings}
      />
      <BatchVideoToggleOptions
        img={img}
        loading={loading}
        onUpdateImageSettings={onUpdateImageSettings}
      />
    </>
  );
}
