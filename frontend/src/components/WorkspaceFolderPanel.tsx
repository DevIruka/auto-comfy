import { useState } from "react";
import { workspaceClient } from "../api/workspace-client";
import { useWorkspace } from "../context/WorkspaceContext";

export default function WorkspaceFolderPanel() {
  const { reloadCharacterList } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [character, setCharacter] = useState("");
  const [spotCount, setSpotCount] = useState(1);
  const [spotNames, setSpotNames] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adjustSpots = (n: number) => {
    const next = Math.max(1, Math.min(20, n));
    setSpotCount(next);
    setSpotNames((prev) => {
      const arr = [...prev];
      while (arr.length < next) arr.push("");
      return arr.slice(0, next);
    });
  };

  const setSpotName = (i: number, v: string) => {
    setSpotNames((prev) => {
      const arr = [...prev];
      arr[i] = v;
      return arr;
    });
  };

  const handleCreate = async () => {
    setError(null);
    setMessage(null);
    const spots = spotNames.map((s) => s.trim()).filter(Boolean);
    if (!character.trim()) {
      setError("캐릭터 이름을 입력하세요.");
      return;
    }
    if (spots.length === 0) {
      setError("스팟 이름을 하나 이상 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      const data = await workspaceClient.createFolders(character.trim(), spots);
      setMessage(`${data.createdCount}개 폴더 생성 · 루트: ${data.root}`);
      await reloadCharacterList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-folder-panel">
      <button
        type="button"
        className="workspace-folder-toggle"
        onClick={() => setOpen(!open)}
      >
        폴더 구조 생성 {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="workspace-folder-dropdown">
          <p className="workspace-folder-hint">
            PROJECT_DRIVE_ROOT 아래에 캐릭터·배너·스팟 하위 폴더를 만듭니다.
          </p>
          <div className="workspace-folder-row">
            <label>캐릭터 이름</label>
            <input
              type="text"
              value={character}
              onChange={(e) => setCharacter(e.target.value)}
              placeholder="예: 아리나"
              disabled={busy}
            />
          </div>
          <div className="workspace-folder-row">
            <label>스팟 개수</label>
            <input
              type="number"
              min={1}
              max={20}
              value={spotCount}
              onChange={(e) => adjustSpots(parseInt(e.target.value, 10) || 1)}
              disabled={busy}
            />
          </div>
          {spotNames.map((name, i) => (
            <div key={i} className="workspace-folder-row">
              <label>스팟 {i + 1}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setSpotName(i, e.target.value)}
                placeholder={`예: spot ${i + 1} 학교 복도`}
                disabled={busy}
              />
            </div>
          ))}
          <button
            type="button"
            className="workspace-folder-submit"
            onClick={handleCreate}
            disabled={busy}
          >
            {busy ? "생성 중…" : "폴더 생성"}
          </button>
          {message && <div className="workspace-folder-msg">{message}</div>}
          {error && <div className="workspace-folder-err">{error}</div>}
        </div>
      )}
    </div>
  );
}
