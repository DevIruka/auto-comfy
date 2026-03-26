import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { postSeedanceGenerate } from "../../services/seedanceApi";
import type { GenerateRequest, ImageFile, VideoTask } from "../../types/app";

interface UseBatchGenerateParams {
  uploadedImages: ImageFile[];
  prefixPrompt: string;
  suffixPrompt: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  watermark: boolean;
  cameraFixed: boolean;
  maxConcurrent: number;
  generateFileName: (img: ImageFile) => string;
  playCompletionSound: () => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setVideoTasks: Dispatch<SetStateAction<VideoTask[]>>;
}

const REQUEST_DELAY_MS = 500;

function buildPrompt(prefix: string, base: string, suffix: string): string {
  if (!prefix && !suffix) return base;
  const parts: string[] = [];
  if (prefix) parts.push(prefix);
  if (base) parts.push(base);
  if (suffix) parts.push(suffix);
  return parts.join(" ");
}

function classifyBatchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("timeout")) return "request timeout";
  if (lower.includes("abort")) return "request aborted";
  if (lower.includes("network") || lower.includes("fetch")) {
    return "network error";
  }
  return message ? `error: ${message}` : "request failed";
}

export function useBatchGenerate({
  uploadedImages,
  prefixPrompt,
  suffixPrompt,
  duration,
  resolution,
  aspectRatio,
  watermark,
  cameraFixed,
  maxConcurrent,
  generateFileName,
  playCompletionSound,
  setLoading,
  setError,
  setVideoTasks,
}: UseBatchGenerateParams) {
  const processImage = useCallback(
    async (imageFile: ImageFile) => {
      const taskId = imageFile.id;
      setVideoTasks((prev) =>
        prev.map((task) =>
          task.id === taskId ? { ...task, status: "processing" as const } : task,
        ),
      );

      try {
        const finalPrompt = buildPrompt(
          prefixPrompt.trim(),
          imageFile.prompt?.trim() || "",
          suffixPrompt.trim(),
        );

        const requestData: GenerateRequest = {
          firstFrameImage: imageFile.preview,
          lastFrameImage: imageFile.lastFrameImage || undefined,
          prompt: finalPrompt,
          duration: imageFile.duration || duration,
          fps: 24,
          resolution: imageFile.resolution || resolution,
          aspectRatio: imageFile.aspectRatio || aspectRatio,
          watermark:
            imageFile.watermark !== undefined ? imageFile.watermark : watermark,
          cameraFixed:
            imageFile.cameraFixed !== undefined
              ? imageFile.cameraFixed
              : cameraFixed,
          batchCount: 1,
        };

        const { ok, data, status } = await postSeedanceGenerate(requestData);
        if (!ok) {
          throw new Error(data.error || `HTTP ${status}`);
        }

        if (data.success && data.video) {
          setVideoTasks((prev) =>
            prev.map((task) =>
              task.id === taskId
                ? { ...task, status: "completed" as const, video: data.video }
                : task,
            ),
          );
          playCompletionSound();
          return;
        }

        setVideoTasks((prev) =>
          prev.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status: "failed" as const,
                  error: data.error || "video generation failed",
                }
              : task,
          ),
        );
      } catch (error) {
        const displayError = classifyBatchError(error);
        setVideoTasks((prev) =>
          prev.map((task) =>
            task.id === taskId
              ? { ...task, status: "failed" as const, error: displayError }
              : task,
          ),
        );
      }
    },
    [
      aspectRatio,
      cameraFixed,
      duration,
      playCompletionSound,
      prefixPrompt,
      resolution,
      setVideoTasks,
      suffixPrompt,
      watermark,
    ],
  );

  const handleBatchGenerate = useCallback(async () => {
    if (uploadedImages.length === 0) {
      setError("upload images first");
      return;
    }

    const imagesWithoutLastFrame = uploadedImages.filter((img) => !img.lastFrameImage);
    if (imagesWithoutLastFrame.length > 0) {
      const imageNames = imagesWithoutLastFrame.map((img) => img.name).join("\n- ");
      alert(
        "Some images are missing last frame.\n\nPlease set last frame for:\n\n- " +
          imageNames,
      );
      return;
    }

    setLoading(true);
    setError("");

    const tasks: VideoTask[] = uploadedImages.map((img) => ({
      id: img.id,
      imageName: img.name,
      imagePreview: img.preview,
      status: "pending",
      generatedFileName: generateFileName(img),
    }));
    setVideoTasks(tasks);

    const processingQueue = [...uploadedImages];
    const activePromises: Promise<void>[] = [];

    while (processingQueue.length > 0 || activePromises.length > 0) {
      while (activePromises.length < maxConcurrent && processingQueue.length > 0) {
        const imageFile = processingQueue.shift()!;
        const promise = processImage(imageFile).then(() => {
          const index = activePromises.indexOf(promise);
          if (index > -1) activePromises.splice(index, 1);
        });
        activePromises.push(promise);

        if (processingQueue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
        }
      }

      if (activePromises.length > 0) {
        await Promise.race(activePromises);
      }
    }

    setLoading(false);
  }, [
    uploadedImages,
    setError,
    setLoading,
    setVideoTasks,
    generateFileName,
    maxConcurrent,
    processImage,
  ]);

  return { handleBatchGenerate };
}
