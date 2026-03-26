import { useCallback } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import type { ImageFile, VideoTask } from "../../types/app";
import {
  buildUploadedImageFile,
  detectEndEmotionFromFileName,
  generateVideoFileName,
  readFileAsDataUrl,
} from "./imageInputUtils";

interface UseImageInputsParams {
  duration: number;
  resolution: string;
  aspectRatio: string;
  watermark: boolean;
  cameraFixed: boolean;
  uploadedImages: ImageFile[];
  setUploadedImages: Dispatch<SetStateAction<ImageFile[]>>;
  setVideoTasks: Dispatch<SetStateAction<VideoTask[]>>;
  setFirstFrameImage: Dispatch<SetStateAction<string>>;
  setLastFrameImage: Dispatch<SetStateAction<string>>;
}

export function useImageInputs({
  duration,
  resolution,
  aspectRatio,
  watermark,
  cameraFixed,
  uploadedImages,
  setUploadedImages,
  setVideoTasks,
  setFirstFrameImage,
  setLastFrameImage,
}: UseImageInputsParams) {
  const generateFileName = useCallback((img: ImageFile): string => {
    return generateVideoFileName(img);
  }, []);

  const handleMultipleImagesUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files) return;

      const imageFiles = (
        await Promise.all(
          Array.from(files).map(async (file, index) => {
            const id = `${Date.now()}-${Math.random()}-${index}`;
            const preview = await readFileAsDataUrl(file);
            if (!preview) return null;
            return buildUploadedImageFile(file, id, preview, {
              duration,
              resolution,
              aspectRatio,
              watermark,
              cameraFixed,
            });
          }),
        )
      ).filter((item): item is ImageFile => Boolean(item));

      if (imageFiles.length > 0) {
        setUploadedImages((prev) => [...prev, ...imageFiles]);
      }

      event.target.value = "";
    },
    [
      aspectRatio,
      cameraFixed,
      duration,
      resolution,
      setUploadedImages,
      watermark,
    ],
  );

  const removeImage = useCallback(
    (id: string) => {
      setUploadedImages((prev) => prev.filter((img) => img.id !== id));
      setVideoTasks((prev) => prev.filter((task) => task.id !== id));
    },
    [setUploadedImages, setVideoTasks],
  );

  const updateImageSettings = useCallback(
    (
      id: string,
      settings: Partial<Omit<ImageFile, "id" | "file" | "preview" | "name">>,
    ) => {
      setUploadedImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, ...settings } : img)),
      );
    },
    [setUploadedImages],
  );

  const handleDuplicateImage = useCallback(
    (id: string) => {
      const imgToDuplicate = uploadedImages.find((img) => img.id === id);
      if (!imgToDuplicate) return;

      const newId = `${Date.now()}-${Math.random()}`;
      const duplicatedImage: ImageFile = {
        ...imgToDuplicate,
        id: newId,
      };

      setUploadedImages((prev) => {
        const index = prev.findIndex((img) => img.id === id);
        const next = [...prev];
        next.splice(index + 1, 0, duplicatedImage);
        return next;
      });
    },
    [setUploadedImages, uploadedImages],
  );

  const handleLastFrameUploadForImage = useCallback(
    async (id: string, event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const result = await readFileAsDataUrl(file);
      if (!result) return;
      const endEmotion = detectEndEmotionFromFileName(file.name);

      updateImageSettings(id, {
        lastFrameImage: result,
        lastFrameFileName: file.name,
        endEmotion,
      });

      console.log(
        `last frame uploaded: ${file.name} -> detected emotion: ${endEmotion}`,
      );
    },
    [updateImageSettings],
  );

  const handleFirstFrameUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const result = await readFileAsDataUrl(file);
      if (result) setFirstFrameImage(result);
    },
    [setFirstFrameImage],
  );

  const handleLastFrameUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const result = await readFileAsDataUrl(file);
      if (result) setLastFrameImage(result);
    },
    [setLastFrameImage],
  );

  return {
    generateFileName,
    handleMultipleImagesUpload,
    removeImage,
    updateImageSettings,
    handleDuplicateImage,
    handleLastFrameUploadForImage,
    handleFirstFrameUpload,
    handleLastFrameUpload,
  };
}
