import { buildSpeakTargets } from "../../automation-filters.js";

export function resolveIdleTargetCount({
  idleTargetCount,
  batchCount,
  IDLE_PROMPT_VARIANT_COUNT,
  IDLE_PER_PROMPT_MAX,
}) {
  const requested = Number(idleTargetCount);
  const perPrompt = Math.min(
    IDLE_PER_PROMPT_MAX,
    Math.max(1, Number.isFinite(requested) ? requested : batchCount),
  );
  return perPrompt * IDLE_PROMPT_VARIANT_COUNT;
}

export function getInputLeafFolderName(inputPath) {
  const normalized = String(inputPath || "").trim().replace(/[\\/]+$/, "");
  if (!normalized) return "untitled";
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "untitled";
}

export function resolveAutomationOutputBasePath({
  path,
  outputPath,
  inputPath,
  outputRootPath,
  autoOutputByCharacter = false,
}) {
  const explicit = typeof outputPath === "string" ? outputPath.trim() : "";
  if (explicit) return path.resolve(explicit);

  const root = typeof outputRootPath === "string" ? outputRootPath.trim() : "";
  if (!autoOutputByCharacter || !root) return null;

  const leaf = getInputLeafFolderName(inputPath);
  return path.resolve(path.join(root, leaf));
}

export function buildAutomationPlanFromPoses({
  poses,
  selectedClothing,
  selectedEmotions,
  targetTransition,
  existingOutput,
  idleTarget,
  batchCount,
  AUTOMATION_POSES,
  AUTOMATION_EMOTIONS,
  getSourceKeyFromImagePath,
  buildIdleExistingKey,
  buildSpeakExistingKey,
}) {
  const speakByEmotion = Object.fromEntries(
    AUTOMATION_EMOTIONS.map((emotion) => [emotion, 0]),
  );
  let speakTotal = 0;
  let speakVideoTotal = 0;
  let idleJobCount = 0;
  let idleVideoTotal = 0;
  const byClothing = {
    Clothed: { jobs: 0, clips: 0, idleJobs: 0, idleClips: 0, speakJobs: 0, speakClips: 0 },
    Naked: { jobs: 0, clips: 0, idleJobs: 0, idleClips: 0, speakJobs: 0, speakClips: 0 },
  };

  for (const pose of AUTOMATION_POSES) {
    const poseData = poses?.[pose] || {};
    for (const clothing of selectedClothing) {
      const emotionMap = poseData?.[clothing] || {};

      const neutralPath = emotionMap?.Neutral?.imagePath;
      if (selectedEmotions.includes("Neutral") && neutralPath) {
        const sourceKey = getSourceKeyFromImagePath(neutralPath);
        const idleKey = buildIdleExistingKey(pose, clothing, sourceKey);
        let existingIdleCount = existingOutput.idle[idleKey] || 0;
        if (existingIdleCount === 0) {
          const idleKeyBare = buildIdleExistingKey(pose, clothing, "");
          if (idleKeyBare !== idleKey) {
            existingIdleCount = existingOutput.idle[idleKeyBare] || 0;
          }
        }
        const remaining = idleTarget - existingIdleCount;
        if (remaining > 0) {
          const idleJobs = Math.ceil(remaining / batchCount);
          idleJobCount += idleJobs;
          idleVideoTotal += remaining;
          byClothing[clothing].jobs += idleJobs;
          byClothing[clothing].clips += remaining;
          byClothing[clothing].idleJobs += idleJobs;
          byClothing[clothing].idleClips += remaining;
        }
      }

      for (const emotionFrom of selectedEmotions) {
        const fromPath = emotionMap?.[emotionFrom]?.imagePath;
        if (!fromPath) continue;

        const targets = buildSpeakTargets(emotionFrom, targetTransition);
        for (const emotionTo of targets) {
          const toPath =
            emotionTo === emotionFrom
              ? fromPath
              : emotionMap?.[emotionTo]?.imagePath;
          if (!toPath) continue;

          const sourceKey = getSourceKeyFromImagePath(fromPath);
          const speakKey = buildSpeakExistingKey(
            pose,
            clothing,
            emotionFrom,
            emotionTo,
            sourceKey,
          );
          let existingSpeakCount = existingOutput.speakNatural[speakKey] || 0;
          if (existingSpeakCount === 0) {
            const speakKeyBare = buildSpeakExistingKey(
              pose,
              clothing,
              emotionFrom,
              emotionTo,
              "",
            );
            if (speakKeyBare !== speakKey) {
              existingSpeakCount = existingOutput.speakNatural[speakKeyBare] || 0;
            }
          }
          if (existingSpeakCount >= batchCount) continue;

          speakByEmotion[emotionFrom] += 1;
          speakTotal += 1;
          const speakClips = batchCount - existingSpeakCount;
          speakVideoTotal += speakClips;
          byClothing[clothing].jobs += 1;
          byClothing[clothing].clips += speakClips;
          byClothing[clothing].speakJobs += 1;
          byClothing[clothing].speakClips += speakClips;
        }
      }
    }
  }

  return {
    total: idleJobCount + speakTotal,
    videoTotal: idleVideoTotal + speakVideoTotal,
    idle: idleJobCount,
    idleVideos: idleVideoTotal,
    speakTotal,
    speakVideos: speakVideoTotal,
    speakByEmotion,
    byClothing,
  };
}
