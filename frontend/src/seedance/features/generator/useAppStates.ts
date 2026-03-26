import { useState } from "react";
import type { FolderPair, ImageFile, VideoTask } from "../../types/app";

interface RenameFileItem {
  old: string;
  new: string;
  folder: string;
}

interface RenameGroupItem {
  old: string;
  new: string;
  group: string;
}

interface ScannedImage {
  originalName: string;
  width?: number;
  height?: number;
  aspectType?: string;
  suggestedPrefix?: string;
  suggestedName?: string;
  newName: string;
  error?: string;
}

export function useAppStates() {
  const [folderBasePath, setFolderBasePath] = useState(
    "C:\\Users\\Public\\Desktop\\videos",
  );
  const [folderCreating, setFolderCreating] = useState(false);
  const [folderResult, setFolderResult] = useState<{
    success: boolean;
    message: string;
    createdCount?: number;
    skippedCount?: number;
  } | null>(null);
  const [showFolderSection, setShowFolderSection] = useState(false);

  const [renaming, setRenaming] = useState(false);
  const [renameResult, setRenameResult] = useState<{
    success: boolean;
    message: string;
    renamedCount?: number;
    errorCount?: number;
    renamedFiles?: RenameFileItem[];
  } | null>(null);

  const [renamingActions, setRenamingActions] = useState(false);
  const [renameActionsResult, setRenameActionsResult] = useState<{
    success: boolean;
    message: string;
    renamedCount?: number;
    errorCount?: number;
    renamedFiles?: RenameFileItem[];
  } | null>(null);

  const [imageRenameFolderPath, setImageRenameFolderPath] = useState(
    "C:\\Users\\Public\\Desktop\\images",
  );
  const [imageRenameScanning, setImageRenameScanning] = useState(false);
  const [imageRenameExecuting, setImageRenameExecuting] = useState(false);
  const [scannedImages, setScannedImages] = useState<ScannedImage[]>([]);
  const [imageRenameResult, setImageRenameResult] = useState<{
    success: boolean;
    message: string;
    renamedCount?: number;
    errorCount?: number;
  } | null>(null);

  const [videoBasePath, setVideoBasePath] = useState(
    "C:\\Users\\Public\\Desktop\\videos",
  );
  const [uploadedImages, setUploadedImages] = useState<ImageFile[]>([]);
  const [videoTasks, setVideoTasks] = useState<VideoTask[]>([]);
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);

  const [folderPairs, setFolderPairs] = useState<FolderPair[]>([
    {
      inputPath: "",
      outputPath: "",
      prompt: "",
      endpointIndex: "auto",
      videosPerClip: 1,
      idleTargetCount: 1,
      ignoreExistingOutput: false,
      targetEmotions: ["Angry", "Sad", "Aroused", "Neutral", "Happy"],
      targetClothing: "all",
      targetTransition: "all",
    },
  ]);
  const [prefixPromptAutomation, setPrefixPromptAutomation] = useState("");
  const [automationOutputRootPath, setAutomationOutputRootPath] = useState("");
  const [automationAutoOutputByCharacter, setAutomationAutoOutputByCharacter] =
    useState(true);

  const [prefixPrompt, setPrefixPrompt] = useState("");
  const [suffixPrompt, setSuffixPrompt] = useState("");
  const [firstFrameImage, setFirstFrameImage] = useState<string>("");
  const [lastFrameImage, setLastFrameImage] = useState<string>("");

  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [watermark, setWatermark] = useState(false);
  const [cameraFixed, setCameraFixed] = useState(true);
  const [batchCount, setBatchCount] = useState(1);
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [loading, setLoading] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState<string>("");
  const [generatedVideos, setGeneratedVideos] = useState<string[]>([]);
  const [error, setError] = useState("");

  const [sequentialRenameFolderPath, setSequentialRenameFolderPath] = useState(
    "C:\\Users\\Public\\Desktop\\videos\\Sit\\Idle",
  );
  const [sequentialRenaming, setSequentialRenaming] = useState(false);
  const [sequentialRenameResult, setSequentialRenameResult] = useState<{
    success: boolean;
    message: string;
    renamedCount?: number;
    renamedFiles?: RenameGroupItem[];
    groups?: string[];
  } | null>(null);

  return {
    folderBasePath,
    setFolderBasePath,
    folderCreating,
    setFolderCreating,
    folderResult,
    setFolderResult,
    showFolderSection,
    setShowFolderSection,
    renaming,
    setRenaming,
    renameResult,
    setRenameResult,
    renamingActions,
    setRenamingActions,
    renameActionsResult,
    setRenameActionsResult,
    imageRenameFolderPath,
    setImageRenameFolderPath,
    imageRenameScanning,
    setImageRenameScanning,
    imageRenameExecuting,
    setImageRenameExecuting,
    scannedImages,
    setScannedImages,
    imageRenameResult,
    setImageRenameResult,
    videoBasePath,
    setVideoBasePath,
    uploadedImages,
    setUploadedImages,
    videoTasks,
    setVideoTasks,
    expandedImageId,
    setExpandedImageId,
    folderPairs,
    setFolderPairs,
    prefixPromptAutomation,
    setPrefixPromptAutomation,
    automationOutputRootPath,
    setAutomationOutputRootPath,
    automationAutoOutputByCharacter,
    setAutomationAutoOutputByCharacter,
    prefixPrompt,
    setPrefixPrompt,
    suffixPrompt,
    setSuffixPrompt,
    firstFrameImage,
    setFirstFrameImage,
    lastFrameImage,
    setLastFrameImage,
    prompt,
    setPrompt,
    duration,
    setDuration,
    resolution,
    setResolution,
    aspectRatio,
    setAspectRatio,
    watermark,
    setWatermark,
    cameraFixed,
    setCameraFixed,
    batchCount,
    setBatchCount,
    maxConcurrent,
    setMaxConcurrent,
    loading,
    setLoading,
    generatedVideo,
    setGeneratedVideo,
    generatedVideos,
    setGeneratedVideos,
    error,
    setError,
    sequentialRenameFolderPath,
    setSequentialRenameFolderPath,
    sequentialRenaming,
    setSequentialRenaming,
    sequentialRenameResult,
    setSequentialRenameResult,
  };
}
