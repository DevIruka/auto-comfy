import { useState, useEffect, useCallback } from "react";
import { batchClient } from "../api/batch-client";
import type { BatchJob, ImageTask } from "../api/batch-client";
import {
  comfyClient,
  type ComfyInstanceInfo,
  groupInstancesByPod,
} from "../api/comfy-client";
import { useBatchProgress } from "../hooks/useBatchProgress";
import PresetPicker from "./PresetPicker";
import type { CharacterPreset } from "../api/presets-client";
import "./BatchProcessor.css";

interface FolderPair {
  id: string;
  inputPath: string;
  outputPath: string;
  scannedImages: ImageTask[];
  isScanning: boolean;
}

export default function BatchProcessor() {
  const [folderPairs, setFolderPairs] = useState<FolderPair[]>([
    {
      id: crypto.randomUUID(),
      inputPath: "",
      outputPath: "./output",
      scannedImages: [],
      isScanning: false,
    },
  ]);
  const [prefixPrompt, setPrefixPrompt] = useState("");
  const [includeRandomSeeds, setIncludeRandomSeeds] = useState(false);
  const [autoStopPod, setAutoStopPod] = useState(false);
  const [comfyInstances, setComfyInstances] = useState<ComfyInstanceInfo[]>([]);
  const [selectedComfyInstanceId, setSelectedComfyInstanceId] = useState("");
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const { progress, isConnected } = useBatchProgress();

  // 현재 진행 중인 작업 (WS progress.jobId와 일치하는 job)
  const currentJob = progress.jobId
    ? jobs.find((j) => j.id === progress.jobId)
    : jobs.find((j) => j.status === "running" || j.status === "paused");
  const hasRunningOrPending = jobs.some(
    (j) => j.status === "running" || j.status === "paused" || j.status === "pending",
  );

  const loadComfyInstances = useCallback(async () => {
    try {
      const instances = await comfyClient.getComfyInstances();
      setComfyInstances(instances);
      setSelectedComfyInstanceId((prev) =>
        prev ? prev : instances[0]?.id ?? "",
      );
    } catch (err) {
      console.error("Failed to load ComfyUI instances:", err);
    }
  }, []);

  useEffect(() => {
    loadComfyInstances();
  }, [loadComfyInstances]);

  const fetchJobs = useCallback(async () => {
    try {
      const list = await batchClient.getAllJobs();
      setJobs(list);
    } catch (err) {
      console.error("Failed to fetch batch jobs:", err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (!hasRunningOrPending) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [hasRunningOrPending, fetchJobs]);

  const handlePresetLoad = (preset: CharacterPreset) => {
    if (preset.prefixPrompt !== undefined) setPrefixPrompt(preset.prefixPrompt);
  };

  const getCurrentSettingsForPreset = () => ({ prefixPrompt });

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
    field: "inputPath" | "outputPath",
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
      const images = await batchClient.scanFolder(pair.inputPath);
      setFolderPairs((prev) =>
        prev.map((p) =>
          p.id === pairId
            ? { ...p, scannedImages: images, isScanning: false }
            : p,
        ),
      );
      addLog(`✅ ${images.length}개의 이미지를 찾았습니다 (${pair.inputPath})`);

      // Group by pose
      const poseGroups = images.reduce(
        (acc, img) => {
          if (!acc[img.poseName]) acc[img.poseName] = 0;
          acc[img.poseName]++;
          return acc;
        },
        {} as Record<string, number>,
      );

      Object.entries(poseGroups).forEach(([pose, count]) => {
        addLog(`  - ${pose}: ${count}개`);
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
    for (const pair of folderPairs) {
      if (!pair.inputPath) {
        setError("모든 Input 폴더 경로를 입력하세요");
        return;
      }
      if (!pair.outputPath) {
        setError("모든 Output 폴더 경로를 입력하세요");
        return;
      }
    }
    if (!prefixPrompt) {
      setError("접두 프롬프트를 입력하세요");
      return;
    }

    setLoading(true);
    setError(null);
    addLog(`📦 ${folderPairs.length}개 작업을 큐에 추가합니다`);

    try {
      for (let i = 0; i < folderPairs.length; i++) {
        const pair = folderPairs[i];
        const isLastPair = i === folderPairs.length - 1;
        const shouldStopPod = autoStopPod && isLastPair;

        const result = await batchClient.startBatch(
          pair.inputPath,
          pair.outputPath,
          prefixPrompt,
          includeRandomSeeds,
          shouldStopPod,
          selectedComfyInstanceId || undefined,
        );
        setJobs((prev) => [...prev, result.job]);
        addLog(
          `✅ [${i + 1}/${folderPairs.length}] 작업 추가: ${result.jobId.slice(0, 8)}… (${pair.inputPath} → ${pair.outputPath})`,
        );
      }
      addLog("작업이 백그라운드에서 실행됩니다. 계속해서 새 작업을 추가할 수 있습니다.");
      await fetchJobs();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "시작 실패";
      setError(errorMessage);
      addLog(`❌ 실패: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    if (!currentJob) return;

    setLoading(true);
    addLog("일시정지 요청");

    try {
      await batchClient.pauseBatch(currentJob.id);
      addLog("✅ 배치 작업 일시정지됨");

      // Update job status
      await fetchJobs();
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
      await batchClient.resumeBatch(currentJob.id);
      addLog("✅ 배치 작업 재시작됨");

      await fetchJobs();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "재시작 실패";
      setError(errorMessage);
      addLog(`❌ 재시작 실패: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (jobId?: string) => {
    const targetId = jobId ?? currentJob?.id;
    if (!targetId) return;

    if (!window.confirm("정말로 배치 작업을 중지하시겠습니까?")) return;

    setLoading(true);
    addLog("중지 요청");

    try {
      await batchClient.stopBatch(targetId);
      addLog("✅ 배치 작업 중지됨");
      await fetchJobs();
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

    // Average 250 seconds (4 minutes 10 seconds) per video
    const avgSecondsPerVideo = 250;
    const videosRemaining =
      progress.totalVideos -
      (progress.currentImageIndex - 1) * 5 -
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
        <h1>🎬 Batch Video Generator</h1>
        <p>자동 배치 애니메이션 생성</p>
        <PresetPicker onLoad={handlePresetLoad} getCurrentSettings={getCurrentSettingsForPreset} />
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
            <label htmlFor="comfy-instance">ComfyUI 인스턴스 (포드)</label>
            <select
              id="comfy-instance"
              value={selectedComfyInstanceId}
              onChange={(e) => setSelectedComfyInstanceId(e.target.value)}
              disabled={loading}
              className="comfy-select"
            >
              {groupInstancesByPod(comfyInstances).map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.instances.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}
                      {inst.port ? ` :${inst.port}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="prefix-prompt">접두 프롬프트 (캐릭터 설명)</label>
            <textarea
              id="prefix-prompt"
              value={prefixPrompt}
              onChange={(e) => setPrefixPrompt(e.target.value)}
              rows={3}
              placeholder="1girl, long hair, blue eyes, school uniform"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={includeRandomSeeds}
                onChange={(e) => setIncludeRandomSeeds(e.target.checked)}
                disabled={loading}
                className="toggle-checkbox"
              />
              <span className="toggle-text">
                🎲 랜덤 시드 2개 추가 생성 ({includeRandomSeeds ? "ON" : "OFF"})
              </span>
              <div className="toggle-description">
                {includeRandomSeeds
                  ? "✅ 고정 시드 3개 + 랜덤 시드 2개 = 총 5개 영상 생성"
                  : "기본: 고정 시드 3개만 생성"}
              </div>
            </label>
          </div>

          <div className="form-group">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={autoStopPod}
                onChange={(e) => setAutoStopPod(e.target.checked)}
                disabled={loading}
                className="toggle-checkbox"
              />
              <span className="toggle-text">
                🛑 작업 완료 후 RunPod 자동 종료 ({autoStopPod ? "ON" : "OFF"})
              </span>
              <div className="toggle-description">
                {autoStopPod
                  ? "✅ 모든 영상 생성 완료 시 자동으로 RunPod을 중지합니다"
                  : "RunPod 자동 종료 안 함"}
              </div>
            </label>
          </div>

          <div className="folder-pairs-section">
            <div className="section-header">
              <h3>폴더 설정</h3>
              <button
                onClick={addFolderPair}
                disabled={loading}
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
                      disabled={loading}
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
                    placeholder="c:\Users\박민준\Desktop\input"
                    disabled={loading}
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
                    placeholder="./output"
                    disabled={loading}
                  />
                </div>

                <button
                  onClick={() => handleScan(pair.id)}
                  disabled={
                    pair.isScanning ||
                    loading ||
                    !pair.inputPath
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
                      {pair.scannedImages.length * (includeRandomSeeds ? 5 : 3)}
                      개 영상 예상
                    </p>
                    <p>
                      ⏱️{" "}
                      {(() => {
                        const totalVideos =
                          pair.scannedImages.length *
                          (includeRandomSeeds ? 5 : 3);
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
                (sum, pair) => sum + pair.scannedImages.length,
                0,
              ) * (includeRandomSeeds ? 5 : 3)}
              개
            </p>
            <p>
              예상 총 소요 시간:{" "}
              {(() => {
                const totalVideos =
                  folderPairs.reduce(
                    (sum, pair) => sum + pair.scannedImages.length,
                    0,
                  ) * (includeRandomSeeds ? 5 : 3);
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
                folderPairs.some((p) => !p.inputPath || !p.outputPath)
              }
              className="btn-primary btn-large"
            >
              {loading ? "추가 중…" : "▶️ 작업 큐에 추가"}
            </button>
          </div>
        </div>

        {/* Jobs list */}
        {jobs.length > 0 && (
          <div className="config-section job-list-section">
            <h2>작업 목록</h2>
            <div className="job-list-summary">
              대기/실행 중: {jobs.filter((j) => ["pending", "running", "paused"].includes(j.status)).length}건
              / 완료·실패: {jobs.filter((j) => ["completed", "failed", "stopped"].includes(j.status)).length}건
            </div>
            <ul className="batch-job-list">
              {jobs.slice().reverse().slice(0, 30).map((j) => (
                <li key={j.id} className={`batch-job-item batch-job-${j.status}`}>
                  <span className="batch-job-id" title={j.id}>{j.id.slice(0, 8)}…</span>
                  <span className={`badge badge-${j.status}`}>{j.status}</span>
                  <span className="batch-job-meta">
                    {j.currentImageIndex}/{j.totalImages} 이미지 · {j.currentVideoIndex}/{j.totalVideos} 영상
                  </span>
                  {(j.status === "running" || j.status === "paused") && (
                    <button
                      type="button"
                      className="btn-small btn-danger"
                      onClick={() => handleStop(j.id)}
                      disabled={loading}
                    >
                      중지
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

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
                  onClick={() => handleStop()}
                  disabled={loading}
                  className="btn-danger"
                >
                  ⏹️ 중지
                </button>
              )}
            </div>

            <div className="job-status">
              <div className="status-badge">
                상태:{" "}
                <span className={`badge badge-${currentJob.status}`}>
                  {currentJob.status}
                </span>
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
                <span>{progress.currentVideoIndex}/5</span>
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
                <h3
                  style={{
                    fontSize: "1rem",
                    marginBottom: "0.5rem",
                    color: "#666",
                  }}
                >
                  현재 영상 생성 중
                </h3>
                <div
                  className="progress-bar-container"
                  style={{ height: "30px" }}
                >
                  <div
                    className="progress-bar"
                    style={{
                      width: `${(progress.currentVideoProgress / progress.currentVideoProgressMax) * 100}%`,
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
              <h3
                style={{
                  fontSize: "1rem",
                  marginBottom: "0.5rem",
                  color: "#666",
                }}
              >
                전체 진행률
              </h3>
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
            <div className="error-message">
              ❌ {error}
              <button onClick={() => setError(null)} className="close-error">
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Logs Section */}
        <div className="logs-section">
          <div className="logs-header">
            <h2>로그</h2>
            <button onClick={clearLogs} className="btn-clear">
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
