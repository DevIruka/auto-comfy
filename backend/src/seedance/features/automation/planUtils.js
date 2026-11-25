import { buildSpeakTargets } from "../../automation-filters.js";

export function resolveIdlePerPrompt({
  idleTargetCount,
  batchCount,
  IDLE_PER_PROMPT_MAX,
}) {
  const requested = Number(idleTargetCount);
  return Math.min(
    IDLE_PER_PROMPT_MAX,
    Math.max(1, Number.isFinite(requested) ? requested : batchCount),
  );
}

export function resolveIdleTargetCount({
  idleTargetCount,
  batchCount,
  selectedIdlePromptCount,
  IDLE_PER_PROMPT_MAX,
}) {
  const promptCount = Math.max(0, Number(selectedIdlePromptCount) || 0);
  if (promptCount <= 0) return 0;
  const perPrompt = resolveIdlePerPrompt({ idleTargetCount, batchCount, IDLE_PER_PROMPT_MAX });
  return perPrompt * promptCount;
}

/**
 * Resolve the effective idle prompt pool for a given clothing.
 * Naked excludes the named `common:` prompts unless explicitly enabled,
 * since common prompts are clothed-only by design.
 */
export function effectiveIdlePrompts(selectedIdlePrompts, clothing, applyCommonToNaked) {
  const list = Array.isArray(selectedIdlePrompts) ? selectedIdlePrompts : [];
  if (clothing === "Naked" && !applyCommonToNaked) {
    return list.filter((id) => !String(id).startsWith("common:"));
  }
  return list;
}

/** Naked + filename contains "uncensored" -> counted against the Uncensored folder set. */
function isUncensoredSource(sourcePath, clothing) {
  if (clothing !== "Naked") return false;
  const base = String(sourcePath || "").split(/[\\/]/).pop() || "";
  return /uncensored/i.test(base);
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
  idlePerPrompt,
  allIdlePrompts,
  selectedIdlePrompts,
  applyCommonToNaked,
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

      // Target total is fixed by the full prompt list (independent of selection);
      // selection only controls which prompts fill the missing videos.
      const targetPromptCount = effectiveIdlePrompts(
        allIdlePrompts,
        clothing,
        applyCommonToNaked,
      ).length;
      const poolPromptCount = effectiveIdlePrompts(
        selectedIdlePrompts,
        clothing,
        applyCommonToNaked,
      ).length;
      const idleTarget = poolPromptCount > 0 ? idlePerPrompt * targetPromptCount : 0;

      // Naked has two independent source variants: plain (imagePath) and
      // uncensored (uncensoredImagePath). Each is counted/planned separately.
      const imageKeys =
        clothing === "Naked" ? ["imagePath", "uncensoredImagePath"] : ["imagePath"];

      for (const imageKey of imageKeys) {
        const neutralPath = emotionMap?.Neutral?.[imageKey];
        if (selectedEmotions.includes("Neutral") && neutralPath && idleTarget > 0) {
          const sourceKey = getSourceKeyFromImagePath(neutralPath);
          const uncensored = isUncensoredSource(neutralPath, clothing);
          const idleKey = buildIdleExistingKey(pose, clothing, sourceKey, uncensored);
          let existingIdleCount = existingOutput.idle[idleKey] || 0;
          if (existingIdleCount === 0) {
            const idleKeyBare = buildIdleExistingKey(pose, clothing, "", uncensored);
            if (idleKeyBare !== idleKey) {
              existingIdleCount = existingOutput.idle[idleKeyBare] || 0;
            }
          }
          // Fill is capped per scan by the selected pool (perPrompt × pool size),
          // so deselecting prompts limits how many new videos are made this round.
          const fillCap = idlePerPrompt * poolPromptCount;
          const remaining = Math.min(idleTarget - existingIdleCount, fillCap);
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
          const fromPath = emotionMap?.[emotionFrom]?.[imageKey];
          if (!fromPath) continue;

          const targets = buildSpeakTargets(emotionFrom, targetTransition);
          for (const emotionTo of targets) {
            const toPath =
              emotionTo === emotionFrom
                ? fromPath
                : emotionMap?.[emotionTo]?.[imageKey];
            if (!toPath) continue;

            const sourceKey = getSourceKeyFromImagePath(fromPath);
            const uncensored = isUncensoredSource(fromPath, clothing);
            const speakKey = buildSpeakExistingKey(
              pose,
              clothing,
              emotionFrom,
              emotionTo,
              sourceKey,
              uncensored,
            );
            let existingSpeakCount = existingOutput.speakNatural[speakKey] || 0;
            if (existingSpeakCount === 0) {
              const speakKeyBare = buildSpeakExistingKey(
                pose,
                clothing,
                emotionFrom,
                emotionTo,
                "",
                uncensored,
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
