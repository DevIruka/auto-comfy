export function registerSeedanceRoutes({
  app,
  axios,
  BYTEPLUS_API_BASE,
  ARK_API_KEY,
  MODEL_ID,
  CURRENT_MODEL_NAME,
  MODEL_NAMES,
  MODEL_IDS_REVERSE,
}) {
  const POLL_INTERVAL_MS = 5000;
  const MAX_POLL_ATTEMPTS = (() => {
    const n = Number(process.env.SEEDANCE_POLL_MAX_ATTEMPTS);
    return Number.isFinite(n) && n >= 30 ? Math.floor(n) : 180;
  })();
  const MAX_CONSECUTIVE_ERRORS = 5;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const createContentArray = (firstFrame, lastFrame, fullPrompt) => {
    const content = [
      { type: "text", text: fullPrompt },
      {
        type: "image_url",
        image_url: { url: firstFrame },
        role: "first_frame",
      },
    ];

    if (lastFrame) {
      content.push({
        type: "image_url",
        image_url: { url: lastFrame },
        role: "last_frame",
      });
    }

    return content;
  };

  const getDisplayModelName = (responseModelName) => {
    const responseModelId = MODEL_IDS_REVERSE[responseModelName] || responseModelName;
    return {
      responseModelId,
      displayName: MODEL_NAMES[responseModelId] || responseModelName,
    };
  };

  const pollTaskStatusDetailed = async (taskId, label = "") => {
    let attempt = 1;
    let consecutiveErrors = 0;
    const logPrefix = label ? `[${label}]` : `[${taskId.slice(0, 8)}]`;

    while (attempt <= MAX_POLL_ATTEMPTS) {
      try {
        console.log(`${logPrefix} polling status ${attempt}/${MAX_POLL_ATTEMPTS}...`);

        const statusResponse = await axios.get(
          `${BYTEPLUS_API_BASE}/api/v3/contents/generations/tasks/${taskId}`,
          {
            headers: { Authorization: `Bearer ${ARK_API_KEY}` },
            timeout: 30000,
          }
        );

        const statusData = statusResponse.data;
        consecutiveErrors = 0;

        console.log(`${logPrefix} task status: ${statusData.status}`);

        if (statusData.model) {
          const { responseModelId, displayName } = getDisplayModelName(statusData.model);
          console.log(`${logPrefix} response model: ${displayName} (${statusData.model})`);

          if (responseModelId !== MODEL_ID && statusData.model !== MODEL_ID) {
            console.warn(`${logPrefix} model mismatch`);
            console.warn(`${logPrefix} requested: ${CURRENT_MODEL_NAME} (${MODEL_ID})`);
            console.warn(`${logPrefix} actual: ${displayName} (${statusData.model})`);
          }
        }

        if (statusData.status === "succeeded" && statusData.content?.video_url) {
          return {
            success: true,
            video: statusData.content.video_url,
            model: statusData.model,
            modelName: MODEL_NAMES[statusData.model] || statusData.model,
          };
        }

        if (statusData.status === "failed") {
          return {
            success: false,
            error: statusData.error || "Video generation failed.",
          };
        }

        await sleep(POLL_INTERVAL_MS);
        attempt++;
      } catch (statusError) {
        consecutiveErrors++;
        const errorMsg = statusError.response?.data?.message || statusError.message;

        console.error(
          `${logPrefix} status poll error (attempt ${attempt}, consecutive ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
          errorMsg
        );

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return {
            success: false,
            error: `Status polling failed repeatedly: ${errorMsg}`,
          };
        }

        const waitTime = statusError.response?.status === 429 ? POLL_INTERVAL_MS * 2 : POLL_INTERVAL_MS;
        await sleep(waitTime);
        attempt++;
      }
    }

    return {
      success: false,
      error: `Task did not complete within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000} seconds.`,
    };
  };

  async function pollSeedanceTaskStatus(taskId, modelIdForLog = "") {
    let attempt = 1;
    let consecutiveErrors = 0;
    const logPrefix = modelIdForLog ? `[Q${modelIdForLog}]` : `[${taskId?.slice(0, 8)}]`;

    while (attempt <= MAX_POLL_ATTEMPTS) {
      try {
        const statusResponse = await axios.get(
          `${BYTEPLUS_API_BASE}/api/v3/contents/generations/tasks/${taskId}`,
          {
            headers: { Authorization: `Bearer ${ARK_API_KEY}` },
            timeout: 30000,
          }
        );

        const data = statusResponse.data;
        consecutiveErrors = 0;

        if (data.status === "succeeded" && data.content?.video_url) {
          return { success: true, video: data.content.video_url, model: data.model };
        }

        if (data.status === "failed") {
          return { success: false, error: data.error || "Video generation failed." };
        }

        await sleep(POLL_INTERVAL_MS);
        attempt++;
      } catch (error) {
        consecutiveErrors++;
        const msg = error.response?.data?.message || error.message;

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { success: false, error: `Polling error: ${msg}` };
        }

        await sleep(POLL_INTERVAL_MS);
        attempt++;
      }
    }

    return { success: false, error: "Polling timeout." };
  }

  async function runSeedanceJobWithModel(modelId, params) {
    const {
      firstFrameImage,
      lastFrameImage,
      prompt = "",
      duration = 5,
      aspectRatio = "9:16",
      watermark = false,
      batchCount = 1,
      generate_audio = false,
    } = params;

    const fullPrompt = prompt || "Generate a video from this image";
    const requestBody = {
      model: modelId,
      content: createContentArray(firstFrameImage, lastFrameImage, fullPrompt),
      generate_audio,
      ratio: aspectRatio === "adaptive" ? "adaptive" : aspectRatio,
      duration: Number(duration) || 5,
      watermark: !!watermark,
    };

    if (batchCount > 1) {
      const taskIds = [];

      for (let i = 0; i < batchCount; i++) {
        try {
          const res = await axios.post(
            `${BYTEPLUS_API_BASE}/api/v3/contents/generations/tasks`,
            requestBody,
            {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${ARK_API_KEY}`,
              },
              timeout: 120000,
            }
          );

          if (res.data?.id) taskIds.push(res.data.id);
          if (i < batchCount - 1) await sleep(1000);
        } catch (error) {
          const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
          console.error(`Batch create failed at item ${i + 1}:`, error.message, detail);
        }
      }

      const results = await Promise.all(taskIds.map((id) => pollSeedanceTaskStatus(id, modelId)));
      const videos = results.filter((r) => r.success && r.video).map((r) => r.video);
      return { success: videos.length > 0, videos, results };
    }

    const res = await axios.post(
      `${BYTEPLUS_API_BASE}/api/v3/contents/generations/tasks`,
      requestBody,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ARK_API_KEY}`,
        },
        timeout: 120000,
      }
    );

    if (!res.data?.id) {
      return { success: false, error: "No task id returned from API." };
    }

    const result = await pollSeedanceTaskStatus(res.data.id, modelId);

    return result.success
      ? { success: true, video: result.video, videos: [result.video] }
      : { success: false, error: result.error };
  }

  app.post("/generate", async (req, res) => {
    try {
      const {
        firstFrameImage,
        lastFrameImage,
        prompt = "",
        duration = 5,
        fps = 24,
        resolution = "720p",
        aspectRatio = "9:16",
        watermark = false,
        cameraFixed = true,
        batchCount = 1,
        generate_audio = false,
      } = req.body;

      if (!firstFrameImage) {
        return res.status(400).json({ error: "firstFrameImage is required." });
      }

      if (!ARK_API_KEY) {
        return res.status(500).json({ error: "ARK_API_KEY is not configured." });
      }

      console.log(
        `[Seedance] generate request: duration=${duration}s fps=${fps} resolution=${resolution} ratio=${aspectRatio} watermark=${watermark} cameraFixed=${cameraFixed} batchCount=${batchCount} audio=${generate_audio}`
      );
      console.log(`[Seedance] requested model: ${CURRENT_MODEL_NAME} (${MODEL_ID})`);

      const fullPrompt = prompt || "Generate a video from this image";
      const requestBody = {
        model: MODEL_ID,
        content: createContentArray(firstFrameImage, lastFrameImage, fullPrompt),
        generate_audio,
        ratio: aspectRatio === "adaptive" ? "adaptive" : aspectRatio,
        duration,
        watermark,
      };

      if (batchCount > 1) {
        const requestDelay = 1000;
        const taskIds = [];

        for (let i = 0; i < batchCount; i++) {
          try {
            const requestStartTime = Date.now();

            const response = await axios.post(
              `${BYTEPLUS_API_BASE}/api/v3/contents/generations/tasks`,
              requestBody,
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${ARK_API_KEY}`,
                },
                timeout: 120000,
              }
            );

            const requestDuration = ((Date.now() - requestStartTime) / 1000).toFixed(1);
            if (response.data.id) {
              taskIds.push({ id: response.data.id, index: i + 1 });
              console.log(`[Batch ${i + 1}] created in ${requestDuration}s: ${response.data.id}`);
            }

            if (i < batchCount - 1) {
              await sleep(requestDelay);
            }
          } catch (error) {
            console.error(
              `[Batch ${i + 1}] create failed:`,
              error.response?.data || error.message
            );
          }
        }

        if (taskIds.length === 0) {
          return res.status(500).json({
            success: false,
            error: "Failed to create all batch tasks.",
          });
        }

        const results = await Promise.all(
          taskIds.map(({ id, index }) => pollTaskStatusDetailed(id, `Batch${index}`))
        );

        const videos = results
          .filter((result) => result.success && result.video)
          .map((result) => result.video);

        const modelInfo = results
          .filter((result) => result.success && result.model)
          .map((result) => ({ model: result.model, modelName: result.modelName }));

        if (videos.length > 0) {
          return res.json({
            success: true,
            videos,
            totalRequested: batchCount,
            successCount: videos.length,
            requestedModel: CURRENT_MODEL_NAME,
            requestedModelId: MODEL_ID,
            usedModels: modelInfo,
          });
        }

        return res.status(500).json({
          success: false,
          error: "All batch videos failed.",
          results: results.map((r) => r.error),
        });
      }

      const apiUrl = `${BYTEPLUS_API_BASE}/api/v3/contents/generations/tasks`;
      const requestStartTime = Date.now();
      const waitingInterval = setInterval(() => {
        const elapsed = ((Date.now() - requestStartTime) / 1000).toFixed(0);
        console.log(`[Single] waiting API response... ${elapsed}s elapsed`);
      }, 10000);

      try {
        const response = await axios.post(apiUrl, requestBody, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ARK_API_KEY}`,
          },
          timeout: 120000,
        });

        clearInterval(waitingInterval);

        if (response.data.model) {
          const { responseModelId, displayName } = getDisplayModelName(response.data.model);
          console.log(`[Single] response model: ${displayName} (${response.data.model})`);

          if (responseModelId !== MODEL_ID && response.data.model !== MODEL_ID) {
            console.warn("[Single] model mismatch");
            console.warn(`requested: ${CURRENT_MODEL_NAME} (${MODEL_ID})`);
            console.warn(`actual: ${displayName} (${response.data.model})`);
          }
        }

        if (response.data.id) {
          const result = await pollTaskStatusDetailed(response.data.id, "Single");
          return res.json({
            ...result,
            requestedModel: CURRENT_MODEL_NAME,
            requestedModelId: MODEL_ID,
          });
        }

        return res.json(response.data);
      } catch (axiosError) {
        clearInterval(waitingInterval);
        throw axiosError;
      }
    } catch (error) {
      console.error("Seedance API error", {
        name: error.constructor?.name,
        message: error.message,
        code: error.code,
        status: error.response?.status,
        data: error.response?.data,
      });

      if (error.response) {
        return res.status(error.response.status).json({
          error: "Seedance API error",
          details: error.response.data,
          status: error.response.status,
        });
      }

      if (error.code === "ECONNABORTED") {
        return res.status(504).json({
          error: "Request timeout",
          details: "BytePlus API did not respond in time.",
          code: error.code,
        });
      }

      return res.status(500).json({
        error: "Internal server error",
        details: error.message,
        code: error.code,
      });
    }
  });

  return { runSeedanceJobWithModel };
}
