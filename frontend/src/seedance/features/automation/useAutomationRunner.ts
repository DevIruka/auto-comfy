import { useCallback, useState } from "react";
import {
  fetchSeedanceQueues,
  postAutomationRun,
  postAutomationScan,
  postSeedanceQueueControl,
} from "../../services/seedanceApi";
import type {
  AutomationRunResult,
  AutomationScanResult,
  FolderPair,
} from "../../types/app";

interface UseAutomationRunnerParams {
  folderPairs: FolderPair[];
  outputRootPath: string;
  autoOutputByCharacter: boolean;
  addTrackedJobIds: (ids: string[]) => void;
  refreshAutomationProgress: (jobIds: string[]) => void | Promise<void>;
}

export function useAutomationRunner({
  folderPairs,
  outputRootPath,
  autoOutputByCharacter,
  addTrackedJobIds,
  refreshAutomationProgress,
}: UseAutomationRunnerParams) {
  const [automationRunning, setAutomationRunning] = useState(false);
  const [automationResult, setAutomationResult] =
    useState<AutomationRunResult | null>(null);
  const [scanResult, setScanResult] = useState<AutomationScanResult | null>(null);
  const [rowEndpointByIndex, setRowEndpointByIndex] = useState<Record<number, number>>({});
  const [rowPausedByIndex, setRowPausedByIndex] = useState<Record<number, boolean>>({});
  const [rowControlLoadingByIndex, setRowControlLoadingByIndex] = useState<
    Record<number, boolean>
  >({});

  const parseEndpoint = (value: FolderPair["endpointIndex"]): number | null => {
    const numeric = Number(value);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 3) {
      return numeric;
    }
    return null;
  };

  const runAutomationWithPairs = useCallback(
    async (selectedPairs: FolderPair[], selectedRowIndices: number[]) => {
      if (!selectedPairs.some((p) => p.inputPath.trim())) {
        setAutomationResult({
          success: false,
          error: "No runnable rows. Input path is required.",
        });
        return;
      }

      setAutomationRunning(true);
      setAutomationResult(null);
      try {
        const { ok, data } = await postAutomationRun({
          folderPairs: selectedPairs,
          prefixPrompt: "",
          outputRootPath,
          autoOutputByCharacter: autoOutputByCharacter || true,
          duration: 5,
          aspectRatio: "9:16",
          watermark: false,
        });
        setAutomationResult(data);

        if (Array.isArray(data.acceptedRows) && data.acceptedRows.length > 0) {
          setRowEndpointByIndex((prev) => {
            const next = { ...prev };
            for (const row of data.acceptedRows || []) {
              const endpoint = Number(row.endpoint);
              if (!Number.isInteger(endpoint) || endpoint < 1 || endpoint > 3) continue;
              const selectedIndex = selectedRowIndices[row.rowIndex] ?? row.rowIndex;
              next[selectedIndex] = endpoint;
            }
            return next;
          });
          setRowPausedByIndex((prev) => {
            const next = { ...prev };
            for (const row of data.acceptedRows || []) {
              const selectedIndex = selectedRowIndices[row.rowIndex] ?? row.rowIndex;
              next[selectedIndex] = false;
            }
            return next;
          });
        }

        const newJobIds = data.jobIds ?? [];
        if (data.success && newJobIds.length > 0) {
          addTrackedJobIds(newJobIds);
          await Promise.resolve(refreshAutomationProgress(newJobIds));
        }
        if (!ok) throw new Error(data.error || "run failed");
      } catch (e: unknown) {
        setAutomationResult({
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setAutomationRunning(false);
      }
    },
    [
      addTrackedJobIds,
      autoOutputByCharacter,
      outputRootPath,
      refreshAutomationProgress,
    ],
  );

  const handleAutomationRun = useCallback(async () => {
    await runAutomationWithPairs(
      folderPairs,
      folderPairs.map((_, index) => index),
    );
  }, [folderPairs, runAutomationWithPairs]);

  const handleAutomationRunRow = useCallback(async (rowIndex: number) => {
    const row = folderPairs[rowIndex];
    if (!row) return;
    await runAutomationWithPairs([row], [rowIndex]);
  }, [folderPairs, runAutomationWithPairs]);

  const handleToggleRowPause = useCallback(async (rowIndex: number) => {
    if (automationRunning) return;
    const row = folderPairs[rowIndex];
    if (!row) return;

    const endpoint = rowEndpointByIndex[rowIndex] ?? parseEndpoint(row.endpointIndex);
    if (!endpoint) {
      setAutomationResult({
        success: false,
        error: "Row endpoint is unknown. Select fixed endpoint 1/2/3 or run once first.",
      });
      return;
    }

    const paused = Boolean(rowPausedByIndex[rowIndex]);
    const action = paused ? "resume" : "pause";

    setRowControlLoadingByIndex((prev) => ({ ...prev, [rowIndex]: true }));
    try {
      const { ok, data } = await postSeedanceQueueControl({
        action,
        queue: endpoint,
      });
      if (!ok || !data.success) {
        throw new Error(data.error || `${action} request failed`);
      }
      setRowPausedByIndex((prev) => ({ ...prev, [rowIndex]: !paused }));
    } catch (e: unknown) {
      setAutomationResult({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRowControlLoadingByIndex((prev) => ({ ...prev, [rowIndex]: false }));
    }
  }, [
    automationRunning,
    folderPairs,
    rowEndpointByIndex,
    rowPausedByIndex,
  ]);

  const handleAutomationScan = useCallback(async () => {
    const rows = folderPairs
      .map((pair, rowIndex) => ({ pair, rowIndex }))
      .filter(({ pair }) => pair.inputPath.trim());

    if (rows.length === 0) {
      setScanResult({
        success: false,
        error: "No rows to scan. Input path is required.",
      });
      return;
    }

    const queueLoads: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    try {
      const queuesRes = await fetchSeedanceQueues();
      if (queuesRes.ok && Array.isArray(queuesRes.data?.queues)) {
        for (const q of queuesRes.data.queues) {
          const queueNo = Number(q.queue);
          if (queueNo < 1 || queueNo > 3) continue;
          queueLoads[queueNo] = Number(q.pending || 0) + (q.processing ? 1 : 0);
        }
      }
    } catch {
      // Keep zero loads fallback if queue fetch fails.
    }

    const pickAutoEndpoint = () => {
      let selected = 1;
      let minLoad = queueLoads[1];
      for (const queueNo of [2, 3]) {
        if (queueLoads[queueNo] < minLoad) {
          minLoad = queueLoads[queueNo];
          selected = queueNo;
        }
      }
      return selected;
    };

    const scans: NonNullable<AutomationScanResult["scans"]> = [];
    const endpointSummary: NonNullable<AutomationScanResult["endpointSummary"]> = {
      "1": {
        rows: 0,
        jobs: 0,
        clips: 0,
        idleJobs: 0,
        idleClips: 0,
        speakJobs: 0,
        speakClips: 0,
        clothedJobs: 0,
        clothedClips: 0,
        nakedJobs: 0,
        nakedClips: 0,
      },
      "2": {
        rows: 0,
        jobs: 0,
        clips: 0,
        idleJobs: 0,
        idleClips: 0,
        speakJobs: 0,
        speakClips: 0,
        clothedJobs: 0,
        clothedClips: 0,
        nakedJobs: 0,
        nakedClips: 0,
      },
      "3": {
        rows: 0,
        jobs: 0,
        clips: 0,
        idleJobs: 0,
        idleClips: 0,
        speakJobs: 0,
        speakClips: 0,
        clothedJobs: 0,
        clothedClips: 0,
        nakedJobs: 0,
        nakedClips: 0,
      },
    };

    let successRows = 0;
    let errorRows = 0;
    let totalJobs = 0;
    let totalClips = 0;
    let totalIdleJobs = 0;
    let totalIdleClips = 0;
    let totalSpeakJobs = 0;
    let totalSpeakClips = 0;
    let totalClothedJobs = 0;
    let totalClothedClips = 0;
    let totalNakedJobs = 0;
    let totalNakedClips = 0;

    for (const { pair, rowIndex } of rows) {
      const inputPath = pair.inputPath.trim();
      const outputPath = pair.outputPath?.trim();
      const videosPerClip = Math.min(5, Math.max(1, Number(pair.videosPerClip) || 1));
      const idleTargetCount = Math.min(5, Math.max(1, Number(pair.idleTargetCount) || 1));
      const targetClothing = pair.targetClothing || "all";
      const targetTransition = pair.targetTransition || "all";
      const targetEmotions =
        Array.isArray(pair.targetEmotions) && pair.targetEmotions.length > 0
          ? pair.targetEmotions
          : ["Angry", "Sad", "Aroused", "Neutral", "Happy"];
      const ignoreExistingOutput = Boolean(pair.ignoreExistingOutput);
      const requestedEndpoint = parseEndpoint(pair.endpointIndex);
      const endpoint = requestedEndpoint || pickAutoEndpoint();

      try {
        const { ok, data } = await postAutomationScan({
          inputPath,
          outputPath: outputPath || undefined,
          outputRootPath: outputRootPath || undefined,
          autoOutputByCharacter: autoOutputByCharacter || true,
          endpointIndex: endpoint,
          ignoreExistingOutput,
          targetClothing,
          targetTransition,
          targetEmotions,
          videosPerClip,
          idleTargetCount,
          selectedIdlePrompts: pair.selectedIdlePrompts,
          applyCommonToNaked: pair.applyCommonToNaked,
        });

        if (!ok || !data.success) {
          scans.push({
            rowIndex,
            root: inputPath,
            endpoint,
            endpointMode: requestedEndpoint ? "fixed" : "auto",
            error: data.error || "Scan failed",
          });
          errorRows += 1;
          continue;
        }

        const plannedJobs = Number(data.planned?.total || 0);
        const plannedClips = Number(data.planned?.videoTotal || 0);
        const idleJobs = Number(data.planned?.idle || 0);
        const idleClips = Number(data.planned?.idleVideos || 0);
        const speakJobs = Number(data.planned?.speakTotal || 0);
        const speakClips = Number(data.planned?.speakVideos || 0);
        const clothedJobs = Number(data.planned?.byClothing?.Clothed?.jobs || 0);
        const clothedClips = Number(data.planned?.byClothing?.Clothed?.clips || 0);
        const nakedJobs = Number(data.planned?.byClothing?.Naked?.jobs || 0);
        const nakedClips = Number(data.planned?.byClothing?.Naked?.clips || 0);

        scans.push({
          rowIndex,
          root: data.root || inputPath,
          endpoint,
          endpointMode: requestedEndpoint ? "fixed" : "auto",
          poses: Object.keys(data.poses || {}),
          planned: data.planned,
          filters: data.filters,
          warningsCount: (data.warnings || []).length,
        });

        endpointSummary[String(endpoint)].rows += 1;
        endpointSummary[String(endpoint)].jobs += plannedJobs;
        endpointSummary[String(endpoint)].clips += plannedClips;
        endpointSummary[String(endpoint)].idleJobs += idleJobs;
        endpointSummary[String(endpoint)].idleClips += idleClips;
        endpointSummary[String(endpoint)].speakJobs += speakJobs;
        endpointSummary[String(endpoint)].speakClips += speakClips;
        endpointSummary[String(endpoint)].clothedJobs += clothedJobs;
        endpointSummary[String(endpoint)].clothedClips += clothedClips;
        endpointSummary[String(endpoint)].nakedJobs += nakedJobs;
        endpointSummary[String(endpoint)].nakedClips += nakedClips;

        totalJobs += plannedJobs;
        totalClips += plannedClips;
        totalIdleJobs += idleJobs;
        totalIdleClips += idleClips;
        totalSpeakJobs += speakJobs;
        totalSpeakClips += speakClips;
        totalClothedJobs += clothedJobs;
        totalClothedClips += clothedClips;
        totalNakedJobs += nakedJobs;
        totalNakedClips += nakedClips;
        successRows += 1;

        // Emulate auto endpoint load growth with planned jobs.
        queueLoads[endpoint] += Math.max(1, plannedJobs);
      } catch {
        scans.push({
          rowIndex,
          root: inputPath,
          endpoint,
          endpointMode: requestedEndpoint ? "fixed" : "auto",
          error: "request failed",
        });
        errorRows += 1;
      }
    }

    setScanResult({
      success: successRows > 0,
      scans,
      endpointSummary,
      totals: {
        rows: rows.length,
        successRows,
        errorRows,
        jobs: totalJobs,
        clips: totalClips,
        idleJobs: totalIdleJobs,
        idleClips: totalIdleClips,
        speakJobs: totalSpeakJobs,
        speakClips: totalSpeakClips,
        clothedJobs: totalClothedJobs,
        clothedClips: totalClothedClips,
        nakedJobs: totalNakedJobs,
        nakedClips: totalNakedClips,
      },
      error: successRows > 0 ? undefined : "All row scans failed.",
    });
  }, [
    autoOutputByCharacter,
    folderPairs,
    outputRootPath,
  ]);

  return {
    automationRunning,
    automationResult,
    scanResult,
    rowEndpointByIndex,
    rowPausedByIndex,
    rowControlLoadingByIndex,
    handleAutomationRun,
    handleAutomationRunRow,
    handleToggleRowPause,
    handleAutomationScan,
  };
}
