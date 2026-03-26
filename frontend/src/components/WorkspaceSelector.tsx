import { useWorkspace } from "../context/WorkspaceContext";

export default function WorkspaceSelector() {
  const {
    character,
    spot,
    setCharacter,
    setSpot,
    paths,
    resolveError,
    refreshPaths,
    characterOptions,
    spotOptions,
    loadingLists,
    workspaceReady,
  } = useWorkspace();

  return (
    <div className="workspace-selector">
      <span className="workspace-selector-label">작업 공간</span>
      <select
        className="workspace-selector-select"
        value={character}
        onChange={(e) => setCharacter(e.target.value)}
        disabled={loadingLists}
      >
        <option value="">— 캐릭터 —</option>
        {characterOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="workspace-selector-sep">/</span>
      <select
        className="workspace-selector-select workspace-selector-spot"
        value={spot}
        onChange={(e) => setSpot(e.target.value)}
        disabled={!character.trim()}
      >
        <option value="">— 스팟 —</option>
        {spotOptions.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="workspace-selector-refresh"
        onClick={() => refreshPaths()}
        title="경로 다시 확인"
      >
        ↻
      </button>
      {workspaceReady && paths && (
        <span className="workspace-selector-ok" title={paths.spotPath}>
          경로 확인됨
        </span>
      )}
      {resolveError && (
        <span className="workspace-selector-err" title={resolveError}>
          경로 오류
        </span>
      )}
    </div>
  );
}
