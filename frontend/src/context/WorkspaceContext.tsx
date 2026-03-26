import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  workspaceClient,
  type ResolvedWorkspacePaths,
} from "../api/workspace-client";

const STORAGE_KEY = "auto-comfy-workspace-v1";

interface Stored {
  character: string;
  spot: string;
}

interface WorkspaceContextValue {
  character: string;
  spot: string;
  setCharacter: (c: string) => void;
  setSpot: (s: string) => void;
  /** Resolved paths; null if not loaded or invalid */
  paths: ResolvedWorkspacePaths | null;
  resolveError: string | null;
  refreshPaths: () => Promise<void>;
  characterOptions: string[];
  spotOptions: string[];
  loadingLists: boolean;
  workspaceReady: boolean;
  reloadCharacterList: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { character: "", spot: "" };
    const p = JSON.parse(raw) as Partial<Stored>;
    return {
      character: typeof p.character === "string" ? p.character : "",
      spot: typeof p.spot === "string" ? p.spot : "",
    };
  } catch {
    return { character: "", spot: "" };
  }
}

function saveStored(c: string, s: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ character: c, spot: s }));
  } catch {
    /* ignore */
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [character, setCharacterState] = useState("");
  const [spot, setSpotState] = useState("");
  const [paths, setPaths] = useState<ResolvedWorkspacePaths | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [characterOptions, setCharacterOptions] = useState<string[]>([]);
  const [spotOptions, setSpotOptions] = useState<string[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);

  useEffect(() => {
    const s = loadStored();
    setCharacterState(s.character);
    setSpotState(s.spot);
  }, []);

  const setCharacter = useCallback((c: string) => {
    setCharacterState(c);
    setSpotState("");
    saveStored(c, "");
    setPaths(null);
    setResolveError(null);
  }, []);

  const setSpot = useCallback((s: string) => {
    setSpotState(s);
    saveStored(character, s);
    setPaths(null);
    setResolveError(null);
  }, [character]);

  const refreshPaths = useCallback(async () => {
    if (!character.trim() || !spot.trim()) {
      setPaths(null);
      setResolveError(null);
      return;
    }
    try {
      const p = await workspaceClient.resolve(character.trim(), spot.trim());
      setPaths(p);
      setResolveError(null);
    } catch (e: unknown) {
      setPaths(null);
      setResolveError(e instanceof Error ? e.message : String(e));
    }
  }, [character, spot]);

  useEffect(() => {
    refreshPaths();
  }, [refreshPaths]);

  const reloadCharacterList = useCallback(async () => {
    setLoadingLists(true);
    try {
      const chars = await workspaceClient.listCharacters();
      setCharacterOptions(chars);
    } catch {
      setCharacterOptions([]);
    } finally {
      setLoadingLists(false);
    }
  }, []);

  useEffect(() => {
    reloadCharacterList();
  }, [reloadCharacterList]);

  useEffect(() => {
    if (!character.trim()) {
      setSpotOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const spots = await workspaceClient.listSpots(character.trim());
        if (!cancelled) setSpotOptions(spots);
      } catch {
        if (!cancelled) setSpotOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [character]);

  const workspaceReady = Boolean(paths && !resolveError);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
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
      reloadCharacterList,
    }),
    [
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
      reloadCharacterList,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
