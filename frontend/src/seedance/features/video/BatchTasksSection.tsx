import type { VideoTask } from "../../types/app";

interface BatchTasksSectionProps {
  videoTasks: VideoTask[];
  loading: boolean;
  onClearCompleted: () => void;
  onClearAll: () => void;
  onRemoveTask: (taskId: string) => void;
  onSaveVideo: (taskId: string, videoUrl: string) => void;
}

export function BatchTasksSection({
  videoTasks,
  loading,
  onClearCompleted,
  onClearAll,
  onRemoveTask,
  onSaveVideo,
}: BatchTasksSectionProps) {
  if (videoTasks.length === 0) return null;

  return (
    <div className="tasks-section">
      <div className="tasks-header">
        <h2>Progress</h2>
        <div className="tasks-actions">
          <button
            className="clear-btn completed"
            onClick={onClearCompleted}
            disabled={loading || !videoTasks.some((t) => t.status === "completed")}
          >
            Remove Completed
          </button>
          <button className="clear-btn all" onClick={onClearAll} disabled={loading}>
            Clear All
          </button>
        </div>
      </div>

      <div className="tasks-grid">
        {videoTasks.map((task) => (
          <div key={task.id} className={`task-card ${task.status}`}>
            <button
              className="remove-btn"
              onClick={() => onRemoveTask(task.id)}
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                background: "rgba(0, 0, 0, 0.6)",
                border: "none",
                color: "white",
                width: "24px",
                height: "24px",
                borderRadius: "50%",
                cursor: "pointer",
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10,
              }}
              title="Remove"
            >
              x
            </button>

            <img
              src={task.imagePreview}
              alt={task.generatedFileName || task.imageName}
              className="task-thumbnail"
            />

            <div className="task-info">
              <p className="task-name" style={{ fontSize: "13px", fontWeight: "bold" }}>
                {task.generatedFileName || task.imageName}
              </p>

              <div className="task-status">
                {task.status === "pending" && (
                  <span className="status-badge pending">Pending</span>
                )}
                {task.status === "processing" && (
                  <span className="status-badge processing">Processing</span>
                )}
                {task.status === "completed" && (
                  <span className="status-badge completed">Completed</span>
                )}
                {task.status === "failed" && (
                  <span className="status-badge failed">Failed: {task.error}</span>
                )}
              </div>
            </div>

            {task.status === "completed" && task.video && (
              <div className="task-video">
                <video src={task.video} controls className="generated-video-small" muted loop>
                  Your browser does not support the video tag.
                </video>
                <button
                  className="download-btn-small"
                  onClick={() => onSaveVideo(task.id, task.video!)}
                >
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
