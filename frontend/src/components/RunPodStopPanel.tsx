import { useCallback, useEffect, useState } from "react";
import { comfyClient, type ComfyInstanceInfo } from "../api/comfy-client";
import {
  runPodStopClient,
  type RunPodStopJob,
} from "../api/runpod-stop-client";
import "./BatchProcessor.css";

const STATUS_LABELS: Record<RunPodStopJob["status"], string> = {
  pending: "대기 중",
  running: "실행 중",
  completed: "종료 완료",
  failed: "실패",
  skipped: "건너뜀",
};

export default function RunPodStopPanel() {
  const [instances, setInstances] = useState<ComfyInstanceInfo[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>("");
  const [podIdOverride, setPodIdOverride] = useState<string>("");
  const [shutdownPc, setShutdownPc] = useState(false);
  const [jobs, setJobs] = useState<RunPodStopJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = instances.find((i) => i.id === selectedInstance);

  const refreshInstances = useCallback(async () => {
    try {
      const list = await comfyClient.getComfyInstances();
      setInstances(list);
      setSelectedInstance((prev) => prev || list[0]?.id || "");
    } catch {
      /* ignore */
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const list = await runPodStopClient.getJobs();
      setJobs(list);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshInstances();
    refreshJobs();
  }, [refreshInstances, refreshJobs]);

  useEffect(() => {
    const t = setInterval(refreshJobs, 5000);
    return () => clearInterval(t);
  }, [refreshJobs]);

  const handleSchedule = async () => {
    if (!selectedInstance) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runPodStopClient.scheduleStop(
        selectedInstance,
        podIdOverride.trim() || undefined,
        shutdownPc,
      );
      const queuedMsg =
        result.queued === "running"
          ? "인스턴스가 비어 있어 종료를 즉시 실행합니다."
          : "종료가 큐에 예약되었습니다. 앞선 작업이 끝나면 실행됩니다.";
      setNotice(
        shutdownPc
          ? `${queuedMsg} Pod 종료가 성공하면 5분 뒤 이 PC가 꺼집니다. 취소: shutdown /a`
          : queuedMsg,
      );
      setPodIdOverride("");
      await refreshJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "종료 예약 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="batch-processor">
      <h2>RunPod 종료 예약</h2>
      <p style={{ color: "#888", marginTop: -8 }}>
        선택한 ComfyUI 인스턴스의 작업 큐에 RunPod 종료를 예약합니다. 해당 인스턴스의
        남은 작업이 끝난 뒤 Pod가 종료됩니다. Pod Dashboard의 Pending에서 취소할 수 있습니다.
      </p>

      <div className="form-group">
        <label>ComfyUI 인스턴스</label>
        <select
          value={selectedInstance}
          onChange={(e) => setSelectedInstance(e.target.value)}
          disabled={busy}
        >
          {instances.length === 0 && <option value="">인스턴스 없음</option>}
          {instances.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.name} ({inst.id})
              {inst.connectionType === "ssh-tunnel" ? " [SSH]" : ""}
            </option>
          ))}
        </select>
        {selected && (
          <div style={{ color: "#888", fontSize: 12, marginTop: 6 }}>
            <div>URL: {selected.url}</div>
            <div>
              Pod ID: {selected.podId || "(자동 확인 불가 - 아래에 직접 입력)"}
            </div>
            {selected.connectionType === "ssh-tunnel" && selected.sshTarget && (
              <div>SSH: {selected.sshTarget}</div>
            )}
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Pod ID 직접 입력 (선택)</label>
        <input
          type="text"
          value={podIdOverride}
          onChange={(e) => setPodIdOverride(e.target.value)}
          placeholder="비워두면 인스턴스 정보의 Pod ID 사용"
          disabled={busy}
        />
      </div>

      <div className="form-group">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={shutdownPc}
            onChange={(e) => setShutdownPc(e.target.checked)}
            disabled={busy}
            className="toggle-checkbox"
          />
          <span className="toggle-text">
            컴퓨터 자동 종료 ({shutdownPc ? "ON" : "OFF"})
          </span>
          <div className="toggle-description">
            {shutdownPc
              ? "✅ 종료 요청이 성공하면 5분 뒤 이 PC가 꺼집니다. 취소: shutdown /a"
              : "PC는 끄지 않고 RunPod만 종료합니다"}
          </div>
        </label>
      </div>

      <div className="form-group">
        <button
          onClick={handleSchedule}
          disabled={busy || !selectedInstance}
          className="btn-primary"
        >
          {busy ? "예약 중..." : "🛑 큐에 종료 예약"}
        </button>
      </div>

      {notice && (
        <div style={{ color: "#2563eb", marginTop: 4 }}>{notice}</div>
      )}
      {error && <div style={{ color: "#dc2626", marginTop: 4 }}>{error}</div>}

      <div className="form-group" style={{ marginTop: 20 }}>
        <label>최근 종료 예약</label>
        {jobs.length === 0 ? (
          <div style={{ color: "#888", fontSize: 13 }}>예약 내역이 없습니다.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {jobs.map((job) => (
              <div
                key={job.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 13,
                }}
              >
                <strong>{STATUS_LABELS[job.status]}</strong> · pod {job.podId} ·{" "}
                {job.instanceId}
                {job.logs.length > 0 && (
                  <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>
                    {job.logs[job.logs.length - 1]}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
