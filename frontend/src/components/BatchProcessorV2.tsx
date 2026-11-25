import { useState, useEffect, useCallback } from "react";
import { batchV2Client } from "../api/batch-v2-client";
import type { BatchV2Job, WanMode } from "../api/batch-v2-client";
import { batchClient, countImageTasks } from "../api/batch-client";
import type { ImageTask } from "../api/batch-client";
import { useBatchV2Progress } from "../hooks/useBatchV2Progress";
import PresetPicker from "./PresetPicker";
import type { CharacterPreset } from "../api/presets-client";
import { useWorkspace } from "../context/WorkspaceContext";
import "./BatchProcessor.css";

const AVG_SECONDS_PER_VIDEO = 90;

interface FolderPair {
  id: string;
  inputPath: string;
  outputPath: string;
  scannedImages: ImageTask[];
  isScanning: boolean;
}

export default function BatchProcessorV2() {
  const { character: wsCharacter, spot: wsSpot, paths, workspaceReady } = useWorkspace();
  const workspacePresetName =
    wsCharacter.trim() && wsSpot.trim() ? `${wsCharacter.trim()} ${wsSpot.trim()}` : "";

  const [folderPairs, setFolderPairs] = useState<FolderPair[]>([
    {
      id: crypto.randomUUID(),
      inputPath: "",
      outputPath: "",
      scannedImages: [],
      isScanning: false,
    },
  ]);
  const [prefixPrompt, setPrefixPrompt] = useState("");
  const [preferMinimax, setPreferMinimax] = useState(true);
  const [wanVersion, setWanVersion] = useState<WanMode>("json");
  const [jobs, setJobs] = useState<BatchV2Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const { progress, isConnected } = useBatchV2Progress();

  useEffect(() => {
    if (!paths) {
      setFolderPairs((prev) => prev.map((p) => ({ ...p, inputPath: "", outputPath: "" })));
      return;
    }
    setFolderPairs((prev) =>
      prev.map((p) => ({
        ...p,
        inputPath: paths.imageAdult,
        outputPath: paths.videoAdult,
      })),
    );
  }, [paths]);

  const currentJob = progress.jobId
    ? jobs.find((j) => j.id === progress.jobId)
    : jobs.find((j) => j.status === "running" || j.status === "paused");

  const hasRunningOrPending = jobs.some(
    (j) => j.status === "running" || j.status === "paused" || j.status === "pending",
  );

  const fetchJobs = useCallback(async () => {
    try {
      setJobs(await batchV2Client.getAllJobs());
    } catch (err) {
      console.error("Failed to fetch batch v2 jobs:", err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    batchClient
      .getBatchVideoSettings()
      .then((settings) => setPreferMinimax(settings.preferMinimax))
      .catch((err) => console.error("Failed to load batch settings:", err));
  }, []);

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
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const addFolderPair = () => {
    setFolderPairs((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        inputPath: paths?.imageAdult ?? "",
        outputPath: paths?.videoAdult ?? "",
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

  const handleScan = async (pairId: string) => {
    const pair = folderPairs.find((p) => p.id === pairId);
    if (!pair?.inputPath) {
      setError("폴더 경로를 입력하세요");
      return;
    }

    setFolderPairs((prev) =>
      prev.map((p) => (p.id === pairId ? { ...p, isScanning: true } : p)),
    );
    setError(null);
    addLog(`폴더 스캔 시작: ${pair.inputPath}`);

    try {
      const result = await batchV2Client.scanFolder(pair.inputPath, pair.outputPath);
      setFolderPairs((prev) =>
        prev.map((p) =>
          p.id === pairId
            ? { ...p, scannedImages: result.images, isScanning: false }
            : p,
        ),
      );
      const counts = countImageTasks(result.images);
      addLog(
        `✅ 이미지 ${result.count}개 · 생성 ${counts.pending} · 스킵 ${counts.skipped} (MiniMax 담당 ${counts.minimaxOwned}) (${pair.inputPath})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "스캔 실패";
      setError(msg);
      addLog(`❌ 스캔 실패: ${msg}`);
      setFolderPairs((prev) =>
        prev.map((p) => (p.id === pairId ? { ...p, isScanning: false } : p)),
      );
    }
  };

  const handlePreferMinimaxChange = async (checked: boolean) => {
    setPreferMinimax(checked);
    try {
      const saved = await batchClient.updateBatchVideoSettings({
        preferMinimax: checked,
      });
      setPreferMinimax(saved.preferMinimax);
      const pairsToRescan = folderPairs.filter(
        (pair) => pair.inputPath && pair.scannedImages.length > 0,
      );
      for (const pair of pairsToRescan) {
        await handleScan(pair.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "설정 저장 실패");
    }
  };

  const handleStart = async () => {
    if (!workspaceReady) {
      setError("상단에서 작업 공간(캐릭터·스팟)을 선택하세요.");
      return;
    }
    for (const pair of folderPairs) {
      if (!pair.inputPath || !pair.outputPath) {
        setError("입력/출력 경로가 비어 있습니다.");
        return;
      }
    }
    if (!prefixPrompt) {
      setError("접두 프롬프트를 입력하세요");
      return;
    }

    setLoading(true);
    setError(null);
    addLog(`📦 ${folderPairs.length}개 WAN ${wanVersion} 작업을 큐에 추가`);

    try {
      for (let i = 0; i < folderPairs.length; i++) {
        const pair = folderPairs[i];
        const result = await batchV2Client.startBatch(
          pair.inputPath,
          pair.outputPath,
          prefixPrompt,
          wanVersion,
        );
        setJobs((prev) => [...prev, result.job]);
        addLog(
          `✅ [${i + 1}/${folderPairs.length}] ${result.jobId.slice(0, 8)}… (${pair.inputPath})`,
        );
      }
      await fetchJobs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "시작 실패";
      setError(msg);
      addLog(`❌ ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    if (!currentJob) return;
    setLoading(true);
    try {
      await batchV2Client.pauseBatch(currentJob.id);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "일시정지 실패");
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    if (!currentJob) return;
    setLoading(true);
    try {
      await batchV2Client.resumeBatch(currentJob.id);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "재시작 실패");
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (jobId?: string) => {
    const targetId = jobId ?? currentJob?.id;
    if (!targetId) return;
    if (!window.confirm("정말로 배치 작업을 중지하시겠습니까?")) return;
    setLoading(true);
    try {
      await batchV2Client.stopBatch(targetId);
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "중지 실패");
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return hours > 0 ? `약 ${hours}시간 ${minutes}분` : `약 ${minutes}분`;
  };

  const estimatedTimeRemaining = () => {
    if (!progress.overallProgress) return "계산 중...";
    const total = progress.totalVideos || progress.totalImages;
    const completed = progress.currentVideoIndex || progress.currentImageIndex;
    const remaining = Math.max(0, total - completed);
    return formatDuration(remaining * AVG_SECONDS_PER_VIDEO);
  };

  return (
    <div className="batch-processor">
      <header className="batch-header">
        <h1>🎬 Batch Video Generator V2</h1>
        <p>WAN Spicy API (MuleRouter) · 단일 이미지 I2V · 출력 .mp4</p>
        <p className="form-hint" style={{ marginTop: "4px" }}>
          resolution / duration / prompt_extend 은 서버 <code>backend/.env</code> 설정
          (버전별 <code>WAN27_*</code> / <code>WAN22_*</code>)을 사용합니다.
        </p>
        <PresetPicker
          onLoad={handlePresetLoad}
          getCurrentSettings={getCurrentSettingsForPreset}
          preferredPresetName={workspacePresetName}
          autoLoadOnPreferredChange
        />
        <div className="connection-status">
          {isConnected ? (
            <span className="status-connected">🟢 연결됨</span>
          ) : (
            <span className="status-disconnected">🔴 연결 끊김</span>
          )}
        </div>
      </header>

      <div className="batch-container">
        <div className="config-section">
          <h2>설정</h2>

          <div className="form-group">
            <span>WAN 모델 버전</span>
            <div className="preset-outfit-mode" style={{ marginTop: "8px" }}>
              <label className="preset-outfit-radio">
                <input
                  type="radio"
                  name="batchV2WanVersion"
                  checked={wanVersion === "json"}
                  onChange={() => setWanVersion("json")}
                  disabled={loading}
                />
                Json setting
              </label>
              <label className="preset-outfit-radio">
                <input
                  type="radio"
                  name="batchV2WanVersion"
                  checked={wanVersion === "2.2"}
                  onChange={() => setWanVersion("2.2")}
                  disabled={loading}
                />
                WAN 2.2 Spicy
              </label>
              <label className="preset-outfit-radio">
                <input
                  type="radio"
                  name="batchV2WanVersion"
                  checked={wanVersion === "2.7"}
                  onChange={() => setWanVersion("2.7")}
                  disabled={loading}
                />
                WAN 2.7 Spicy
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={preferMinimax}
                onChange={(e) => void handlePreferMinimaxChange(e.target.checked)}
                disabled={loading}
                className="toggle-checkbox"
              />
              <span className="toggle-text">
                MiniMax 우선 생성 ({preferMinimax ? "ON" : "OFF"})
              </span>
              <div className="toggle-description">
                {preferMinimax
                  ? "minimax prompt.json 포즈는 V1 MiniMax 담당으로 스킵합니다"
                  : "모든 포즈를 WAN으로 생성합니다"}
              </div>
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="prefix-prompt-v2">접두 프롬프트 (캐릭터 설명)</label>
            <textarea
              id="prefix-prompt-v2"
              value={prefixPrompt}
              onChange={(e) => setPrefixPrompt(e.target.value)}
              rows={3}
              placeholder="1girl, long hair, blue eyes, school uniform"
              disabled={loading}
            />
          </div>

          <div className="folder-pairs-section">
            <div className="section-header">
              <h3>폴더 설정</h3>
              <button onClick={addFolderPair} disabled={loading} className="btn-add">
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
                  <label>Input (성인용 이미지)</label>
                  <div className="ib-readonly-path" title={pair.inputPath}>
                    {pair.inputPath || "작업 공간 선택 필요"}
                  </div>
                </div>
                <div className="form-group">
                  <label>Output (성인용 영상 · .mp4)</label>
                  <div className="ib-readonly-path" title={pair.outputPath}>
                    {pair.outputPath || "작업 공간 선택 필요"}
                  </div>
                </div>
                <button
                  onClick={() => handleScan(pair.id)}
                  disabled={pair.isScanning || loading || !pair.inputPath}
                  className="btn-scan"
                >
                  {pair.isScanning ? "스캔 중..." : "📂 스캔"}
                </button>
                {pair.scannedImages.length > 0 && (
                  <div className="scan-results-mini">
                    <p>✅ {pair.scannedImages.length}개 이미지</p>
                    <p>
                      {(() => {
                        const counts = countImageTasks(pair.scannedImages);
                        return `📹 생성 ${counts.pending} · 스킵 ${counts.skipped} (MiniMax 담당 ${counts.minimaxOwned})`;
                      })()}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="button-group-main">
            <button
              onClick={handleStart}
              disabled={
                loading ||
                !workspaceReady ||
                !prefixPrompt ||
                folderPairs.some((p) => !p.inputPath || !p.outputPath)
              }
              className="btn-primary btn-large"
            >
              {loading ? "추가 중…" : "▶️ 작업 큐에 추가"}
            </button>
          </div>
        </div>

        {jobs.length > 0 && (
          <div className="config-section job-list-section">
            <h2>작업 목록</h2>
            <ul className="batch-job-list">
              {jobs
                .slice()
                .reverse()
                .slice(0, 30)
                .map((j) => (
                  <li key={j.id} className={`batch-job-item batch-job-${j.status}`}>
                    <span className="batch-job-id">{j.id.slice(0, 8)}…</span>
                    <span className={`badge badge-${j.status}`}>{j.status}</span>
                    <span className="batch-job-meta">
                      {j.currentImageIndex}/{j.totalImages} · {j.currentVideoIndex}/{j.totalVideos}
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

        {currentJob && (
          <div className="control-section">
            <h2>컨트롤</h2>
            <div className="button-group">
              {currentJob.status === "running" && (
                <button onClick={handlePause} disabled={loading} className="btn-warning">
                  ⏸️ 일시정지
                </button>
              )}
              {currentJob.status === "paused" && (
                <button onClick={handleResume} disabled={loading} className="btn-success">
                  ▶️ 재시작
                </button>
              )}
              {(currentJob.status === "running" || currentJob.status === "paused") && (
                <button onClick={() => handleStop()} disabled={loading} className="btn-danger">
                  ⏹️ 중지
                </button>
              )}
            </div>
          </div>
        )}

        {progress.jobId && (
          <div className="progress-section">
            <h2>진행 상황</h2>
            <div className="progress-info">
              <div className="info-row">
                <span>현재 이미지:</span>
                <span>
                  {progress.currentImage} ({progress.currentImageIndex}/{progress.totalImages})
                </span>
              </div>
              <div className="info-row">
                <span>현재 영상:</span>
                <span>
                  {progress.currentVideoIndex}/{progress.totalVideos || progress.totalImages}
                </span>
              </div>
              <div className="info-row">
                <span>전체 진행률:</span>
                <span>{progress.overallProgress}%</span>
              </div>
              <div className="info-row">
                <span>예상 남은 시간:</span>
                <span>{estimatedTimeRemaining()}</span>
              </div>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar" style={{ width: `${progress.overallProgress}%` }}>
                {progress.overallProgress > 10 && (
                  <span className="progress-text">{progress.overallProgress}%</span>
                )}
              </div>
            </div>
          </div>
        )}

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

        {logs.length > 0 && (
          <div className="logs-section">
            <div className="logs-header">
              <h2>로그</h2>
              <button onClick={() => setLogs([])} className="btn-small">
                지우기
              </button>
            </div>
            <div className="logs-container">
              {logs.map((log, i) => (
                <div key={i} className="log-entry">
                  {log}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
