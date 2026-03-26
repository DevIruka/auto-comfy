import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { postSeedanceGenerate } from "../../services/seedanceApi";
import type { GenerateRequest } from "../../types/app";

interface UseSingleGenerateParams {
  firstFrameImage: string;
  lastFrameImage: string;
  prompt: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  watermark: boolean;
  cameraFixed: boolean;
  batchCount: number;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setGeneratedVideo: Dispatch<SetStateAction<string>>;
  setGeneratedVideos: Dispatch<SetStateAction<string[]>>;
  playCompletionSound: () => void;
}

export function useSingleGenerate({
  firstFrameImage,
  lastFrameImage,
  prompt,
  duration,
  resolution,
  aspectRatio,
  watermark,
  cameraFixed,
  batchCount,
  setLoading,
  setError,
  setGeneratedVideo,
  setGeneratedVideos,
  playCompletionSound,
}: UseSingleGenerateParams) {
  const handleGenerate = useCallback(async () => {
    if (!firstFrameImage) {
      setError("first frame image is required");
      return;
    }

    setLoading(true);
    setError("");
    setGeneratedVideo("");
    setGeneratedVideos([]);

    try {
      const requestData: GenerateRequest = {
        firstFrameImage,
        lastFrameImage: lastFrameImage || undefined,
        prompt: prompt.trim(),
        duration,
        fps: 24,
        resolution,
        aspectRatio,
        watermark,
        cameraFixed,
        batchCount,
      };

      const { data } = await postSeedanceGenerate(requestData);

      if (data.success) {
        if (data.videos && data.videos.length > 0) {
          setGeneratedVideos(data.videos);
          playCompletionSound();
        } else if (data.video) {
          setGeneratedVideo(data.video);
          playCompletionSound();
        }
      } else {
        setError(data.error || "video generation failed");
      }
    } catch (err) {
      setError("failed to communicate with backend. check backend server status.");
      console.error("Error:", err);
    } finally {
      setLoading(false);
    }
  }, [
    aspectRatio,
    batchCount,
    cameraFixed,
    duration,
    firstFrameImage,
    lastFrameImage,
    playCompletionSound,
    prompt,
    resolution,
    setError,
    setGeneratedVideo,
    setGeneratedVideos,
    setLoading,
    watermark,
  ]);

  return { handleGenerate };
}
