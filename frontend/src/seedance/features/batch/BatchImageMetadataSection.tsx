import type { ImageFile } from "../../types/app";
import { BatchDuplicateSection } from "./BatchDuplicateSection";
import { BatchOutputMetadataSection } from "./BatchOutputMetadataSection";
import type { BatchSettingsPatch } from "./types";

interface BatchImageMetadataSectionProps {
  img: ImageFile;
  loading: boolean;
  onDuplicateImage: (id: string) => void;
  onUpdateImageSettings: (id: string, settings: BatchSettingsPatch) => void;
}

export function BatchImageMetadataSection({
  img,
  loading,
  onDuplicateImage,
  onUpdateImageSettings,
}: BatchImageMetadataSectionProps) {
  return (
    <>
      <BatchDuplicateSection
        imageId={img.id}
        loading={loading}
        onDuplicateImage={onDuplicateImage}
      />
      <BatchOutputMetadataSection
        img={img}
        loading={loading}
        onUpdateImageSettings={onUpdateImageSettings}
      />
    </>
  );
}
