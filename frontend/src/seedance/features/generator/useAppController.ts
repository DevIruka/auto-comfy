import { useEffect } from "react";
import { useAutomationPanelController } from "../automation/useAutomationPanelController";
import { useCompletionSound } from "../common/useCompletionSound";
import {
  buildGeneratorMainPanelProps,
  buildVideoPanelProps,
} from "./panelPropsBuilders";
import { useAppStates } from "./useAppStates";
import { useImageInputs } from "../image/useImageInputs";
import { useSingleGenerate } from "../single/useSingleGenerate";
import { useTaskListActions } from "../video/useTaskListActions";
import { useVideoOutputActions } from "../video/useVideoOutputActions";
import { useWorkspace } from "../../../context/WorkspaceContext";
import { joinWorkspaceSubfolder } from "../../utils/workspacePaths";

interface UseAppControllerParams {
  soundSrc: string;
}

export function useAppController({ soundSrc }: UseAppControllerParams) {
  const { playCompletionSound } = useCompletionSound({ soundSrc });
  const appState = useAppStates();
  const { paths, workspaceReady } = useWorkspace();

  useEffect(() => {
    const gv = paths?.generalVideo?.trim();
    const ei = paths?.emotionImages?.trim();
    if (!gv && !ei) return;

    if (gv) {
      appState.setVideoBasePath(gv);
      appState.setAutomationOutputRootPath(gv);
    }

    appState.setFolderPairs((prev) =>
      prev.map((p) => ({
        ...p,
        ...(gv ? { outputPath: gv } : {}),
        ...(ei ? { inputPath: joinWorkspaceSubfolder(ei, "Emotions") } : {}),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync workspace paths only
  }, [paths?.generalVideo, paths?.emotionImages]);

  const { automationPanelProps } = useAutomationPanelController({
    folderPairs: appState.folderPairs,
    setFolderPairs: appState.setFolderPairs,
    automationOutputRootPath: appState.automationOutputRootPath,
    setAutomationOutputRootPath: appState.setAutomationOutputRootPath,
    automationAutoOutputByCharacter: appState.automationAutoOutputByCharacter,
  });

  const imageInputs = useImageInputs({
    duration: appState.duration,
    resolution: appState.resolution,
    aspectRatio: appState.aspectRatio,
    watermark: appState.watermark,
    cameraFixed: appState.cameraFixed,
    uploadedImages: appState.uploadedImages,
    setUploadedImages: appState.setUploadedImages,
    setVideoTasks: appState.setVideoTasks,
    setFirstFrameImage: appState.setFirstFrameImage,
    setLastFrameImage: appState.setLastFrameImage,
  });

  const taskListActions = useTaskListActions({
    videoTasks: appState.videoTasks,
    setUploadedImages: appState.setUploadedImages,
    setVideoTasks: appState.setVideoTasks,
    setExpandedImageId: appState.setExpandedImageId,
  });

  const { handleGenerate } = useSingleGenerate({
    firstFrameImage: appState.firstFrameImage,
    lastFrameImage: appState.lastFrameImage,
    prompt: appState.prompt,
    duration: appState.duration,
    resolution: appState.resolution,
    aspectRatio: appState.aspectRatio,
    watermark: appState.watermark,
    cameraFixed: appState.cameraFixed,
    batchCount: appState.batchCount,
    setLoading: appState.setLoading,
    setError: appState.setError,
    setGeneratedVideo: appState.setGeneratedVideo,
    setGeneratedVideos: appState.setGeneratedVideos,
    playCompletionSound,
  });

  const videoOutputActions = useVideoOutputActions({
    uploadedImages: appState.uploadedImages,
    videoBasePath: appState.videoBasePath,
  });

  const generatorMainPanelPropsBase = buildGeneratorMainPanelProps({
    automationPanelProps,
    loading: appState.loading,
    firstFrameImage: appState.firstFrameImage,
    lastFrameImage: appState.lastFrameImage,
    prompt: appState.prompt,
    duration: appState.duration,
    resolution: appState.resolution,
    aspectRatio: appState.aspectRatio,
    batchCount: appState.batchCount,
    watermark: appState.watermark,
    cameraFixed: appState.cameraFixed,
    onFirstFrameUpload: imageInputs.handleFirstFrameUpload,
    onLastFrameUpload: imageInputs.handleLastFrameUpload,
    setPrompt: appState.setPrompt,
    setDuration: appState.setDuration,
    setResolution: appState.setResolution,
    setAspectRatio: appState.setAspectRatio,
    setBatchCount: appState.setBatchCount,
    setWatermark: appState.setWatermark,
    setCameraFixed: appState.setCameraFixed,
    hasFirstFrameImage: !!appState.firstFrameImage,
    onSingleGenerate: handleGenerate,
    error: appState.error,
  });

  const generatorMainPanelPropsSingle = {
    ...generatorMainPanelPropsBase,
    panelVariant: "singleOnly" as const,
    workspaceReady,
  };
  const generatorMainPanelPropsAutomation = {
    ...generatorMainPanelPropsBase,
    panelVariant: "automationOnly" as const,
    workspaceReady,
  };

  const { generatedVideosSectionProps } = buildVideoPanelProps({
    videoTasks: appState.videoTasks,
    loading: appState.loading,
    onClearCompleted: taskListActions.clearCompletedTasks,
    onClearAll: taskListActions.clearAllTasks,
    onRemoveTask: taskListActions.removeVideoTask,
    onSaveVideo: videoOutputActions.handleSaveVideo,
    generatedVideo: appState.generatedVideo,
    generatedVideos: appState.generatedVideos,
    onDownloadSingle: () => videoOutputActions.handleDownload(appState.generatedVideo),
    onDownloadBatch: videoOutputActions.handleBatchDownload,
  });

  return {
    generatorMainPanelPropsSingle,
    generatorMainPanelPropsAutomation,
    generatedVideosSectionProps,
  };
}
