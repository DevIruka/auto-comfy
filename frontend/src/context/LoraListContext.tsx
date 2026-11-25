import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { comfyClient } from "../api/comfy-client";

interface LoraListContextValue {
  getLoras: (instanceId: string) => string[];
  isLoading: (instanceId: string) => boolean;
  hasCache: (instanceId: string) => boolean;
  getError: (instanceId: string) => string | null;
  ensureLoras: (instanceId: string) => Promise<string[]>;
  refreshLoras: (instanceId: string) => Promise<string[]>;
}

const LoraListContext = createContext<LoraListContextValue | null>(null);

export function LoraListProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const inflight = useRef<Map<string, Promise<string[]>>>(new Map());

  const fetchLoras = useCallback(
    async (instanceId: string, force: boolean): Promise<string[]> => {
      if (!instanceId) return [];
      if (!force && cacheRef.current[instanceId]) {
        return cacheRef.current[instanceId];
      }
      const pending = inflight.current.get(instanceId);
      if (pending) return pending;

      setLoading((prev) => ({ ...prev, [instanceId]: true }));
      const request = comfyClient
        .getLoraList(instanceId)
        .then((names) => {
          setCache((prev) => ({ ...prev, [instanceId]: names }));
          setErrors((prev) => {
            const next = { ...prev };
            delete next[instanceId];
            return next;
          });
          return names;
        })
        .catch((err) => {
          const message =
            err instanceof Error ? err.message : "LoRA 목록을 불러오지 못했습니다";
          setErrors((prev) => ({ ...prev, [instanceId]: message }));
          throw err;
        })
        .finally(() => {
          inflight.current.delete(instanceId);
          setLoading((prev) => {
            const next = { ...prev };
            delete next[instanceId];
            return next;
          });
        });
      inflight.current.set(instanceId, request);
      return request;
    },
    [],
  );

  const getLoras = useCallback(
    (instanceId: string) => cache[instanceId] ?? [],
    [cache],
  );
  const isLoading = useCallback(
    (instanceId: string) => Boolean(loading[instanceId]),
    [loading],
  );
  const hasCache = useCallback(
    (instanceId: string) => Object.prototype.hasOwnProperty.call(cache, instanceId),
    [cache],
  );
  const getError = useCallback(
    (instanceId: string) => errors[instanceId] ?? null,
    [errors],
  );
  const ensureLoras = useCallback(
    (instanceId: string) => fetchLoras(instanceId, false),
    [fetchLoras],
  );
  const refreshLoras = useCallback(
    (instanceId: string) => fetchLoras(instanceId, true),
    [fetchLoras],
  );

  const value = useMemo(
    () => ({ getLoras, isLoading, hasCache, getError, ensureLoras, refreshLoras }),
    [getLoras, isLoading, hasCache, getError, ensureLoras, refreshLoras],
  );

  return (
    <LoraListContext.Provider value={value}>{children}</LoraListContext.Provider>
  );
}

export function useLoraList() {
  const ctx = useContext(LoraListContext);
  if (!ctx) {
    throw new Error("useLoraList must be used within LoraListProvider");
  }
  return ctx;
}

/** Subscribe to cached LoRAs for one instance; fetch only on cache miss. */
export function useInstanceLoras(instanceId: string) {
  const { getLoras, isLoading, hasCache, getError, ensureLoras, refreshLoras } =
    useLoraList();

  useEffect(() => {
    if (!instanceId) return;
    void ensureLoras(instanceId).catch(console.error);
  }, [instanceId, ensureLoras]);

  return {
    loraList: instanceId ? getLoras(instanceId) : [],
    loadingLoras: instanceId ? isLoading(instanceId) : false,
    listReady: instanceId ? hasCache(instanceId) : false,
    listError: instanceId
      ? getError(instanceId)
      : "Pod가 연결되지 않았습니다",
    refreshLoras: () =>
      instanceId
        ? refreshLoras(instanceId).catch(console.error)
        : Promise.resolve(),
  };
}
