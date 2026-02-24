import { useState } from "react";
import ComfyDemo from "./components/ComfyDemo";
import BatchProcessor from "./components/BatchProcessor";
import EmotionBatchProcessor from "./components/EmotionBatchProcessor";
import ImageBatchProcessor from "./components/ImageBatchProcessor";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState<
    "single" | "batch" | "emotion" | "imageBatch"
  >("single");

  return (
    <div className="app-container">
      <nav className="app-nav">
        <button
          className={`nav-tab ${activeTab === "single" ? "active" : ""}`}
          onClick={() => setActiveTab("single")}
        >
          Image Generation
        </button>
        <button
          className={`nav-tab ${activeTab === "imageBatch" ? "active" : ""}`}
          onClick={() => setActiveTab("imageBatch")}
        >
          Image Batch
        </button>
        <button
          className={`nav-tab ${activeTab === "batch" ? "active" : ""}`}
          onClick={() => setActiveTab("batch")}
        >
          Batch Processing
        </button>
        <button
          className={`nav-tab ${activeTab === "emotion" ? "active" : ""}`}
          onClick={() => setActiveTab("emotion")}
        >
          Emotion Videos
        </button>
      </nav>

      <main className="app-main">
        {activeTab === "single" && <ComfyDemo />}
        {activeTab === "imageBatch" && <ImageBatchProcessor />}
        {activeTab === "batch" && <BatchProcessor />}
        {activeTab === "emotion" && <EmotionBatchProcessor />}
      </main>
    </div>
  );
}

export default App;
