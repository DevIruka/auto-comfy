import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ImageFile, VideoTask } from "../../types/app";

interface UseTaskListActionsParams {
  videoTasks: VideoTask[];
  setUploadedImages: Dispatch<SetStateAction<ImageFile[]>>;
  setVideoTasks: Dispatch<SetStateAction<VideoTask[]>>;
  setExpandedImageId: Dispatch<SetStateAction<string | null>>;
}

export function useTaskListActions({
  videoTasks,
  setUploadedImages,
  setVideoTasks,
  setExpandedImageId,
}: UseTaskListActionsParams) {
  const clearAllTasks = useCallback(() => {
    setUploadedImages([]);
    setVideoTasks([]);
    setExpandedImageId(null);
  }, [setExpandedImageId, setUploadedImages, setVideoTasks]);

  const clearCompletedTasks = useCallback(() => {
    const completedIds = videoTasks
      .filter((task) => task.status === "completed")
      .map((task) => task.id);

    setUploadedImages((prev) => prev.filter((img) => !completedIds.includes(img.id)));
    setVideoTasks((prev) => prev.filter((task) => task.status !== "completed"));
  }, [setUploadedImages, setVideoTasks, videoTasks]);

  const removeVideoTask = useCallback(
    (taskId: string) => {
      setVideoTasks((prev) => prev.filter((task) => task.id !== taskId));
      setUploadedImages((prev) => prev.filter((img) => img.id !== taskId));
    },
    [setUploadedImages, setVideoTasks],
  );

  return { clearAllTasks, clearCompletedTasks, removeVideoTask };
}
