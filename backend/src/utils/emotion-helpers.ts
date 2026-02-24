/**
 * Utility functions for parsing and generating emotion-based video filenames
 */

export interface EmotionImageInfo {
  pose: string; // "Sit", "Stand", etc.
  emotion: string; // "neutral", "angry", "sad", "happy", "aroused"
  clothingType: string; // "Clothed" or "Naked"
}

export type VideoType =
  | "idle"
  | "speaknatural_same"
  | "speaknatural_to_neutral";

/**
 * Parse emotion image filename
 * Examples:
 *   sit_neutral.png → { pose: "Sit", emotion: "neutral", clothingType: "Clothed" }
 *   sit_nude_angry.png → { pose: "Sit", emotion: "angry", clothingType: "Naked" }
 *   stand_happy.png → { pose: "Stand", emotion: "happy", clothingType: "Clothed" }
 */
export function parseEmotionImage(
  filename: string,
  isNudeFolder: boolean
): EmotionImageInfo {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.(png|jpg|jpeg)$/i, "");

  // Split by underscore
  const parts = nameWithoutExt.split("_");

  // Determine clothing type
  const clothingType = isNudeFolder ? "Naked" : "Clothed";

  // Parse pose and emotion
  let pose: string;
  let emotion: string;

  if (isNudeFolder) {
    // Format: sit_nude_angry or stand_nude_happy
    // parts[0] = pose, parts[1] = "nude", parts[2] = emotion
    pose = capitalize(parts[0]);
    emotion = parts[2] || "neutral";
  } else {
    // Format: sit_angry or stand_happy
    // parts[0] = pose, parts[1] = emotion
    pose = capitalize(parts[0]);
    emotion = parts[1] || "neutral";
  }

  return { pose, emotion, clothingType };
}

/**
 * Generate emotion video filename
 * Format: {Pose}_{VideoType}_{Emotion}_to_{TargetEmotion}_{ClothingType}_{Index}.mkv
 * Examples:
 *   Sit_Idle_Neutral_to_Neutral_Clothed_00001.mkv
 *   Stand_SpeakNatural_Angry_to_Angry_Naked_00002.mkv
 *   Sit_SpeakNatural_Sad_to_Neutral_Clothed_00003.mkv
 */
export function generateEmotionFilename(
  imageInfo: EmotionImageInfo,
  videoType: VideoType,
  index: number
): string {
  const { pose, emotion, clothingType } = imageInfo;

  // Determine video type label
  let typeLabel: string;
  let emotionTransition: string;

  switch (videoType) {
    case "idle":
      typeLabel = "Idle";
      emotionTransition = "Neutral_to_Neutral"; // Idle always neutral → neutral
      break;
    case "speaknatural_same":
      typeLabel = "SpeakNatural";
      emotionTransition = `${capitalize(emotion)}_to_${capitalize(emotion)}`;
      break;
    case "speaknatural_to_neutral":
      typeLabel = "SpeakNatural";
      emotionTransition = `${capitalize(emotion)}_to_Neutral`;
      break;
    default:
      throw new Error(`Unknown video type: ${videoType}`);
  }

  // Format: Pose_Type_Transition_Clothing_Index.mkv
  const paddedIndex = String(index).padStart(5, "0");
  return `${pose}_${typeLabel}_${emotionTransition}_${clothingType}_${paddedIndex}.mkv`;
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Get video type display name
 */
export function getVideoTypeDisplayName(type: VideoType): string {
  const names: Record<VideoType, string> = {
    idle: "Idle (대기)",
    speaknatural_same: "SpeakNatural (동일 감정)",
    speaknatural_to_neutral: "SpeakNatural (→ Neutral)",
  };
  return names[type];
}
