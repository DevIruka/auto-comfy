import { useCallback } from "react";
import { postSaveVideo } from "../../services/seedanceApi";
import type { ImageFile } from "../../types/app";

interface UseVideoOutputActionsParams {
  uploadedImages: ImageFile[];
  videoBasePath: string;
}

export function useVideoOutputActions({
  uploadedImages,
  videoBasePath,
}: UseVideoOutputActionsParams) {
  const handleSaveVideo = useCallback(
    async (taskId: string, videoUrl: string) => {
      const imageFile = uploadedImages.find((img) => img.id === taskId);
      if (!imageFile) {
        alert("image metadata not found");
        return;
      }

      try {
        const { data } = await postSaveVideo({
          videoUrl,
          basePath: videoBasePath,
          pose: imageFile.pose || "Stand",
          clothing: imageFile.clothing || "Clothed",
          action: imageFile.action || "Idle",
          startEmotion: imageFile.startEmotion || "Neutral",
          endEmotion: imageFile.endEmotion || "Neutral",
        });

        if (data.success) {
          if (data.savedCount && data.savedCount > 1) {
            alert(
              "saved " +
                data.savedCount +
                " files\n\n" +
                "1. " +
                data.fileName +
                "\n" +
                "2. " +
                imageFile.pose +
                "_SpeakNatural_Neutral_to_Neutral_" +
                imageFile.clothing +
                ".mp4\n\n" +
                "path: " +
                (data.filePath || "").replace(data.fileName || "", ""),
            );
          } else {
            alert("saved\npath: " + data.filePath + "\nfile: " + data.fileName);
          }
        } else {
          alert("save failed: " + data.error);
        }
      } catch (err) {
        alert("failed to communicate with backend");
        console.error("Error:", err);
      }
    },
    [uploadedImages, videoBasePath],
  );

  const handleDownload = useCallback((generatedVideo: string) => {
    if (!generatedVideo) return;
    const link = document.createElement("a");
    link.href = generatedVideo;
    link.download = "seedance-video.mp4";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleBatchDownload = useCallback((video: string, index: number) => {
    const link = document.createElement("a");
    link.href = video;
    link.download = `seedance-video-${index}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  return { handleSaveVideo, handleDownload, handleBatchDownload };
}
