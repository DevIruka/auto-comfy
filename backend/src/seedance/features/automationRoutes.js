import {
  buildSpeakTargets,
  normalizeTargetClothing,
  normalizeTargetEmotions,
  normalizeTargetTransition,
} from "../automation-filters.js";
import {
  AUTOMATION_CLOTHING,
  AUTOMATION_EMOTIONS,
  AUTOMATION_IMAGE_EXT,
  AUTOMATION_POSES,
  IDLE_PER_PROMPT_MAX,
} from "./automation/constants.js";
import { createAutomationStructureUtils } from "./automation/structureUtils.js";
import { createAutomationOutputUtils } from "./automation/outputUtils.js";
import { createAutomationPromptUtils } from "./automation/promptUtils.js";
import { buildAutomationScanResult } from "./automation/scanInput.js";
import { buildAutomationPlanFromPoses, resolveAutomationOutputBasePath, resolveIdlePerPrompt } from "./automation/planUtils.js";
import { queueAutomationJobsForPair } from "./automation/runPlanner.js";

export function registerAutomationRoutes({
  app,
  fs,
  path,
  axios,
  setImmediate,
  runSeedanceJobWithModel,
  SEEDANCE_MODEL_IDS,
  ARK_API_KEY,
  emotionConfigPath,
}) {
  const seedanceQueues = [[], [], []];
  const seedanceQueueProcessing = [false, false, false];
  const seedanceQueuePaused = [false, false, false];
  const seedanceQueueCurrentJobId = [null, null, null];
  const seedanceJobs = {};
  let seedanceJobIdCounter = 0;

  const AUTOMATION_FAILURE_RETRY_DELAY_MS = 5000;
  const AUTOMATION_JOB_MAX_ATTEMPTS = (() => {
    const raw = process.env.SEEDANCE_AUTOMATION_MAX_ATTEMPTS_PER_JOB;
    if (raw === undefined || raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  })();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const {
    getFirstImageInFolder,
    getAllImagesInFolder,
    isNakedByFilename,
    getPoseFromFilename,
    dropEmptyPoses,
    listEmotionFoldersUnder,
    findClothingSubdir,
  } = createAutomationStructureUtils({
    fs,
    path,
    AUTOMATION_CLOTHING,
    AUTOMATION_EMOTIONS,
    AUTOMATION_IMAGE_EXT,
  });

  const {
    createEmptyExistingOutputState,
    getSourceKeyFromImagePath,
    buildIdleExistingKey,
    buildSpeakExistingKey,
    scanOutputForExisting,
    saveAutomationVideosToOutput,
  } = createAutomationOutputUtils({
    fs,
    path,
    axios,
    AUTOMATION_POSES,
    AUTOMATION_EMOTIONS,
  });

  const {
    loadEmotionConfig,
    listIdlePrompts,
    buildPromptIdle,
    buildPromptIdleById,
    buildPromptSpeakNatural,
  } = createAutomationPromptUtils({
    fs,
    emotionConfigPath,
  });

  function parseEndpoint(value) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 3) return parsed;
    return null;
  }

  /**
   * Normalize a selectedIdlePrompts request value against the configured pool.
   * - undefined/null → all available prompt ids (default-all behavior).
   * - array → keep only valid ids, preserving config order; [] stays [] (0 idle).
   */
  function normalizeSelectedIdlePrompts(value, config) {
    const allIds = listIdlePrompts(config).map((p) => p.id);
    if (value === undefined || value === null) return allIds;
    if (!Array.isArray(value)) return allIds;
    const requested = new Set(value.map((v) => String(v)));
    return allIds.filter((id) => requested.has(id));
  }

  function pickAutoEndpoint() {
    let selected = 1;
    let minLoad = seedanceQueues[0].length + (seedanceQueueProcessing[0] ? 1 : 0);
    for (let i = 1; i < seedanceQueues.length; i += 1) {
      const load = seedanceQueues[i].length + (seedanceQueueProcessing[i] ? 1 : 0);
      if (load < minLoad) {
        minLoad = load;
        selected = i + 1;
      }
    }
    return selected;
  }

  function nextJobId() {
    seedanceJobIdCounter += 1;
    return `seedance-${Date.now()}-${seedanceJobIdCounter}`;
  }

  function readImageAsBase64(filePath) {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  function isAutomationQueuedJob(jobMeta) {
    return (
      jobMeta &&
      (jobMeta.type === "idle" || jobMeta.type === "speaknatural")
    );
  }

  /** Build API payload from queue item (paths → base64 each time; avoids stale handles after retries). */
  function prepareRunPayloadFromQueuedJob(queuedJob) {
    const runPayload = { ...queuedJob };
    delete runPayload.jobId;
    if (!runPayload.firstFrameImage && runPayload.firstFramePath) {
      runPayload.firstFrameImage = readImageAsBase64(runPayload.firstFramePath);
    }
    if (!runPayload.lastFrameImage && runPayload.lastFramePath) {
      runPayload.lastFrameImage = readImageAsBase64(runPayload.lastFramePath);
    }
    delete runPayload.firstFramePath;
    delete runPayload.lastFramePath;
    return runPayload;
  }

  function enqueueAutomationJob({
    queueIndex,
    endpoint,
    rowIndex,
    type,
    pose,
    clothing,
    sourceKey,
    idleIndex,
    emotionFrom,
    emotionTo,
    outputPath,
    outputPathBase,
    ignoreExistingOutput,
    prompt,
    firstFramePath,
    lastFramePath,
    firstFrameImage,
    lastFrameImage,
    duration,
    aspectRatio,
    watermark,
    batchCount,
    uncensored,
  }) {
    const jobId = nextJobId();
    const retryPayload = {
      firstFramePath: firstFramePath || undefined,
      lastFramePath: lastFramePath || undefined,
      firstFrameImage,
      lastFrameImage,
      prompt,
      duration,
      aspectRatio,
      watermark,
      batchCount,
      generate_audio: false,
    };

    seedanceJobs[jobId] = {
      status: "queued",
      queueIndex: endpoint,
      rowIndex,
      type,
      pose,
      clothing,
      sourceKey: sourceKey || "",
      uncensored: Boolean(uncensored),
      idleIndex,
      emotionFrom,
      emotionTo,
      outputPath: outputPath || null,
      outputPathBase: outputPathBase || outputPath || null,
      ignoreExistingOutput: Boolean(ignoreExistingOutput),
      retryPayload,
      createdAt: new Date().toISOString(),
    };

    seedanceQueues[queueIndex].push({
      jobId,
      ...retryPayload,
    });

    setImmediate(() => processSeedanceQueue(queueIndex));
    return jobId;
  }

  function processSeedanceQueue(queueIndex) {
    if (seedanceQueuePaused[queueIndex]) return;
    if (seedanceQueueProcessing[queueIndex] || seedanceQueues[queueIndex].length === 0) return;

    const job = seedanceQueues[queueIndex].shift();
    if (!job) return;

    const jobId = job.jobId;
    const modelId = SEEDANCE_MODEL_IDS[queueIndex];
    seedanceQueueProcessing[queueIndex] = true;
    seedanceQueueCurrentJobId[queueIndex] = jobId;
    if (seedanceJobs[jobId]) seedanceJobs[jobId].status = "processing";

    const finishQueueSlot = () => {
      seedanceQueueProcessing[queueIndex] = false;
      seedanceQueueCurrentJobId[queueIndex] = null;
      setImmediate(() => processSeedanceQueue(queueIndex));
    };

    (async () => {
      const jobMeta = seedanceJobs[jobId];
      const automationJob = isAutomationQueuedJob(jobMeta);

      const applyStopState = () => {
        if (!jobMeta) return;
        jobMeta.status = "stopped";
        jobMeta.error = "force-stopped";
        jobMeta.result = undefined;
        jobMeta.stoppedAt = new Date().toISOString();
      };

      let runPayload;
      try {
        runPayload = prepareRunPayloadFromQueuedJob(job);
      } catch (error) {
        if (jobMeta && !jobMeta.stopRequested) {
          jobMeta.status = "failed";
          jobMeta.error = error.message || String(error);
        } else if (jobMeta) applyStopState();
        return;
      }

      if (!runPayload.firstFrameImage) {
        if (jobMeta && !jobMeta.stopRequested) {
          jobMeta.status = "failed";
          jobMeta.error = "firstFrameImage or firstFramePath is required.";
        } else if (jobMeta) applyStopState();
        return;
      }

      const runOneAttempt = () => runSeedanceJobWithModel(modelId, runPayload);

      if (!automationJob) {
        try {
          if (jobMeta?.stopRequested) {
            applyStopState();
            return;
          }
          const result = await runOneAttempt();
          if (!jobMeta) return;
          if (jobMeta.stopRequested) {
            applyStopState();
            return;
          }
          jobMeta.status = result.success ? "done" : "failed";
          const videos = result.success
            ? result.videos || (result.video ? [result.video] : [])
            : [];
          jobMeta.result = result.success ? { videos } : undefined;
          jobMeta.error = result.success ? undefined : result.error;
        } catch (error) {
          if (jobMeta && !jobMeta.stopRequested) {
            jobMeta.status = "failed";
            jobMeta.error = error.message || String(error);
          } else if (jobMeta) applyStopState();
        }
        return;
      }

      let attempt = 0;
      while (true) {
        attempt += 1;
        if (!jobMeta) return;
        if (jobMeta.stopRequested) {
          applyStopState();
          return;
        }
        if (AUTOMATION_JOB_MAX_ATTEMPTS > 0 && attempt > AUTOMATION_JOB_MAX_ATTEMPTS) {
          jobMeta.status = "failed";
          jobMeta.error =
            jobMeta.error ||
            `Exceeded SEEDANCE_AUTOMATION_MAX_ATTEMPTS_PER_JOB (${AUTOMATION_JOB_MAX_ATTEMPTS}).`;
          return;
        }

        jobMeta.status = attempt > 1 ? "retrying" : "processing";
        if (attempt > 1) {
          jobMeta.automationAttempt = attempt;
          console.warn(
            `[automation] job ${jobId} retry ${attempt}${AUTOMATION_JOB_MAX_ATTEMPTS ? `/${AUTOMATION_JOB_MAX_ATTEMPTS}` : ""}${jobMeta.error ? `: last error ${jobMeta.error}` : ""}`,
          );
        }

        try {
          const result = await runOneAttempt();
          if (!jobMeta) return;
          if (jobMeta.stopRequested) {
            applyStopState();
            return;
          }
          if (result.success) {
            const videos = result.videos || (result.video ? [result.video] : []);
            jobMeta.status = "done";
            jobMeta.result = { videos };
            jobMeta.error = undefined;
            jobMeta.automationAttempt = attempt;
            if (jobMeta.outputPath && videos.length > 0) {
              const savedPaths = await saveAutomationVideosToOutput(
                jobMeta.outputPath,
                jobMeta,
                videos,
              );
              jobMeta.savedPaths = savedPaths;
            }
            return;
          }

          jobMeta.error = result.error || "Generation failed.";
          console.warn(`[automation] job ${jobId} attempt ${attempt} failed:`, jobMeta.error);
        } catch (error) {
          if (!jobMeta) return;
          if (jobMeta.stopRequested) {
            applyStopState();
            return;
          }
          jobMeta.error = error.message || String(error);
          console.warn(`[automation] job ${jobId} attempt ${attempt} threw:`, jobMeta.error);
        }

        await sleep(AUTOMATION_FAILURE_RETRY_DELAY_MS);
      }
    })()
      .catch((error) => {
        const jobMeta = seedanceJobs[jobId];
        if (jobMeta && !jobMeta.stopRequested) {
          jobMeta.status = "failed";
          jobMeta.error = error.message || String(error);
        } else if (jobMeta) {
          jobMeta.status = "stopped";
          jobMeta.error = "force-stopped";
          jobMeta.stoppedAt = new Date().toISOString();
        }
      })
      .finally(finishQueueSlot);
  }

  [0, 1, 2].forEach((queueIndex) => {
    setInterval(() => processSeedanceQueue(queueIndex), 2000);
  });

  app.post("/generate-queued", (req, res) => {
    try {
      const { endpointIndex, ...body } = req.body;
      const idx = endpointIndex === undefined ? 1 : Number(endpointIndex);

      if (!Number.isInteger(idx) || idx < 1 || idx > 3) {
        return res.status(400).json({ error: "endpointIndex must be 1, 2, or 3." });
      }
      if (!body.firstFrameImage) {
        return res.status(400).json({ error: "firstFrameImage is required." });
      }
      if (!ARK_API_KEY) {
        return res.status(500).json({ error: "API key is not configured." });
      }

      const queueIndex = idx - 1;
      const jobId = nextJobId();
      seedanceJobs[jobId] = {
        status: "queued",
        queueIndex: idx,
        retryPayload: body,
        createdAt: new Date().toISOString(),
      };
      seedanceQueues[queueIndex].push({ jobId, ...body });

      setImmediate(() => processSeedanceQueue(queueIndex));
      return res.json({ queued: true, queue: idx, jobId });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.get("/queues", (req, res) => {
    res.json({
      queues: [0, 1, 2].map((idx) => ({
        queue: idx + 1,
        pending: seedanceQueues[idx].length,
        processing: seedanceQueueProcessing[idx],
        paused: seedanceQueuePaused[idx],
        currentJobId: seedanceQueueCurrentJobId[idx],
      })),
    });
  });

  app.post("/queue-control", (req, res) => {
    try {
      const { action, queue } = req.body || {};
      if (!["pause", "resume", "stop"].includes(action)) {
        return res.status(400).json({ success: false, error: "action must be pause, resume, or stop" });
      }

      const targetQueueIndices =
        queue === undefined || queue === null
          ? [0, 1, 2]
          : (() => {
              const q = Number(queue);
              if (!Number.isInteger(q) || q < 1 || q > 3) return null;
              return [q - 1];
            })();

      if (!targetQueueIndices) {
        return res.status(400).json({ success: false, error: "queue must be 1, 2, or 3" });
      }

      if (action === "pause") {
        targetQueueIndices.forEach((idx) => {
          seedanceQueuePaused[idx] = true;
        });
        return res.json({
          success: true,
          action,
          message: `Paused queue(s): ${targetQueueIndices.map((idx) => idx + 1).join(", ")}`,
        });
      }

      if (action === "resume") {
        targetQueueIndices.forEach((idx) => {
          seedanceQueuePaused[idx] = false;
          setImmediate(() => processSeedanceQueue(idx));
        });
        return res.json({
          success: true,
          action,
          message: `Resumed queue(s): ${targetQueueIndices.map((idx) => idx + 1).join(", ")}`,
        });
      }

      let queuedStopped = 0;
      let processingStopRequested = 0;

      targetQueueIndices.forEach((idx) => {
        for (const queuedJob of seedanceQueues[idx]) {
          const jobMeta = seedanceJobs[queuedJob.jobId];
          if (jobMeta) {
            jobMeta.status = "stopped";
            jobMeta.error = "force-stopped";
            jobMeta.stoppedAt = new Date().toISOString();
          }
          queuedStopped += 1;
        }
        seedanceQueues[idx].length = 0;

        const processingJobId = seedanceQueueCurrentJobId[idx];
        if (processingJobId && seedanceJobs[processingJobId]) {
          seedanceJobs[processingJobId].stopRequested = true;
          processingStopRequested += 1;
        }
      });

      return res.json({
        success: true,
        action,
        queuedStopped,
        processingStopRequested,
        message: `Force stop applied. queued=${queuedStopped}, processingRequested=${processingStopRequested}`,
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.get("/job/:jobId", (req, res) => {
    const job = seedanceJobs[req.params.jobId];
    if (!job) return res.status(404).json({ error: "Job not found." });
    return res.json(job);
  });

  app.get("/automation/idle-prompts", (req, res) => {
    try {
      const config = loadEmotionConfig();
      if (!config) {
        return res
          .status(500)
          .json({ success: false, error: "Failed to load emotion-config-optimized.json." });
      }
      return res.json({ success: true, prompts: listIdlePrompts(config) });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.post("/automation/scan", (req, res) => {
    try {
      const {
        inputPath,
        outputPath,
        outputRootPath = "",
        autoOutputByCharacter = false,
        endpointIndex,
        targetEmotions,
        targetClothing = "all",
        targetTransition = "all",
        ignoreExistingOutput = false,
        videosPerClip = 1,
        idleTargetCount,
        selectedIdlePrompts,
        applyCommonToNaked = false,
      } = req.body || {};

      if (!inputPath || typeof inputPath !== "string") {
        return res.status(400).json({ error: "inputPath is required." });
      }

      const root = path.resolve(inputPath);
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        return res.status(400).json({ error: "inputPath must be an existing directory." });
      }

      const scanConfig = loadEmotionConfig();
      const allIdlePrompts = listIdlePrompts(scanConfig).map((p) => p.id);
      const normalizedIdlePrompts = normalizeSelectedIdlePrompts(
        selectedIdlePrompts,
        scanConfig,
      );

      const batchCount = Math.min(5, Math.max(1, Number(videosPerClip) || 1));
      const idlePerPrompt = resolveIdlePerPrompt({
        idleTargetCount,
        batchCount,
        IDLE_PER_PROMPT_MAX,
      });
      const selectedEmotions = normalizeTargetEmotions(
        targetEmotions,
        AUTOMATION_EMOTIONS,
      );
      const selectedClothing = normalizeTargetClothing(
        targetClothing,
        AUTOMATION_CLOTHING,
      );
      const normalizedTransition = normalizeTargetTransition(targetTransition);
      const resolvedOutputBase = resolveAutomationOutputBasePath({
        path,
        outputPath,
        inputPath,
        outputRootPath,
        autoOutputByCharacter: Boolean(autoOutputByCharacter),
      });
      const existingOutput = ignoreExistingOutput
        ? createEmptyExistingOutputState()
        : scanOutputForExisting(resolvedOutputBase);

      const scanResult = buildAutomationScanResult({
        fs,
        path,
        root,
        AUTOMATION_POSES,
        AUTOMATION_CLOTHING,
        AUTOMATION_EMOTIONS,
        getFirstImageInFolder,
        getAllImagesInFolder,
        isNakedByFilename,
        getPoseFromFilename,
        dropEmptyPoses,
        listEmotionFoldersUnder,
        findClothingSubdir,
      });

      const planned = buildAutomationPlanFromPoses({
        poses: scanResult.poses,
        selectedClothing,
        selectedEmotions,
        targetTransition: normalizedTransition,
        existingOutput,
        idlePerPrompt,
        allIdlePrompts,
        selectedIdlePrompts: normalizedIdlePrompts,
        applyCommonToNaked: Boolean(applyCommonToNaked),
        batchCount,
        AUTOMATION_POSES,
        AUTOMATION_EMOTIONS,
        buildSpeakTargets,
        getSourceKeyFromImagePath,
        buildIdleExistingKey,
        buildSpeakExistingKey,
      });

      return res.json({
        success: true,
        root,
        ...scanResult,
        planned,
        filters: {
          clothing: selectedClothing,
          emotions: selectedEmotions,
          transition: normalizedTransition,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  app.post("/automation/run", (req, res) => {
    try {
      const {
        folderPairs,
        prefixPrompt = "",
        videosPerClip = 1,
        idleTargetCount,
        ignoreExistingOutput = false,
        targetEmotions,
        targetClothing = "all",
        targetTransition = "all",
        endpointIndex = 0,
        outputRootPath = "",
        autoOutputByCharacter = false,
        duration = 5,
        aspectRatio = "9:16",
        watermark = false,
      } = req.body || {};

      if (!folderPairs || !Array.isArray(folderPairs) || folderPairs.length === 0) {
        return res.status(400).json({ error: "folderPairs is required and must include at least one row." });
      }
      if (!ARK_API_KEY) {
        return res.status(500).json({ error: "API key is not configured." });
      }

      const config = loadEmotionConfig();
      if (!config) {
        return res.status(500).json({ error: "Failed to load emotion-config-optimized.json." });
      }

      const batchCount = Math.min(5, Math.max(1, Number(videosPerClip) || 1));
      const allIdlePrompts = listIdlePrompts(config).map((p) => p.id);
      const selectedEmotions = normalizeTargetEmotions(targetEmotions, AUTOMATION_EMOTIONS);
      const selectedClothing = normalizeTargetClothing(targetClothing, AUTOMATION_CLOTHING);
      const normalizedTransition = normalizeTargetTransition(targetTransition);

      const jobIds = [];
      const acceptedRows = [];
      const rejectedRows = [];
      const endpointCounts = { "1": 0, "2": 0, "3": 0 };
      const endpointVideoCounts = { "1": 0, "2": 0, "3": 0 };

      for (let rowIndex = 0; rowIndex < folderPairs.length; rowIndex += 1) {
        const pair = folderPairs[rowIndex] || {};
        const inputPath = typeof pair.inputPath === "string" ? pair.inputPath.trim() : "";
        const outputPath = typeof pair.outputPath === "string" ? pair.outputPath.trim() : "";
        const rowPrompt = (typeof pair.prompt === "string" ? pair.prompt : "").trim();
        const rowBatchCount = Math.min(
          5,
          Math.max(1, Number(pair.videosPerClip ?? batchCount) || 1),
        );
        const rowSelectedIdlePrompts = normalizeSelectedIdlePrompts(
          pair.selectedIdlePrompts ?? req.body?.selectedIdlePrompts,
          config,
        );
        const rowIdlePerPrompt = resolveIdlePerPrompt({
          idleTargetCount: pair.idleTargetCount ?? idleTargetCount,
          batchCount: rowBatchCount,
          IDLE_PER_PROMPT_MAX,
        });
        const rowApplyCommonToNaked =
          typeof pair.applyCommonToNaked === "boolean"
            ? pair.applyCommonToNaked
            : Boolean(req.body?.applyCommonToNaked);
        const rowSelectedEmotions = normalizeTargetEmotions(
          pair.targetEmotions ?? selectedEmotions,
          AUTOMATION_EMOTIONS,
        );
        const rowSelectedClothing = normalizeTargetClothing(
          pair.targetClothing ?? selectedClothing,
          AUTOMATION_CLOTHING,
        );
        const rowTransition = normalizeTargetTransition(
          pair.targetTransition ?? normalizedTransition,
        );
        const rowIgnoreExistingOutput =
          typeof pair.ignoreExistingOutput === "boolean"
            ? pair.ignoreExistingOutput
            : Boolean(ignoreExistingOutput);

        if (!inputPath) {
          rejectedRows.push({ rowIndex, reason: "inputPath is required" });
          continue;
        }
        if (!rowPrompt) {
          rejectedRows.push({ rowIndex, reason: "row prompt is required" });
          continue;
        }

        const root = path.resolve(inputPath);
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
          rejectedRows.push({ rowIndex, reason: "inputPath must be an existing directory" });
          continue;
        }

        const requestedEndpoint = parseEndpoint(pair.endpointIndex) ?? parseEndpoint(endpointIndex);
        const endpoint = requestedEndpoint || pickAutoEndpoint();
        const queueIndex = endpoint - 1;

        const resolvedOutputBase = resolveAutomationOutputBasePath({
          path,
          outputPath,
          inputPath,
          outputRootPath,
          autoOutputByCharacter: Boolean(autoOutputByCharacter),
        });
        const resolvedOutput = resolvedOutputBase;
        const existingOutput = rowIgnoreExistingOutput
          ? createEmptyExistingOutputState()
          : scanOutputForExisting(resolvedOutputBase);

        const rowJobIds = queueAutomationJobsForPair({
          fs,
          path,
          root,
          resolvedOutput,
          prefixPrompt: rowPrompt,
          config,
          batchCount: rowBatchCount,
          idlePerPrompt: rowIdlePerPrompt,
          allIdlePrompts,
          applyCommonToNaked: rowApplyCommonToNaked,
          duration,
          aspectRatio,
          watermark,
          queueIndex,
          endpoint,
          rowIndex,
          selectedClothing: rowSelectedClothing,
          selectedEmotions: rowSelectedEmotions,
          selectedIdlePrompts: rowSelectedIdlePrompts,
          targetTransition: rowTransition,
          existingOutput,
          AUTOMATION_POSES,
          AUTOMATION_CLOTHING,
          AUTOMATION_EMOTIONS,
          getFirstImageInFolder,
          getAllImagesInFolder,
          isNakedByFilename,
          getPoseFromFilename,
          listEmotionFoldersUnder,
          findClothingSubdir,
          buildPromptIdle,
          buildPromptIdleById,
          buildPromptSpeakNatural,
          enqueueAutomationJob: (payload) =>
            enqueueAutomationJob({
              ...payload,
                rowIndex,
                outputPathBase: resolvedOutputBase,
                ignoreExistingOutput: rowIgnoreExistingOutput,
              }),
          getSourceKeyFromImagePath,
          buildIdleExistingKey,
          buildSpeakExistingKey,
        });

        const rowQueuedVideos = rowJobIds.reduce(
          (sum, id) => sum + Number(seedanceJobs[id]?.retryPayload?.batchCount || 1),
          0,
        );
        jobIds.push(...rowJobIds);
        endpointCounts[String(endpoint)] += rowJobIds.length;
        endpointVideoCounts[String(endpoint)] += rowQueuedVideos;
        acceptedRows.push({
          rowIndex,
          queued: rowJobIds.length,
          queuedVideos: rowQueuedVideos,
          endpoint,
        });
      }

      const queuedVideos = jobIds.reduce(
        (sum, id) => sum + Number(seedanceJobs[id]?.retryPayload?.batchCount || 1),
        0,
      );

      const payload = {
        success: jobIds.length > 0,
        jobIds,
        queued: jobIds.length,
        queuedVideos,
        acceptedRows,
        rejectedRows,
        endpointCounts,
        endpointVideoCounts,
        targetFilters: {
          clothing: selectedClothing,
          emotions: selectedEmotions,
          transition: normalizedTransition,
        },
      };

      if (acceptedRows.length === 0) {
        return res.status(400).json({
          ...payload,
          success: false,
          error: "No valid rows to process.",
        });
      }

      if (jobIds.length === 0) {
        const filterHint = `Selected filters(default): clothing(${selectedClothing.join(", ")}) / emotions(${selectedEmotions.join(", ")})`;
        const nakedHint = selectedClothing.includes("Naked")
          ? " Naked detection requires filename to include nude or naked."
          : "";
        const noNewJobsMessage = `No new jobs to enqueue. Existing output may already satisfy selected combinations. ${filterHint}.${nakedHint}`;
        return res.json({
          ...payload,
          success: false,
          noNewJobs: true,
          message: noNewJobsMessage,
          error: noNewJobsMessage,
        });
      }

      return res.json(payload);
    } catch (error) {
      console.error("automation/run error:", error);
      return res.status(500).json({ error: error.message });
    }
  });
}
