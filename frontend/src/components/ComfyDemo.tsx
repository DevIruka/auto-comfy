import { useState } from "react";
import { comfyClient } from "../api/comfy-client";
import {
  createWanWorkflow,
  DEFAULT_WAN_POSITIVE_PROMPT,
  DEFAULT_WAN_NEGATIVE_PROMPT,
} from "../workflows/wan-workflow";
import { useComfyProgress } from "../hooks/useComfyProgress";
import "./ComfyDemo.css";

interface GeneratedImage {
  url: string;
  promptId: string;
}

interface QueueStatus {
  queue_running: unknown[];
  queue_pending: unknown[];
}

export default function ComfyDemo() {
  const [prompt, setPrompt] = useState(DEFAULT_WAN_POSITIVE_PROMPT);
  const [negativePrompt, setNegativePrompt] = useState(
    DEFAULT_WAN_NEGATIVE_PROMPT,
  );
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [image260, setImage260] = useState<File | null>(null);
  const [image881, setImage881] = useState<File | null>(null);
  const [uploadedImage260, setUploadedImage260] = useState<string>("");
  const [uploadedImage881, setUploadedImage881] = useState<string>("");
  const [seed, setSeed] = useState<number>(625130800946143);

  const { progress, currentNode, isConnected, resetProgress } =
    useComfyProgress();

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    resetProgress();

    try {
      // 이미지 업로드
      let uploadedFilename260 = uploadedImage260;
      let uploadedFilename881 = uploadedImage881;

      if (image260) {
        console.log("📤 노드 260 이미지 업로드 중...");
        const result = await comfyClient.uploadImage(image260);
        uploadedFilename260 = result.name;
        setUploadedImage260(result.name);
        console.log("✅ 노드 260 이미지 업로드 완료:", result.name);
      }

      if (image881) {
        console.log("📤 노드 881 이미지 업로드 중...");
        const result = await comfyClient.uploadImage(image881);
        uploadedFilename881 = result.name;
        setUploadedImage881(result.name);
        console.log("✅ 노드 881 이미지 업로드 완료:", result.name);
      }

      const workflow = createWanWorkflow(
        prompt,
        negativePrompt,
        uploadedFilename260,
        uploadedFilename881,
        seed,
      );
      console.log("🚀 WAN 2.2 워크플로우 실행 중...");

      const result = await comfyClient.executeWorkflow(workflow);
      console.log("✅ 실행 완료:", result);

      // 이미지 추출
      const imageUrls = comfyClient.extractImageUrls(result);

      const newImages = imageUrls.map((url) => ({
        url,
        promptId: result.prompt_id,
      }));

      setImages((prev) => [...newImages, ...prev]);

      // 동영상 자동 다운로드 (노드 1099: h264-mp4)
      const output1099 = result.outputs["1099"] as {
        gifs?: Array<{ filename: string; subfolder: string; type: string }>;
      };
      if (output1099?.gifs) {
        const videoFiles = output1099.gifs;
        for (const video of videoFiles) {
          await downloadVideo(video.filename, video.subfolder, video.type);
        }
      }

      // 무손실 동영상도 다운로드 (노드 828: ffv1-mkv)
      const output828 = result.outputs["828"] as {
        gifs?: Array<{ filename: string; subfolder: string; type: string }>;
      };
      if (output828?.gifs) {
        const videoFiles = output828.gifs;
        for (const video of videoFiles) {
          await downloadVideo(video.filename, video.subfolder, video.type);
        }
      }
    } catch (err) {
      console.error("❌ 실행 실패:", err);
      const errorMessage =
        err instanceof Error ? err.message : "워크플로우 실행에 실패했습니다.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckQueue = async () => {
    try {
      const status = await comfyClient.getQueueStatus();
      setQueueStatus(status);
      console.log("Queue Status:", status);
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "큐 상태를 가져오는데 실패했습니다.";
      setError(errorMessage);
    }
  };

  const handleCloseQueue = () => {
    setQueueStatus(null);
  };

  const handleHealthCheck = async () => {
    try {
      const health = await comfyClient.healthCheck();
      alert(`✅ 백엔드 연결 정상\n${JSON.stringify(health, null, 2)}`);
    } catch {
      alert("❌ 백엔드 연결 실패\n서버가 실행 중인지 확인하세요.");
    }
  };

  const downloadVideo = async (
    filename: string,
    subfolder: string = "",
    type: string = "output",
  ) => {
    try {
      console.log("📥 동영상 다운로드 중:", filename);
      const videoUrl = comfyClient.getImageUrl(filename, subfolder, type);

      // Fetch video and download
      const response = await fetch(videoUrl);
      const blob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log("✅ 동영상 다운로드 완료:", filename);
    } catch (error) {
      console.error("❌ 동영상 다운로드 실패:", error);
    }
  };

  return (
    <div className="comfy-demo">
      <header className="demo-header">
        <h1>🎨 Auto-Comfy Demo</h1>
        <p>WAN 2.2 애니메이션 생성 워크플로우</p>
      </header>

      <div className="demo-container">
        <div className="controls">
          <div className="form-group">
            <label htmlFor="prompt">Positive Prompt</label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="원하는 이미지 설명을 입력하세요..."
            />
          </div>

          <div className="form-group">
            <label htmlFor="negative-prompt">Negative Prompt</label>
            <textarea
              id="negative-prompt"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              placeholder="제외할 요소를 입력하세요..."
            />
          </div>

          <div className="form-group">
            <label htmlFor="seed">Seed (고정값)</label>
            <input
              type="number"
              id="seed"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              placeholder="시드 값을 입력하세요..."
            />
          </div>

          <div className="form-group">
            <label htmlFor="image-260">Image 260 (선택사항)</label>
            <input
              type="file"
              id="image-260"
              accept="image/*"
              onChange={(e) => setImage260(e.target.files?.[0] || null)}
            />
            {uploadedImage260 && (
              <small
                style={{
                  color: "#667eea",
                  marginTop: "0.5rem",
                  display: "block",
                }}
              >
                ✓ 업로드됨: {uploadedImage260}
              </small>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="image-881">Image 881 (선택사항)</label>
            <input
              type="file"
              id="image-881"
              accept="image/*"
              onChange={(e) => setImage881(e.target.files?.[0] || null)}
            />
            {uploadedImage881 && (
              <small
                style={{
                  color: "#667eea",
                  marginTop: "0.5rem",
                  display: "block",
                }}
              >
                ✓ 업로드됨: {uploadedImage881}
              </small>
            )}
          </div>

          <div className="button-group">
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt}
              className="btn-primary"
            >
              {loading ? "⏳ 생성 중..." : "🎬 애니메이션 생성"}
            </button>

            <button onClick={handleCheckQueue} className="btn-secondary">
              📊 큐 상태 확인
            </button>

            <button onClick={handleHealthCheck} className="btn-secondary">
              💚 연결 테스트
            </button>
          </div>

          {loading && (
            <div className="progress-container">
              <div className="progress-info">
                <span>진행률: {Math.round(progress)}%</span>
                {!isConnected && (
                  <span className="ws-status">🔴 연결 중...</span>
                )}
                {isConnected && <span className="ws-status">🟢 연결됨</span>}
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {currentNode && (
                <div className="current-node">
                  현재 실행 중: 노드 {currentNode}
                </div>
              )}
            </div>
          )}

          {error && <div className="error-message">❌ {error}</div>}

          {queueStatus && (
            <div className="queue-status">
              <div className="queue-status-header">
                <h3>Queue Status</h3>
                <button
                  className="close-button"
                  onClick={handleCloseQueue}
                  title="닫기"
                >
                  ✕
                </button>
              </div>
              <pre>{JSON.stringify(queueStatus, null, 2)}</pre>
            </div>
          )}
        </div>

        <div className="results">
          <h2>생성된 애니메이션 ({images.length})</h2>

          {loading && (
            <div className="loading">
              <div className="spinner"></div>
              <p>애니메이션을 생성하고 있습니다... (시간이 걸릴 수 있습니다)</p>
            </div>
          )}

          {images.length === 0 && !loading && (
            <div className="empty-state">
              <p>아직 생성된 애니메이션이 없습니다.</p>
              <p>위에서 프롬프트를 입력하고 애니메이션을 생성해보세요!</p>
            </div>
          )}

          <div className="image-grid">
            {images.map((image, index) => (
              <div key={index} className="image-card">
                <img src={image.url} alt={`Generated ${index}`} />
                <div className="image-info">
                  <small>Prompt ID: {image.promptId.slice(0, 8)}...</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
