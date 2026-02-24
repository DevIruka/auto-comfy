import { useState, useEffect } from "react";
import { emotionBatchClient } from "../api/emotion-batch-client";
import type {
  EmotionBatchJob,
  EmotionImageTask,
  ComfyInstance,
} from "../api/emotion-batch-client";
import { useEmotionBatchProgress } from "../hooks/useEmotionBatchProgress";
import "./BatchProcessor.css"; // Reuse existing styles

interface FolderPair {
  id: string;
  inputPath: string;
  outputPath: string;
  comfyInstanceId: string;
  scannedImages: EmotionImageTask[];
  isScanning: boolean;
}

export default function EmotionBatchProcessor() {
  const [folderPairs, setFolderPairs] = useState<FolderPair[]>([
    {
      id: crypto.randomUUID(),
      inputPath: "",
      outputPath: "./output",
      comfyInstanceId: "",
      scannedImages: [],
      isScanning: false,
    },
  ]);
  const [prefixPrompt, setPrefixPrompt] = useState("");
  const [includeSpeakNatural, setIncludeSpeakNatural] = useState(false);
  const [autoStopPod, setAutoStopPod] = useState(false); // NEW: Auto-stop RunPod
  const [comfyInstances, setComfyInstances] = useState<ComfyInstance[]>([]);
  const [currentJob, setCurrentJob] = useState<EmotionBatchJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [currentPairIndex, setCurrentPairIndex] = useState(0);

  const { progress, isConnected, resetProgress } = useEmotionBatchProgress();

  // Load ComfyUI instances on mount
  useEffect(() => {
    loadComfyInstances();
  }, []);

  const loadComfyInstances = async () => {
    try {
      const instances = await emotionBatchClient.getComfyInstances();
      setComfyInstances(instances);

      // Set default ComfyUI for first folder pair
      if (instances.length > 0 && folderPairs[0].comfyInstanceId === "") {
        setFolderPairs((prev) =>
          prev.map((pair, idx) =>
            idx === 0 ? { ...pair, comfyInstanceId: instances[0].id } : pair,
          ),
        );
      }
    } catch (err) {
      console.error("Failed to load ComfyUI instances:", err);
      addLog("⚠️ ComfyUI 인스턴스를 불러오지 못했습니다");
    }
  };

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  const addFolderPair = () => {
    setFolderPairs((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        inputPath: "",
        outputPath: "./output",
        comfyInstanceId: comfyInstances[0]?.id || "",
        scannedImages: [],
        isScanning: false,
      },
    ]);
  };

  const removeFolderPair = (id: string) => {
    if (folderPairs.length <= 1) {
      setError("최소 1개의 폴더 쌍이 필요합니다");
      return;
    }
    setFolderPairs((prev) => prev.filter((pair) => pair.id !== id));
  };

  const updateFolderPair = (
    id: string,
    field: keyof FolderPair,
    value: string,
  ) => {
    setFolderPairs((prev) =>
      prev.map((pair) => (pair.id === id ? { ...pair, [field]: value } : pair)),
    );
  };

  const handleScan = async (pairId: string) => {
    const pair = folderPairs.find((p) => p.id === pairId);
    if (!pair || !pair.inputPath) {
      setError("폴더 경로를 입력하세요");
      return;
    }

    setFolderPairs((prev) =>
      prev.map((p) => (p.id === pairId ? { ...p, isScanning: true } : p)),
    );
    setError(null);
    addLog(`폴더 스캔 시작: ${pair.inputPath}`);

    try {
      const images = await emotionBatchClient.scanFolder(pair.inputPath);
      setFolderPairs((prev) =>
        prev.map((p) =>
          p.id === pairId
            ? { ...p, scannedImages: images, isScanning: false }
            : p,
        ),
      );
      addLog(
        `✅ ${images.length}개의 감정 이미지를 찾았습니다 (${pair.inputPath})`,
      );

      // Group by emotion
      const emotionGroups = images.reduce(
        (acc, img) => {
          const key = `${img.pose}_${img.emotion}_${img.clothingType}`;
          if (!acc[key]) acc[key] = 0;
          acc[key]++;
          return acc;
        },
        {} as Record<string, number>,
      );

      Object.entries(emotionGroups).forEach(([group, count]) => {
        addLog(`  - ${group}: ${count}개`);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "스캔 실패";
      setError(errorMessage);
      addLog(`❌ 스캔 실패: ${errorMessage}`);
      setFolderPairs((prev) =>
        prev.map((p) => (p.id === pairId ? { ...p, isScanning: false } : p)),
      );
    }
  };

  const handleStart = async () => {
    // Validate all folder pairs
    for (const pair of folderPairs) {
      if (!pair.inputPath) {
        setError("모든 Input 폴더 경로를 입력하세요");
        return;
      }
      if (!pair.outputPath) {
        setError("모든 Output 폴더 경로를 입력하세요");
        return;
      }
      if (!pair.comfyInstanceId) {
        setError("모든 폴더에 ComfyUI 인스턴스를 선택하세요");
        return;
      }
    }

    if (!prefixPrompt) {
      setError("접두 프롬프트를 입력하세요");
      return;
    }

    setLoading(true);
    setError(null);
    resetProgress();
    addLog(`📦 ${folderPairs.length}개의 감정 비디오 배치 작업 시작`);

    try {
      // Process each folder pair sequentially
      for (let i = 0; i < folderPairs.length; i++) {
        const pair = folderPairs[i];
        const isLastPair = i === folderPairs.length - 1;
        const shouldStopPod = autoStopPod && isLastPair;

        setCurrentPairIndex(i);
        addLog(
          `\n😊 [${i + 1}/${folderPairs.length}] 처리 시작: ${
            pair.inputPath
          } → ${pair.outputPath} (${pair.comfyInstanceId})`,
        );

        const result = await emotionBatchClient.startBatch(
          pair.inputPath,
          pair.outputPath,
          prefixPrompt,
          pair.comfyInstanceId,
          includeSpeakNatural,
          shouldStopPod,
        );
        setCurrentJob(result.job);
        addLog(`✅ 배치 작업 생성: ${result.jobId}`);
        addLog(
          `   총 ${result.job.totalImages}개 이미지, ${result.job.totalVideos}개 영상 생성 예정 (각 이미지당 9개 영상)`,
        );

        // Wait for this batch to complete before moving to next
        await waitForBatchCompletion(result.jobId);
        addLog(`✅ [${i + 1}/${folderPairs.length}] 완료: ${pair.inputPath}`);
      }

      addLog("\n🎉 모든 감정 비디오 배치 작업 완료!");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "시작 실패";
      setError(errorMessage);
      addLog(`❌ 실패: ${errorMessage}`);
    } finally {
      setLoading(false);
      setCurrentPairIndex(0);
    }
  };

  const waitForBatchCompletion = async (jobId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          const status = await emotionBatchClient.getBatchStatus(jobId);
          if (status.status === "completed") {
            clearInterval(checkInterval);
            resolve();
          } else if (
            status.status === "failed" ||
            status.status === "stopped"
          ) {
            clearInterval(checkInterval);
            reject(
              new Error(`Batch ${jobId} failed with status: ${status.status}`),
            );
          }
        } catch (err) {
          clearInterval(checkInterval);
          reject(err);
        }
      }, 5000);
    });
  };

  const handlePause = async () => {
    if (!currentJob) return;

    setLoading(true);
    addLog("일시정지 요청");

    try {
      await emotionBatchClient.pauseBatch(currentJob.id);
      addLog("✅ 배치 작업 일시정지됨");

      const updatedJob = await emotionBatchClient.getBatchStatus(currentJob.id);
      setCurrentJob(updatedJob);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "일시정지 실패";
      setError(errorMessage);
      addLog(`❌ 일시정지 실패: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    if (!currentJob) return;

    setLoading(true);
    addLog("재시작 요청");

    try {
      await emotionBatchClient.resumeBatch(currentJob.id);
      addLog("✅ 배치 작업 재시작됨");

      const updatedJob = await emotionBatchClient.getBatchStatus(currentJob.id);
      setCurrentJob(updatedJob);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "재시작 실패";
      setError(errorMessage);
      addLog(`❌ 재시작 실패: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!currentJob) return;

    if (!window.confirm("정말로 배치 작업을 중지하시겠습니까?")) return;

    setLoading(true);
    addLog("중지 요청");

    try {
      await emotionBatchClient.stopBatch(currentJob.id);
      addLog("✅ 배치 작업 중지됨");

      const updatedJob = await emotionBatchClient.getBatchStatus(currentJob.id);
      setCurrentJob(updatedJob);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "중지 실패";
      setError(errorMessage);
      addLog(`❌ 중지 실패: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  // Calculate estimated time remaining
  const estimatedTimeRemaining = () => {
    if (!progress.overallProgress || progress.overallProgress === 0) {
      return "계산 중...";
    }

    const avgSecondsPerVideo = 250;
    const videosRemaining =
      progress.totalVideos -
      (progress.currentImageIndex - 1) * 9 -
      progress.currentVideoIndex;
    const secondsRemaining = videosRemaining * avgSecondsPerVideo;

    const hours = Math.floor(secondsRemaining / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);

    if (hours > 0) {
      return `약 ${hours}시간 ${minutes}분`;
    } else {
      return `약 ${minutes}분`;
    }
  };

  return (
    <div className="batch-processor">
      <header className="batch-header">
        <h1>😊 Emotion Video Generator</h1>
        <p>감정 기반 대화/대기 영상 자동 생성</p>
        <div className="connection-status">
          {isConnected ? (
            <span className="status-connected">🟢 연결됨</span>
          ) : (
            <span className="status-disconnected">🔴 연결 끊김</span>
          )}
        </div>
      </header>

      <div className="batch-container">
        {/* Configuration Section */}
        <div className="config-section">
          <h2>설정</h2>

          <div className="form-group">
            <label htmlFor="prefix-prompt">접두 프롬프트 (캐릭터 설명)</label>
            <textarea
              id="prefix-prompt"
              value={prefixPrompt}
              onChange={(e) => setPrefixPrompt(e.target.value)}
              rows={3}
              placeholder="1girl, long hair, blue eyes, school uniform"
              disabled={loading || currentJob?.status === "running"}
            />
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={includeSpeakNatural}
                onChange={(e) => setIncludeSpeakNatural(e.target.checked)}
                disabled={loading || currentJob?.status === "running"}
              />{" "}
              SpeakNatural 영상도 생성 (Idle만 생성하려면 체크 해제)
            </label>
            <p className="note" style={{ marginTop: "8px", fontSize: "0.9em" }}>
              ℹ️ Idle: 각 프롬프트당 3개 시드 = 총 15개 영상 (neutral만)
              <br />
              {includeSpeakNatural
                ? "SpeakNatural: 각 감정당 3-6개 추가 (neutral +3, 기타 +6)"
                : ""}
            </p>
          </div>

          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={autoStopPod}
                onChange={(e) => setAutoStopPod(e.target.checked)}
                disabled={loading || currentJob?.status === "running"}
              />{" "}
              🛑 작업 완료 후 RunPod 자동 종료
            </label>
            <p className="note" style={{ marginTop: "8px", fontSize: "0.9em" }}>
              ℹ️ 체크 시 모든 영상 생성이 끝나면 자동으로 RunPod을 중지합니다
            </p>
          </div>

          {comfyInstances.length === 0 && (
            <div className="info-box warning">
              ⚠️ ComfyUI 인스턴스가 설정되지 않았습니다. .env 파일에
              COMFYUI_API_URL_1, COMFYUI_API_URL_2 등을 설정하세요.
            </div>
          )}

          <div className="folder-pairs-section">
            <div className="section-header">
              <h3>폴더 설정</h3>
              <button
                onClick={addFolderPair}
                disabled={
                  loading ||
                  currentJob?.status === "running" ||
                  comfyInstances.length === 0
                }
                className="btn-add"
              >
                ➕ 폴더 쌍 추가
              </button>
            </div>

            {folderPairs.map((pair, index) => (
              <div key={pair.id} className="folder-pair">
                <div className="folder-pair-header">
                  <h4>폴더 쌍 #{index + 1}</h4>
                  {folderPairs.length > 1 && (
                    <button
                      onClick={() => removeFolderPair(pair.id)}
                      disabled={loading || currentJob?.status === "running"}
                      className="btn-remove"
                    >
                      ❌
                    </button>
                  )}
                </div>

                <div className="form-group">
                  <label>Input 폴더 경로</label>
                  <input
                    type="text"
                    value={pair.inputPath}
                    onChange={(e) =>
                      updateFolderPair(pair.id, "inputPath", e.target.value)
                    }
                    placeholder="c:\Users\박민준\Desktop\마사지사\이미지\Sit"
                    disabled={loading || currentJob?.status === "running"}
                  />
                </div>

                <div className="form-group">
                  <label>Output 폴더 경로</label>
                  <input
                    type="text"
                    value={pair.outputPath}
                    onChange={(e) =>
                      updateFolderPair(pair.id, "outputPath", e.target.value)
                    }
                    placeholder="./output/emotion"
                    disabled={loading || currentJob?.status === "running"}
                  />
                </div>

                <div className="form-group">
                  <label>ComfyUI 인스턴스</label>
                  <select
                    value={pair.comfyInstanceId}
                    onChange={(e) =>
                      updateFolderPair(
                        pair.id,
                        "comfyInstanceId",
                        e.target.value,
                      )
                    }
                    disabled={loading || currentJob?.status === "running"}
                    className="comfy-select"
                  >
                    <option value="">선택하세요</option>
                    {comfyInstances.map((instance) => (
                      <option key={instance.id} value={instance.id}>
                        {instance.name} - {instance.url}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => handleScan(pair.id)}
                  disabled={
                    pair.isScanning ||
                    loading ||
                    !pair.inputPath ||
                    currentJob?.status === "running"
                  }
                  className="btn-scan"
                >
                  {pair.isScanning ? "스캔 중..." : "📂 스캔"}
                </button>

                {pair.scannedImages.length > 0 && (
                  <div className="scan-results-mini">
                    <p>✅ {pair.scannedImages.length}개 이미지</p>
                    <p>
                      📹{" "}
                      {pair.scannedImages.reduce(
                        (sum, img) =>
                          sum + (img.emotion === "neutral" ? 11 : 6),
                        0,
                      )}
                      개 영상 예상
                    </p>
                    <p>
                      ⏱️{" "}
                      {(() => {
                        const totalVideos = pair.scannedImages.reduce(
                          (sum, img) => {
                            if (img.emotion === "neutral") {
                              return sum + (includeSpeakNatural ? 18 : 15);
                            } else {
                              return sum + (includeSpeakNatural ? 6 : 0);
                            }
                          },
                          0,
                        );
                        const totalSeconds = totalVideos * 250;
                        const hours = Math.floor(totalSeconds / 3600);
                        const minutes = Math.floor((totalSeconds % 3600) / 60);
                        return hours > 0
                          ? `약 ${hours}시간 ${minutes}분`
                          : `약 ${minutes}분`;
                      })()}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="total-summary">
            <h3>전체 요약</h3>
            <p>
              총 폴더 쌍: {folderPairs.length}개 | 총 이미지:{" "}
              {folderPairs.reduce(
                (sum, pair) => sum + pair.scannedImages.length,
                0,
              )}
              개 | 총 영상:{" "}
              {folderPairs.reduce(
                (sum, pair) =>
                  sum +
                  pair.scannedImages.reduce((imgSum, img) => {
                    if (img.emotion === "neutral") {
                      return imgSum + (includeSpeakNatural ? 18 : 15);
                    } else {
                      return imgSum + (includeSpeakNatural ? 6 : 0);
                    }
                  }, 0),
                0,
              )}
              개
            </p>
            <p className="note">
              {includeSpeakNatural
                ? "ℹ️ neutral: 18개 영상 (Idle 15개 + SpeakNatural 3개) | 기타 감정: 6개 영상 (SpeakNatural 6개)"
                : "ℹ️ neutral: 15개 영상 (Idle만) | 기타 감정: 0개 (Idle 없음)"}
            </p>
            <p>
              예상 총 소요 시간:{" "}
              {(() => {
                const totalVideos = folderPairs.reduce(
                  (sum, pair) =>
                    sum +
                    pair.scannedImages.reduce((imgSum, img) => {
                      if (img.emotion === "neutral") {
                        return imgSum + (includeSpeakNatural ? 18 : 15);
                      } else {
                        return imgSum + (includeSpeakNatural ? 6 : 0);
                      }
                    }, 0),
                  0,
                );
                const totalSeconds = totalVideos * 250;
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                return hours > 0
                  ? `약 ${hours}시간 ${minutes}분`
                  : `약 ${minutes}분`;
              })()}
            </p>
          </div>

          <div className="button-group-main">
            <button
              onClick={handleStart}
              disabled={
                loading ||
                !prefixPrompt ||
                folderPairs.some(
                  (p) => !p.inputPath || !p.outputPath || !p.comfyInstanceId,
                ) ||
                currentJob?.status === "running"
              }
              className="btn-primary btn-large"
            >
              {loading
                ? `처리 중 (${currentPairIndex + 1}/${folderPairs.length})...`
                : "▶️ 전체 배치 시작"}
            </button>
          </div>
        </div>

        {/* Control Section */}
        {currentJob && (
          <div className="control-section">
            <h2>컨트롤</h2>

            <div className="button-group">
              {currentJob.status === "running" && (
                <button
                  onClick={handlePause}
                  disabled={loading}
                  className="btn-warning"
                >
                  ⏸️ 일시정지
                </button>
              )}

              {currentJob.status === "paused" && (
                <button
                  onClick={handleResume}
                  disabled={loading}
                  className="btn-success"
                >
                  ▶️ 재시작
                </button>
              )}

              {(currentJob.status === "running" ||
                currentJob.status === "paused") && (
                <button
                  onClick={handleStop}
                  disabled={loading}
                  className="btn-danger"
                >
                  ⏹️ 중지
                </button>
              )}
            </div>

            <div className="job-info">
              <div className="info-row">
                <span>작업 ID:</span>
                <span className="job-id">{currentJob.id}</span>
              </div>
              <div className="info-row">
                <span>상태:</span>
                <span className={`status-badge status-${currentJob.status}`}>
                  {currentJob.status}
                </span>
              </div>
              <div className="info-row">
                <span>ComfyUI 인스턴스:</span>
                <span>{currentJob.comfyInstanceId}</span>
              </div>
            </div>
          </div>
        )}

        {/* Progress Section */}
        {progress.jobId && (
          <div className="progress-section">
            <h2>진행 상황</h2>

            <div className="progress-info">
              <div className="info-row">
                <span>현재 이미지:</span>
                <span>
                  {progress.currentImage} ({progress.currentImageIndex}/
                  {progress.totalImages})
                </span>
              </div>
              <div className="info-row">
                <span>현재 영상:</span>
                <span>
                  {progress.currentVideoIndex}/{progress.totalVideos}
                </span>
              </div>
              {progress.currentVideoProgressMax > 0 && (
                <div className="info-row">
                  <span>영상 생성 진행률:</span>
                  <span>
                    {progress.currentVideoProgress}/
                    {progress.currentVideoProgressMax} (
                    {Math.round(
                      (progress.currentVideoProgress /
                        progress.currentVideoProgressMax) *
                        100,
                    )}
                    %)
                  </span>
                </div>
              )}
              <div className="info-row">
                <span>전체 진행률:</span>
                <span>{progress.overallProgress}%</span>
              </div>
              <div className="info-row">
                <span>예상 남은 시간:</span>
                <span>{estimatedTimeRemaining()}</span>
              </div>
            </div>

            {/* Current Video Progress Bar */}
            {progress.currentVideoProgressMax > 0 && (
              <div className="video-progress-section">
                <h3>현재 영상 생성 중</h3>
                <div
                  className="progress-bar-container"
                  style={{ height: "30px" }}
                >
                  <div
                    className="progress-bar"
                    style={{
                      width: `${
                        (progress.currentVideoProgress /
                          progress.currentVideoProgressMax) *
                        100
                      }%`,
                      background:
                        "linear-gradient(90deg, #22c55e 0%, #16a34a 100%)",
                    }}
                  >
                    {(progress.currentVideoProgress /
                      progress.currentVideoProgressMax) *
                      100 >
                      10 && (
                      <span className="progress-text">
                        {progress.currentVideoProgress}/
                        {progress.currentVideoProgressMax}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Overall Progress Bar */}
            <div className="overall-progress-section">
              <h3>전체 진행률</h3>
              <div className="progress-bar-container">
                <div
                  className="progress-bar"
                  style={{ width: `${progress.overallProgress}%` }}
                >
                  {progress.overallProgress > 10 && (
                    <span className="progress-text">
                      {progress.overallProgress}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="error-section">
            <h3>❌ 에러</h3>
            <p>{error}</p>
          </div>
        )}

        {/* Logs Section */}
        <div className="logs-section">
          <div className="logs-header">
            <h2>로그</h2>
            <button onClick={clearLogs} className="btn-secondary btn-small">
              🗑️ 지우기
            </button>
          </div>
          <div className="logs-container">
            {logs.length === 0 ? (
              <p className="no-logs">로그가 없습니다</p>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="log-entry">
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
