interface BatchDuplicateSectionProps {
  imageId: string;
  loading: boolean;
  onDuplicateImage: (id: string) => void;
}

export function BatchDuplicateSection({
  imageId,
  loading,
  onDuplicateImage,
}: BatchDuplicateSectionProps) {
  return (
    <div
      className="save-settings-section"
      style={{
        marginBottom: "15px",
        paddingBottom: "15px",
        borderBottom: "1px solid #e0e0e0",
      }}
    >
      <h4 className="section-title">Duplicate</h4>
      <button
        className="generate-btn"
        onClick={() => onDuplicateImage(imageId)}
        disabled={loading}
        style={{
          fontSize: "14px",
          padding: "8px 16px",
          backgroundColor: "#9c27b0",
        }}
      >
        Duplicate This Config
      </button>
      <p className="helper-text" style={{ marginTop: "8px", fontSize: "12px" }}>
        Reuses current settings including first/last frame inputs.
      </p>
    </div>
  );
}
