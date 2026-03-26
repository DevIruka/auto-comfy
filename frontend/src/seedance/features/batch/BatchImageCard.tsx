import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { ImageFile } from "../../types/app";
import { BatchImageCardHeader } from "./BatchImageCardHeader";
import { BatchImageMediaSettingsSection } from "./BatchImageMediaSettingsSection";
import { BatchImageMetadataSection } from "./BatchImageMetadataSection";

interface BatchImageCardProps {
  img: ImageFile;
  uploadedImages: ImageFile[];
  expandedImageId: string | null;
  setExpandedImageId: Dispatch<SetStateAction<string | null>>;
  loading: boolean;
  onRemoveImage: (id: string) => void;
  onDuplicateImage: (id: string) => void;
  onUpdateImageSettings: (
    id: string,
    settings: Partial<Omit<ImageFile, "id" | "file" | "preview" | "name">>,
  ) => void;
  onLastFrameUploadForImage: (
    id: string,
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
}

export function BatchImageCard({
  img,
  uploadedImages,
  expandedImageId,
  setExpandedImageId,
  loading,
  onRemoveImage,
  onDuplicateImage,
  onUpdateImageSettings,
  onLastFrameUploadForImage,
}: BatchImageCardProps) {
  const sameNameEntries = uploadedImages.filter((i) => i.name === img.name);
  const sameNameCount = sameNameEntries.length;
  const sameNameIndex = sameNameEntries.findIndex((i) => i.id === img.id);

  return (
    <div className="uploaded-image-card-expanded">
      <BatchImageCardHeader
        img={img}
        sameNameCount={sameNameCount}
        sameNameIndex={sameNameIndex}
        expandedImageId={expandedImageId}
        setExpandedImageId={setExpandedImageId}
        loading={loading}
        onRemoveImage={onRemoveImage}
      />

      {expandedImageId === img.id && (
        <div className="card-settings">
          <BatchImageMetadataSection
            img={img}
            loading={loading}
            onDuplicateImage={onDuplicateImage}
            onUpdateImageSettings={onUpdateImageSettings}
          />
          <BatchImageMediaSettingsSection
            img={img}
            loading={loading}
            onUpdateImageSettings={onUpdateImageSettings}
            onLastFrameUploadForImage={onLastFrameUploadForImage}
          />
        </div>
      )}
    </div>
  );
}
