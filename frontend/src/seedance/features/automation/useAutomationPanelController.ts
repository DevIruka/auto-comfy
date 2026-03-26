import { useAutomationProgress } from "./useAutomationProgress";
import { useAutomationRunner } from "./useAutomationRunner";
import type { FolderPair } from "../../types/app";
import type { Dispatch, SetStateAction } from "react";

interface UseAutomationPanelControllerParams {
  folderPairs: FolderPair[];
  setFolderPairs: Dispatch<SetStateAction<FolderPair[]>>;
  automationOutputRootPath: string;
  setAutomationOutputRootPath: Dispatch<SetStateAction<string>>;
  automationAutoOutputByCharacter: boolean;
}

export function useAutomationPanelController({
  folderPairs,
  setFolderPairs,
  automationOutputRootPath,
  setAutomationOutputRootPath,
  automationAutoOutputByCharacter,
}: UseAutomationPanelControllerParams) {
  const automationProgress = useAutomationProgress();
  const automationRunner = useAutomationRunner({
    folderPairs,
    outputRootPath: automationOutputRootPath,
    autoOutputByCharacter: automationAutoOutputByCharacter,
    addTrackedJobIds: automationProgress.addTrackedJobIds,
    refreshAutomationProgress: automationProgress.fetchAutomationProgress,
  });

  return {
    automationPanelProps: {
      folderPairs,
      setFolderPairs,
      outputRootPath: automationOutputRootPath,
      setOutputRootPath: setAutomationOutputRootPath,
      automationRunning: automationRunner.automationRunning,
      onRun: automationRunner.handleAutomationRun,
      onRunRow: automationRunner.handleAutomationRunRow,
      onToggleRowPause: automationRunner.handleToggleRowPause,
      rowEndpointByIndex: automationRunner.rowEndpointByIndex,
      rowPausedByIndex: automationRunner.rowPausedByIndex,
      rowControlLoadingByIndex: automationRunner.rowControlLoadingByIndex,
      onScan: automationRunner.handleAutomationScan,
      scanResult: automationRunner.scanResult,
      automationResult: automationRunner.automationResult,
      trackedJobIds: automationProgress.automationTrackedJobIds,
      jobStatuses: automationProgress.automationJobStatuses,
      progressLoading: automationProgress.automationProgressLoading,
      queuesStatus: automationProgress.automationQueuesStatus,
      queueControlLoading: automationProgress.automationQueueControlLoading,
      queueControlMessage: automationProgress.automationQueueControlMessage,
      onRefreshProgress: automationProgress.fetchAutomationProgress,
      onClearProgress: automationProgress.clearAutomationProgress,
      onPauseQueues: automationProgress.pauseAutomationQueues,
      onResumeQueues: automationProgress.resumeAutomationQueues,
      onForceStopQueues: automationProgress.forceStopAutomationQueues,
    },
  };
}
