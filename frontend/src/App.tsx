import { useState } from "react";
import ComfyDemo from "./components/ComfyDemo";
import BatchProcessor from "./components/BatchProcessor";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single");

  return (
    <div className="app-container">
      <nav className="app-nav">
        <button
          className={`nav-tab ${activeTab === "single" ? "active" : ""}`}
          onClick={() => setActiveTab("single")}
        >
          🎨 Single Generation
        </button>
        <button
          className={`nav-tab ${activeTab === "batch" ? "active" : ""}`}
          onClick={() => setActiveTab("batch")}
        >
          🎬 Batch Processing
        </button>
      </nav>

      <main className="app-main">
        {activeTab === "single" && <ComfyDemo />}
        {activeTab === "batch" && <BatchProcessor />}
      </main>
    </div>
  );
}

export default App;
