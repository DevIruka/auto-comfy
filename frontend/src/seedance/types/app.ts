export interface GenerateRequest {
  firstFrameImage: string;
  lastFrameImage?: string;
  prompt?: string;
  duration?: number;
  fps?: number;
  resolution?: string;
  aspectRatio?: string;
  watermark?: boolean;
  cameraFixed?: boolean;
  batchCount?: number;
}

export type AppMode = "single" | "automation";

export interface GenerateResponse {
  success: boolean;
  video?: string;
  videos?: string[];
  error?: string;
  task_id?: string;
  task_ids?: string[];
  status?: string;
}

export interface ImageFile {
  id: string;
  file: File;
  preview: string;
  name: string;
  lastFrameImage?: string;
  lastFrameFileName?: string;
  prompt?: string;
  duration?: number;
  fps?: number;
  resolution?: string;
  aspectRatio?: string;
  watermark?: boolean;
  cameraFixed?: boolean;
  pose?: string;
  clothing?: string;
  action?: string;
  startEmotion?: string;
  endEmotion?: string;
}

export interface VideoTask {
  id: string;
  imageName: string;
  imagePreview: string;
  status: "pending" | "processing" | "completed" | "failed";
  video?: string;
  error?: string;
  progress?: number;
  generatedFileName?: string;
}

export interface FolderPair {
  inputPath: string;
  outputPath: string;
  prompt?: string;
  endpointIndex?: number | "auto";
  videosPerClip?: number;
  idleTargetCount?: number;
  ignoreExistingOutput?: boolean;
  targetEmotions?: string[];
  targetClothing?: "all" | "clothed" | "naked";
  targetTransition?: "all" | "same" | "toneutral";
}

export interface AutomationRunResult {
  success: boolean;
  jobIds?: string[];
  queued?: number;
  queuedVideos?: number;
  endpoint?: number;
  acceptedRows?: Array<{
    rowIndex: number;
    queued: number;
    queuedVideos?: number;
    endpoint: number;
  }>;
  rejectedRows?: Array<{ rowIndex: number; reason: string }>;
  endpointCounts?: Record<string, number>;
  endpointVideoCounts?: Record<string, number>;
  targetFilters?: {
    emotions?: string[];
    clothing?: string[];
    transition?: string;
  };
  noNewJobs?: boolean;
  message?: string;
  error?: string;
}

export interface AutomationScanResult {
  success: boolean;
  root?: string;
  poses?: Record<string, Record<string, Record<string, { imagePath: string }>>>;
  warnings?: string[];
  error?: string;
  structure?: string;
  planned?: {
    total?: number;
    videoTotal?: number;
    idle?: number;
    idleVideos?: number;
    speakTotal?: number;
    speakVideos?: number;
    speakByEmotion?: Record<string, number>;
    byClothing?: Record<
      "Clothed" | "Naked",
      {
        jobs?: number;
        clips?: number;
        idleJobs?: number;
        idleClips?: number;
        speakJobs?: number;
        speakClips?: number;
      }
    >;
  };
  filters?: {
    emotions?: string[];
    clothing?: string[];
    transition?: string;
  };
  scans?: Array<{
    rowIndex: number;
    root?: string;
    endpoint?: number;
    endpointMode?: "auto" | "fixed";
    poses?: string[];
    planned?: {
      total?: number;
      videoTotal?: number;
      idle?: number;
      idleVideos?: number;
      speakTotal?: number;
      speakVideos?: number;
      speakByEmotion?: Record<string, number>;
      byClothing?: Record<
        "Clothed" | "Naked",
        {
          jobs?: number;
          clips?: number;
          idleJobs?: number;
          idleClips?: number;
          speakJobs?: number;
          speakClips?: number;
        }
      >;
    };
    filters?: {
      emotions?: string[];
      clothing?: string[];
      transition?: string;
    };
    warningsCount?: number;
    error?: string;
  }>;
  endpointSummary?: Record<
    string,
    {
      rows: number;
      jobs: number;
      clips: number;
      idleJobs: number;
      idleClips: number;
      speakJobs: number;
      speakClips: number;
      clothedJobs: number;
      clothedClips: number;
      nakedJobs: number;
      nakedClips: number;
    }
  >;
  totals?: {
    rows: number;
    successRows: number;
    errorRows: number;
    jobs: number;
    clips: number;
    idleJobs: number;
    idleClips: number;
    speakJobs: number;
    speakClips: number;
    clothedJobs: number;
    clothedClips: number;
    nakedJobs: number;
    nakedClips: number;
  };
}

export interface AutomationJobStatus {
  status: string;
  error?: string;
  result?: { videos?: string[] };
}

export interface AutomationQueueStatus {
  queue: number;
  pending: number;
  processing: boolean;
  paused?: boolean;
  currentJobId?: string | null;
}

export interface AutomationQueuesStatus {
  queues: AutomationQueueStatus[];
}

export interface AutomationQueueControlResult {
  success?: boolean;
  action?: "pause" | "resume" | "stop";
  message?: string;
  error?: string;
  queuedStopped?: number;
  processingStopRequested?: number;
}
