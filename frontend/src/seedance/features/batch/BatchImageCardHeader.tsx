import type { Dispatch, SetStateAction } from "react";
import type { ImageFile } from "../../types/app";

interface BatchImageCardHeaderProps {
  img: ImageFile;
  sameNameCount: number;
  sameNameIndex: number;
  expandedImageId: string | null;
  setExpandedImageId: Dispatch<SetStateAction<string | null>>;
  loading: boolean;
  onRemoveImage: (id: string) => void;
}

export function BatchImageCardHeader({
  img,
  sameNameCount,
  sameNameIndex,
  expandedImageId,
  setExpandedImageId,
  loading,
  onRemoveImage,
}: BatchImageCardHeaderProps) {
  return (
    <div className="card-header">
      <img src={img.preview} alt={img.name} className="thumbnail-small" />
      <div className="header-info">
        <p className="image-name">
          {img.name}
          {sameNameCount > 1 && (
            <span className="duplicate-badge">
              ({sameNameIndex + 1}/{sameNameCount})
            </span>
          )}
        </p>
        <button
          className="toggle-btn"
          onClick={() => setExpandedImageId(expandedImageId === img.id ? null : img.id)}
        >
          {expandedImageId === img.id ? "Collapse" : "Settings"}
        </button>
      </div>
      <button
        className="remove-btn"
        onClick={() => onRemoveImage(img.id)}
        disabled={loading}
      >
        x
      </button>
    </div>
  );
}
