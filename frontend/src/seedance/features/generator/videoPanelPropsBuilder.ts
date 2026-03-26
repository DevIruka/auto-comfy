import type { ComponentProps } from "react";
import { BatchTasksSection } from "../video/BatchTasksSection";
import { GeneratedVideosSection } from "../video/GeneratedVideosSection";
import type { VideoTask } from "../../types/app";

interface BuildVideoPanelPropsParams {
  videoTasks: VideoTask[];
  loading: boolean;
  onClearCompleted: () => void;
  onClearAll: () => void;
  onRemoveTask: (taskId: string) => void;
  onSaveVideo: (taskId: string, videoUrl: string) => void;
  generatedVideo: string;
  generatedVideos: string[];
  onDownloadSingle: () => void;
  onDownloadBatch: (video: string, index: number) => void;
}

export function buildVideoPanelProps({
  videoTasks,
  loading,
  onClearCompleted,
  onClearAll,
  onRemoveTask,
  onSaveVideo,
  generatedVideo,
  generatedVideos,
  onDownloadSingle,
  onDownloadBatch,
}: BuildVideoPanelPropsParams) {
  const batchTasksSectionProps: ComponentProps<typeof BatchTasksSection> = {
    videoTasks,
    loading,
    onClearCompleted,
    onClearAll,
    onRemoveTask,
    onSaveVideo,
  };

  const generatedVideosSectionProps: ComponentProps<typeof GeneratedVideosSection> = {
    generatedVideo,
    generatedVideos,
    onDownloadSingle,
    onDownloadBatch,
  };

  return { batchTasksSectionProps, generatedVideosSectionProps };
}
