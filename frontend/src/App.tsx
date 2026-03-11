import { useState, useEffect, useCallback } from "react";
import BatchProcessor from "./components/BatchProcessor";
import EmotionBatchProcessor from "./components/EmotionBatchProcessor";
import ImageBatchProcessor from "./components/ImageBatchProcessor";
import BannerProcessor from "./components/BannerProcessor";
import EmotionPipeline from "./components/EmotionPipeline";
import { comfyClient, type ComfyInstanceInfo } from "./api/comfy-client";
import "./App.css";

function PodManager() {
  const [instances, setInstances] = useState<ComfyInstanceInfo[]>([]);
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

  useEffect(() => { refresh(); }, [refresh]);

  const handleAdd = async () => {
    if (!newUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await comfyClient.addInstance(newUrl.trim(), newName.trim() || undefined);
      setNewUrl("");
      setNewName("");
      await refresh();
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pod-manager">
      <button
        className="pod-manager-toggle"
        onClick={() => setOpen(!open)}
      >
        Pod 관리 ({instances.length}개) {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="pod-manager-panel">
          <div className="pod-list">
            {instances.map((inst) => (
              <div key={inst.id} className="pod-item">
                <span className="pod-info">
                  <strong>{inst.name}</strong> ({inst.id}) — {inst.url}
                </span>
                <button
                  className="pod-remove-btn"
                  onClick={() => handleRemove(inst.id)}
                  disabled={busy}
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
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
    "batch" | "emotion" | "imageBatch" | "banner" | "emotionPipeline"
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
            className={`nav-tab ${activeTab === "batch" ? "active" : ""}`}
            onClick={() => setActiveTab("batch")}
          >
            성인용 영상 자동화
          </button>
          <button
            className={`nav-tab ${activeTab === "emotion" ? "active" : ""}`}
            onClick={() => setActiveTab("emotion")}
          >
            idle/speaknatural 자동화
          </button>
          <button
            className={`nav-tab ${activeTab === "emotionPipeline" ? "active" : ""}`}
            onClick={() => setActiveTab("emotionPipeline")}
          >
            마스킹 + 인페인팅
          </button>
        </div>
        <PodManager />
      </nav>

      <main className="app-main">
        {activeTab === "imageBatch" && <ImageBatchProcessor />}
        {activeTab === "banner" && <BannerProcessor />}
        {activeTab === "batch" && <BatchProcessor />}
        {activeTab === "emotion" && <EmotionBatchProcessor />}
        {activeTab === "emotionPipeline" && <EmotionPipeline />}
      </main>
    </div>
  );
}

export default App;
