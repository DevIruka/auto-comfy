import { useState, useRef } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3002";

export default function FaceMaskTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [soft, setSoft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    setFiles(list);
    setError(null);
    setSuccessMessage(null);
  };

  const handleSubmit = async () => {
    if (!files.length) {
      setError("이미지를 선택하거나 폴더를 선택하세요");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const form = new FormData();
      files.forEach((f) => form.append("images", f));
      const url = `${API_BASE}/api/tools/face-mask${soft ? "?soft=true" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        body: form,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || `HTTP ${res.status}`);
      }

      setSuccessMessage(data.message || `${data.count}장 처리 완료. output 폴더를 확인하세요.`);
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="facemask-tool">
      <header className="facemask-header">
        <h1>🎭 얼굴 마스킹</h1>
        <p>
          이미지에서 얼굴(피부·눈) 영역을 투명하게 만듭니다. 머리카락은 유지됩니다.
          폴더 또는 여러 이미지를 선택하면 한 번에 처리되며, 결과는 서버의 facemask/output 폴더에 저장됩니다.
        </p>
      </header>

      <div className="facemask-card">
        <div className="form-group">
          <label>이미지 / 폴더 선택</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp"
            multiple
            onChange={handleFileChange}
            disabled={loading}
          />
          <p className="file-hint">
            여러 이미지를 선택하면 한 번에 처리됩니다. (폴더 전체는 탐색기에서 Ctrl+A 후 드래그)
          </p>
          {files.length > 0 && (
            <p className="file-name">
              {files.length}개 파일 선택됨
              {files.length <= 10 &&
                ` — ${files.map((f) => f.name).join(", ")}`}
            </p>
          )}
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={soft}
              onChange={(e) => setSoft(e.target.checked)}
              disabled={loading}
            />
            <span>소프트 마스크 (경계 부드럽게)</span>
          </label>
        </div>

        <div className="button-row">
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading || !files.length}
          >
            {loading ? "처리 중…" : "마스킹 실행"}
          </button>
        </div>

        {error && (
          <div className="facemask-error">❌ {error}</div>
        )}

        {successMessage && (
          <div className="facemask-success">✅ {successMessage}</div>
        )}
      </div>
    </div>
  );
}
