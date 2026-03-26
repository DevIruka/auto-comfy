interface GeneratedVideosSectionProps {
  generatedVideo: string;
  generatedVideos: string[];
  onDownloadSingle: () => void;
  onDownloadBatch: (video: string, index: number) => void;
}

export function GeneratedVideosSection({
  generatedVideo,
  generatedVideos,
  onDownloadSingle,
  onDownloadBatch,
}: GeneratedVideosSectionProps) {
  if (!generatedVideo && generatedVideos.length === 0) return null;

  return (
    <div className="results-section">
      <h2>Generated Videos</h2>

      {generatedVideos.length > 0 ? (
        <div className="videos-grid">
          {generatedVideos.map((video, index) => (
            <div key={index} className="video-item">
              <h3>Video {index + 1}</h3>
              <video src={video} controls className="generated-video" autoPlay muted loop>
                Your browser does not support the video tag.
              </video>
              <button className="download-btn" onClick={() => onDownloadBatch(video, index + 1)}>
                Download Video {index + 1}
              </button>
            </div>
          ))}
        </div>
      ) : (
        generatedVideo && (
          <div className="video-container">
            <video
              src={generatedVideo}
              controls
              className="generated-video"
              autoPlay
              muted
              loop
            >
              Your browser does not support the video tag.
            </video>
            <button className="download-btn" onClick={onDownloadSingle}>
              Download Video
            </button>
          </div>
        )
      )}
    </div>
  );
}
