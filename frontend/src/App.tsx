import { useState, useEffect, useCallback } from "react";
import BatchProcessor from "./components/BatchProcessor";
import ImageBatchProcessor from "./components/ImageBatchProcessor";
import BannerProcessor from "./components/BannerProcessor";
import AnchorImageProcessor from "./components/AnchorImageProcessor";
import EmotionPipeline from "./components/EmotionPipeline";
import WorkspaceSelector from "./components/WorkspaceSelector";
import WorkspaceFolderPanel from "./components/WorkspaceFolderPanel";
import { comfyClient, type ComfyInstanceInfo } from "./api/comfy-client";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3002";

interface DashboardEntry {
  entryId: string;
  jobId: string;
  serviceType: string;
  label: string;
  createdAt: string;
}

interface DashboardInstance extends ComfyInstanceInfo {
  running: DashboardEntry | null;
  pending: DashboardEntry[];
}

const SERVICE_LABELS: Record<string, string> = {
  "image-batch": "이미지",
  "banner-batch": "배너",
  "anchor-image": "앵커 이미지",
  batch: "영상",
  "emotion-batch": "감정 영상",
  "emotion-pipeline": "마스킹+인페인팅",
};

function PodManager() {
  const [instances, setInstances] = useState<ComfyInstanceInfo[]>([]);
  const [dashboard, setDashboard] = useState<DashboardInstance[]>([]);
  const [open, setOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await comfyClient.getComfyInstances();
      setInstances(list);
    } catch { /* ignore */ }
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/comfy-instances/dashboard`);
      const data = await res.json();
      if (data.success) setDashboard(data.dashboard);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    fetchDashboard();
  }, [refresh, fetchDashboard]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(fetchDashboard, 5000);
    return () => clearInterval(t);
  }, [open, fetchDashboard]);

  const handleAdd = async () => {
    if (!newUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await comfyClient.addInstance(newUrl.trim(), newName.trim() || undefined);
      setNewUrl("");
      setNewName("");
      await refresh();
      await fetchDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm(`인스턴스 ${id}를 삭제하시겠습니까?`)) return;
    setBusy(true);
    setError(null);
    try {
      await comfyClient.removeInstance(id);
      await refresh();
      await fetchDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleCancelEntry = async (entryId: string) => {
    try {
      await fetch(`${API_BASE}/api/comfy-instances/dashboard/cancel/${entryId}`, {
        method: "POST",
      });
      await fetchDashboard();
    } catch { /* ignore */ }
  };

  const handleStopJob = async (serviceType: string, jobId: string) => {
    try {
      await fetch(`${API_BASE}/api/comfy-instances/dashboard/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceType, jobId }),
      });
      await fetchDashboard();
    } catch { /* ignore */ }
  };

  const totalRunning = dashboard.filter((d) => d.running).length;
  const totalPending = dashboard.reduce((sum, d) => sum + d.pending.length, 0);

  return (
    <div className="pod-manager">
      <button
        className="pod-manager-toggle"
        onClick={() => setOpen(!open)}
      >
        Pod Dashboard ({instances.length}개
        {totalRunning > 0 && ` / 실행 ${totalRunning}`}
        {totalPending > 0 && ` / 대기 ${totalPending}`}
        ) {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="pod-manager-panel">
          {/* Dashboard: per-instance queue status */}
          <div className="dashboard-section">
            {dashboard.map((inst) => (
              <div
                key={inst.id}
                className={`dashboard-instance ${inst.running ? "active" : "idle"}`}
              >
                <div className="dashboard-instance-header">
                  <span className="dashboard-instance-name">
                    <strong>{inst.name}</strong> ({inst.id})
                  </span>
                  <span className="dashboard-instance-url">{inst.url}</span>
                  <button
                    className="pod-remove-btn"
                    onClick={() => handleRemove(inst.id)}
                    disabled={busy}
                    title="삭제"
                  >
                    ✕
                  </button>
                </div>
                <div className="dashboard-jobs">
                  {inst.running ? (
                    <div className="dashboard-job running">
                      <span className="dashboard-job-badge running">Running</span>
                      <span className="dashboard-job-type">
                        {SERVICE_LABELS[inst.running.serviceType] ?? inst.running.serviceType}
                      </span>
                      <span className="dashboard-job-label">{inst.running.label}</span>
                      <button
                        className="dashboard-stop-btn"
                        onClick={() =>
                          handleStopJob(inst.running!.serviceType, inst.running!.jobId)
                        }
                      >
                        정지
                      </button>
                    </div>
                  ) : (
                    <div className="dashboard-job idle">
                      <span className="dashboard-job-badge idle-badge">Idle</span>
                      <span className="dashboard-job-label">대기 중</span>
                    </div>
                  )}
                  {inst.pending.map((entry) => (
                    <div key={entry.entryId} className="dashboard-job pending">
                      <span className="dashboard-job-badge pending-badge">Pending</span>
                      <span className="dashboard-job-type">
                        {SERVICE_LABELS[entry.serviceType] ?? entry.serviceType}
                      </span>
                      <span className="dashboard-job-label">{entry.label}</span>
                      <button
                        className="dashboard-cancel-btn"
                        onClick={() => handleCancelEntry(entry.entryId)}
                      >
                        취소
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Add new pod form */}
          <div className="pod-add-form">
            <input
              type="text"
              placeholder="ComfyUI URL (https://...)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={busy}
              className="pod-input"
            />
            <input
              type="text"
              placeholder="이름 (선택)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy}
              className="pod-input pod-input-name"
            />
            <button onClick={handleAdd} disabled={busy || !newUrl.trim()} className="pod-add-btn">
              {busy ? "..." : "추가"}
            </button>
          </div>
          {error && <div className="pod-error">{error}</div>}
        </div>
      )}
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<
    "batch" | "imageBatch" | "banner" | "anchor" | "emotionPipeline"
  >("imageBatch");

  return (
    <div className="app-container">
      <nav className="app-nav">
        <div className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === "imageBatch" ? "active" : ""}`}
            onClick={() => setActiveTab("imageBatch")}
          >
            성인용 이미지 자동화
          </button>
          <button
            className={`nav-tab ${activeTab === "banner" ? "active" : ""}`}
            onClick={() => setActiveTab("banner")}
          >
            썸네일 및 배너 이미지
          </button>
          <button
            className={`nav-tab ${activeTab === "anchor" ? "active" : ""}`}
            onClick={() => setActiveTab("anchor")}
          >
            앵커 이미지 제작
          </button>
          <button
            className={`nav-tab ${activeTab === "batch" ? "active" : ""}`}
            onClick={() => setActiveTab("batch")}
          >
            성인용 영상 자동화
          </button>
          <button
            className={`nav-tab ${activeTab === "emotionPipeline" ? "active" : ""}`}
            onClick={() => setActiveTab("emotionPipeline")}
          >
            마스킹 + 인페인팅
          </button>
        </div>
        <div className="app-nav-tools">
          <WorkspaceSelector />
          <WorkspaceFolderPanel />
          <PodManager />
        </div>
      </nav>

      <main className="app-main">
        {activeTab === "imageBatch" && <ImageBatchProcessor />}
        {activeTab === "banner" && <BannerProcessor />}
        {activeTab === "anchor" && <AnchorImageProcessor />}
        {activeTab === "batch" && <BatchProcessor />}
        {activeTab === "emotionPipeline" && <EmotionPipeline />}
      </main>
    </div>
  );
}

export default App;
