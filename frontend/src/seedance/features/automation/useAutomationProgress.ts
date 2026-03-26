import { useCallback, useEffect, useState } from "react";
import {
  fetchSeedanceJob,
  fetchSeedanceQueues,
  postSeedanceQueueControl,
} from "../../services/seedanceApi";
import type { AutomationJobStatus, AutomationQueuesStatus } from "../../types/app";

export function useAutomationProgress() {
  const [automationJobStatuses, setAutomationJobStatuses] = useState<
    Record<string, AutomationJobStatus>
  >({});
  const [automationProgressLoading, setAutomationProgressLoading] =
    useState(false);
  const [automationQueuesStatus, setAutomationQueuesStatus] =
    useState<AutomationQueuesStatus | null>(null);
  const [automationQueueControlLoading, setAutomationQueueControlLoading] =
    useState(false);
  const [automationQueueControlMessage, setAutomationQueueControlMessage] =
    useState<string | null>(null);
  const [automationTrackedJobIds, setAutomationTrackedJobIds] = useState<
    string[]
  >([]);

  const fetchAutomationProgress = useCallback(async (jobIds: string[]) => {
    if (jobIds.length === 0) return;
    setAutomationProgressLoading(true);
    try {
      const [jobResults, queuesRes] = await Promise.all([
        Promise.all(
          jobIds.map(async (id) => {
            const { ok, data } = await fetchSeedanceJob(id);
            const payload = ok ? data : { status: "unknown" };
            return [
              id,
              {
                status: payload.status || "unknown",
                error: payload.error,
                result: payload.result,
              },
            ] as const;
          }),
        ),
        fetchSeedanceQueues().then((r) => (r.ok ? r.data : null)),
      ]);

      setAutomationJobStatuses((prev) => ({
        ...prev,
        ...Object.fromEntries(jobResults),
      }));
      if (queuesRes?.queues) setAutomationQueuesStatus(queuesRes);
    } finally {
      setAutomationProgressLoading(false);
    }
  }, []);

  useEffect(() => {
    const jobIds = automationTrackedJobIds;
    if (jobIds.length === 0) return;
    const hasPending = jobIds.some((id) => {
      const s = automationJobStatuses[id]?.status;
      return (
        !automationJobStatuses[id] ||
        s === "queued" ||
        s === "processing" ||
        s === "retrying"
      );
    });
    if (!hasPending && Object.keys(automationJobStatuses).length > 0) return;
    const timer = setInterval(() => fetchAutomationProgress(jobIds), 5000);
    fetchAutomationProgress(jobIds);
    return () => clearInterval(timer);
  }, [automationTrackedJobIds, automationJobStatuses, fetchAutomationProgress]);

  const addTrackedJobIds = useCallback((jobIds: string[]) => {
    if (jobIds.length === 0) return;
    const uniqueJobIds = Array.from(new Set(jobIds));

    setAutomationTrackedJobIds((prev) => {
      const merged = [...prev, ...uniqueJobIds];
      return Array.from(new Set(merged));
    });

    // Reflect queued items immediately before next poll.
    setAutomationJobStatuses((prev) => {
      const next = { ...prev };
      for (const id of uniqueJobIds) {
        if (!next[id]) next[id] = { status: "queued" };
      }
      return next;
    });
  }, []);

  const clearAutomationProgress = useCallback(() => {
    setAutomationTrackedJobIds([]);
    setAutomationJobStatuses({});
    setAutomationQueuesStatus(null);
    setAutomationQueueControlMessage(null);
  }, []);

  const controlAutomationQueues = useCallback(
    async (action: "pause" | "resume" | "stop") => {
      setAutomationQueueControlLoading(true);
      setAutomationQueueControlMessage(null);
      try {
        const { ok, data } = await postSeedanceQueueControl({ action });
        if (!ok || !data.success) {
          throw new Error(data.error || `${action} request failed`);
        }
        const defaultMessage =
          action === "pause"
            ? "Queues paused."
            : action === "resume"
              ? "Queues resumed."
              : `Force stop completed. queued=${data.queuedStopped || 0}, processingRequested=${data.processingStopRequested || 0}`;
        setAutomationQueueControlMessage(data.message || defaultMessage);

        const queuesRes = await fetchSeedanceQueues();
        if (queuesRes.ok && queuesRes.data?.queues) {
          setAutomationQueuesStatus(queuesRes.data);
        }
      } catch (e: unknown) {
        setAutomationQueueControlMessage(
          e instanceof Error ? e.message : String(e),
        );
      } finally {
        setAutomationQueueControlLoading(false);
      }
    },
    [],
  );

  const pauseAutomationQueues = useCallback(async () => {
    await controlAutomationQueues("pause");
  }, [controlAutomationQueues]);

  const resumeAutomationQueues = useCallback(async () => {
    await controlAutomationQueues("resume");
  }, [controlAutomationQueues]);

  const forceStopAutomationQueues = useCallback(async () => {
    await controlAutomationQueues("stop");
  }, [controlAutomationQueues]);

  return {
    automationJobStatuses,
    automationProgressLoading,
    automationQueuesStatus,
    automationQueueControlLoading,
    automationQueueControlMessage,
    automationTrackedJobIds,
    fetchAutomationProgress,
    addTrackedJobIds,
    clearAutomationProgress,
    pauseAutomationQueues,
    resumeAutomationQueues,
    forceStopAutomationQueues,
  };
}
