import { useEffect, useRef, useState } from "react";
import {
  happyHorseClient,
  type HappyHorseJob,
  type HappyHorseResolution,
} from "../api/happyhorse-client";
import "./BatchProcessor.css";

const POLL_INTERVAL_MS = 5000;

export default function HappyHorseProcessor() {
  const [imageDataUri, setImageDataUri] = useState<string>("");
  const [imageName, setImageName] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [negativePrompt, setNegativePrompt] = useState<string>("");
  const [resolution, setResolution] = useState<HappyHorseResolution>("1080P");
  const [duration, setDuration] = useState<number>(5);
  const [promptExtend, setPromptExtend] = useState<boolean>(true);

  const [job, setJob] = useState<HappyHorseJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("이미지는 최대 20MB까지 지원됩니다.");
      return;
    }
    setError(null);
    setImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => setImageDataUri(String(reader.result || ""));
    reader.onerror = () => setError("이미지 읽기에 실패했습니다.");
    reader.readAsDataURL(file);
  };

  const pollStatus = (jobId: string) => {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const latest = await happyHorseClient.getStatus(jobId);
        setJob(latest);
        if (latest.status === "completed" || latest.status === "failed") {
          stopPolling();
          setLoading(false);
        }
      } catch {
        /* transient; keep polling */
      }
    }, POLL_INTERVAL_MS);
  };

  const handleGenerate = async () => {
    if (!imageDataUri) {
      setError("이미지를 먼저 업로드해주세요.");
      return;
    }
    setError(null);
    setLoading(true);
    setJob(null);
    try {
      const { job: created } = await happyHorseClient.generate({
        imageDataUri,
        prompt: prompt.trim() || undefined,
        resolution,
        duration,
        promptExtend,
        negativePrompt: negativePrompt.trim() || undefined,
      });
      setJob(created);
      pollStatus(created.id);
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (e instanceof Error ? e.message : "생성 요청에 실패했습니다.");
      setError(msg);
      setLoading(false);
    }
  };

  const busy = loading || job?.status === "running" || job?.status === "pending";

  return (
    <div className="batch-processor">
      <h2>happyhorse 단일 영상 제작</h2>
      <p style={{ color: "#888", marginTop: -8 }}>
        이미지 1장을 업로드해 HappyHorse i2v로 단일 영상을 생성합니다. (콘텐츠 필터 비활성화됨)
      </p>

      <div className="form-group">
        <label>입력 이미지 (최대 20MB)</label>
        <input type="file" accept="image/*" onChange={handleFileChange} disabled={busy} />
        {imageDataUri && (
          <div style={{ marginTop: 8 }}>
            <img
              src={imageDataUri}
              alt={imageName}
              style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, display: "block" }}
            />
            <span style={{ color: "#888", fontSize: 12 }}>{imageName}</span>
          </div>
        )}
      </div>

      <div className="form-group">
        <label>프롬프트 (선택)</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: A cat running on the grass"
          rows={3}
          disabled={busy}
        />
      </div>

      <div className="form-group">
        <label>네거티브 프롬프트 (선택)</label>
        <textarea
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder="예: low resolution, worst quality"
          rows={2}
          disabled={busy}
        />
      </div>

      <div className="form-group" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <label>해상도</label>
          <div style={{ display: "flex", gap: 12 }}>
            <label>
              <input
                type="radio"
                name="resolution"
                checked={resolution === "1080P"}
                onChange={() => setResolution("1080P")}
                disabled={busy}
              />{" "}
              1080P
            </label>
            <label>
              <input
                type="radio"
                name="resolution"
                checked={resolution === "720P"}
                onChange={() => setResolution("720P")}
                disabled={busy}
              />{" "}
              720P
            </label>
          </div>
        </div>

        <div>
          <label>길이 (초, 2~15)</label>
          <input
            type="number"
            min={2}
            max={15}
            value={duration}
            onChange={(e) =>
              setDuration(Math.min(15, Math.max(2, Number(e.target.value) || 5)))
            }
            disabled={busy}
            style={{ width: 80 }}
          />
        </div>

        <div>
          <label>프롬프트 확장</label>
          <div>
            <label>
              <input
                type="checkbox"
                checked={promptExtend}
                onChange={(e) => setPromptExtend(e.target.checked)}
                disabled={busy}
              />{" "}
              prompt_extend
            </label>
          </div>
        </div>
      </div>

      <button
        className="btn-primary"
        onClick={handleGenerate}
        disabled={busy || !imageDataUri}
      >
        {busy ? "생성 중..." : "영상 생성"}
      </button>

      {error && <div className="error-message" style={{ marginTop: 12 }}>{error}</div>}

      {job && (
        <div style={{ marginTop: 20 }}>
          <h3>상태: {job.status}</h3>
          {job.error && (
            <div className="error-message">{job.error}</div>
          )}
          {job.status === "completed" && job.videoUrl && (
            <div style={{ marginTop: 12 }}>
              <video
                controls
                src={job.videoUrl}
                style={{ maxWidth: "100%", borderRadius: 8 }}
              />
              <div style={{ marginTop: 8 }}>
                <a href={job.videoUrl} target="_blank" rel="noreferrer" download>
                  영상 다운로드 / 새 탭에서 열기
                </a>
                <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
                  링크는 24시간 동안만 유효합니다. 빠르게 저장해주세요.
                </div>
              </div>
            </div>
          )}
          {job.logs.length > 0 && (
            <pre
              style={{
                marginTop: 12,
                maxHeight: 200,
                overflow: "auto",
                background: "#1e1e1e",
                color: "#ddd",
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              {job.logs.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
