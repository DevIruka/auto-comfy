import type { ImageFile } from "../../types/app";

interface UploadDefaults {
  duration: number;
  resolution: string;
  aspectRatio: string;
  watermark: boolean;
  cameraFixed: boolean;
}

export function parseFileNameSettings(fileName: string) {
  const nameLower = fileName.toLowerCase();

  let pose = "Stand";
  if (nameLower.startsWith("sit")) {
    pose = "Sit";
  } else if (nameLower.startsWith("stand")) {
    pose = "Stand";
  }

  let clothing = "Clothed";
  if (nameLower.includes("nude") || nameLower.includes("naked")) {
    clothing = "Naked";
  }

  let emotion = "Neutral";
  if (nameLower.includes("angry")) {
    emotion = "Angry";
  } else if (nameLower.includes("aroused")) {
    emotion = "Aroused";
  } else if (nameLower.includes("sad")) {
    emotion = "Sad";
  } else if (nameLower.includes("happy")) {
    emotion = "Happy";
  } else if (nameLower.includes("neutral")) {
    emotion = "Neutral";
  }

  let action = "Idle";
  let startEmotion = emotion;
  let endEmotion = emotion;

  if (emotion !== "Neutral") {
    action = "SpeakNatural";
    startEmotion = emotion;
    endEmotion = emotion;
  } else {
    endEmotion = "Idle";
  }

  return { pose, clothing, action, startEmotion, endEmotion };
}

export function generateVideoFileName(img: ImageFile): string {
  const pose = img.pose || "Stand";
  const clothing = img.clothing || "Clothed";
  const action = img.action || "Idle";
  const startEmotion = img.startEmotion || "Neutral";
  const endEmotion = img.endEmotion || "Idle";

  if (action === "Idle") {
    return `${pose}_${clothing}_Idle_?.mp4`;
  }
  if (action === "SpeakNatural") {
    return `${pose}_SpeakNatural_${startEmotion}_to_${endEmotion}_${clothing}.mp4`;
  }
  return `${pose}_${clothing}_${action}.mp4`;
}

export function detectEndEmotionFromFileName(fileName: string) {
  const nameLower = fileName.toLowerCase();
  if (nameLower.includes("angry")) return "Angry";
  if (nameLower.includes("aroused")) return "Aroused";
  if (nameLower.includes("sad")) return "Sad";
  if (nameLower.includes("happy")) return "Happy";
  return "Idle";
}

export function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) || null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function buildUploadedImageFile(
  file: File,
  id: string,
  preview: string,
  defaults: UploadDefaults,
): ImageFile {
  const autoSettings = parseFileNameSettings(file.name);
  return {
    id,
    file,
    preview,
    name: file.name,
    duration: defaults.duration,
    fps: 24,
    resolution: defaults.resolution,
    aspectRatio: defaults.aspectRatio,
    watermark: defaults.watermark,
    cameraFixed: defaults.cameraFixed,
    prompt: "",
    pose: autoSettings.pose,
    clothing: autoSettings.clothing,
    action: autoSettings.action,
    startEmotion: autoSettings.startEmotion,
    endEmotion: autoSettings.endEmotion,
  };
}
