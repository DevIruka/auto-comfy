import { buildSpeakTargets } from "../../automation-filters.js";
import { effectiveIdlePrompts } from "./planUtils.js";

export function queueAutomationJobsForPair({
  fs,
  path,
  root,
  resolvedOutput,
  prefixPrompt,
  config,
  batchCount,
  idlePerPrompt,
  allIdlePrompts,
  applyCommonToNaked,
  duration,
  aspectRatio,
  watermark,
  queueIndex,
  endpoint,
  selectedClothing,
  selectedEmotions,
  selectedIdlePrompts,
  targetTransition,
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
  enqueueAutomationJob,
  getSourceKeyFromImagePath,
  buildIdleExistingKey,
  buildSpeakExistingKey,
}) {
  const jobIds = [];
  const selectedEmotionSet = new Set(selectedEmotions);
  const selectedClothingSet = new Set(selectedClothing);
  // filename contains "uncensored" (used to split plain vs uncensored nude sources).
  const isUncensoredName = (sourcePath) =>
    /uncensored/i.test(path.basename(String(sourcePath || "")));
  // Naked + filename contains "uncensored" -> route to a dedicated Uncensored folder.
  const isUncensored = (sourcePath, clothing) =>
    clothing === "Naked" && isUncensoredName(sourcePath);
  const findEmotionFromFilename = (filePath) => {
    const lower = path.basename(filePath).toLowerCase();
    return AUTOMATION_EMOTIONS.find((emotion) => lower.includes(emotion.toLowerCase())) || null;
  };

  const enqueueIdleJobs = ({ pose, clothing, neutralPath }) => {
    if (!selectedEmotionSet.has("Neutral")) return;

    // Target total is fixed by the full prompt list (independent of selection);
    // the selected pool only controls which prompts fill the missing videos.
    const targetPrompts = effectiveIdlePrompts(
      allIdlePrompts,
      clothing,
      applyCommonToNaked,
    );
    const poolPrompts = effectiveIdlePrompts(
      selectedIdlePrompts,
      clothing,
      applyCommonToNaked,
    );
    const idleTarget = idlePerPrompt * targetPrompts.length;
    if (idleTarget <= 0) return;

    const availableIdlePrompts = [];
    poolPrompts.forEach((promptId, order) => {
      const prompt = buildPromptIdleById(pose, config, promptId);
      if (prompt) availableIdlePrompts.push({ promptId, order, prompt });
    });
    if (availableIdlePrompts.length === 0) return;

    const sourceKey = getSourceKeyFromImagePath(neutralPath);
    const uncensored = isUncensored(neutralPath, clothing);
    const idleKey = buildIdleExistingKey(pose, clothing, sourceKey, uncensored);
    const existingIdleCount = existingOutput.idle[idleKey] || 0;
    // Fill is capped per run by the selected pool (perPrompt × pool size).
    const fillCap = idlePerPrompt * availableIdlePrompts.length;
    let remaining = Math.min(idleTarget - existingIdleCount, fillCap);
    if (remaining <= 0) return;

    for (let j = 0; remaining > 0; j += 1) {
      const promptEntry = availableIdlePrompts[j % availableIdlePrompts.length];
      const fullPrompt = [prefixPrompt.trim(), promptEntry.prompt].filter(Boolean).join(" ");
      const jobBatchCount = Math.min(batchCount, remaining);
      // common 프롬프트는 7초, 기본 idle은 요청 duration(기본 5초) 사용.
      const jobDuration = String(promptEntry.promptId).startsWith("common:")
        ? 7
        : duration;
      jobIds.push(
        enqueueAutomationJob({
          queueIndex,
          endpoint,
          type: "idle",
          pose,
          clothing,
          sourceKey,
          idleIndex: promptEntry.order,
          outputPath: resolvedOutput,
          prompt: fullPrompt,
          firstFramePath: neutralPath,
          lastFramePath: neutralPath,
          duration: jobDuration,
          aspectRatio,
          watermark,
          batchCount: jobBatchCount,
          uncensored,
        }),
      );
      existingOutput.idle[idleKey] = (existingOutput.idle[idleKey] || 0) + jobBatchCount;
      remaining -= jobBatchCount;
    }
  };

  const enqueueSpeakNaturalJobs = ({ pose, clothing, getImage }) => {
    for (const emotionFrom of selectedEmotions) {
      const fromPath = getImage(emotionFrom);
      if (!fromPath) continue;

      const sourceKey = getSourceKeyFromImagePath(fromPath);
      const uncensored = isUncensored(fromPath, clothing);
      const targets = buildSpeakTargets(emotionFrom, targetTransition);
      if (targets.length === 0) continue;

      for (const emotionTo of targets) {
        const speakKey = buildSpeakExistingKey(
          pose,
          clothing,
          emotionFrom,
          emotionTo,
          sourceKey,
          uncensored,
        );
        const existingSpeakCount = existingOutput.speakNatural[speakKey] || 0;
        const remainingSpeakCount = batchCount - existingSpeakCount;
        if (remainingSpeakCount <= 0) continue;

        const toPath = emotionTo === emotionFrom ? fromPath : getImage(emotionTo);
        if (!toPath) continue;

        const prompt = buildPromptSpeakNatural(emotionFrom, emotionTo, pose, config);
        if (!prompt) continue;

        const fullPrompt = [prefixPrompt.trim(), prompt].filter(Boolean).join(" ");
        const jobBatchCount = Math.min(batchCount, remainingSpeakCount);
        jobIds.push(
          enqueueAutomationJob({
            queueIndex,
            endpoint,
            type: "speaknatural",
            pose,
            clothing,
            sourceKey,
            emotionFrom,
            emotionTo,
            outputPath: resolvedOutput,
            prompt: fullPrompt,
            firstFramePath: fromPath,
            lastFramePath: toPath,
            duration,
            aspectRatio,
            watermark,
            batchCount: jobBatchCount,
            uncensored,
          }),
        );
        existingOutput.speakNatural[speakKey] = existingSpeakCount + jobBatchCount;
      }
    }
  };

  // Store plain and uncensored nude as separate variants so both are generated
  // (plain -> Idle/SpeakNatural, uncensored -> Idle/Uncensored, SpeakNatural/Uncensored).
  const assignVariantImage = (slotMap, emotion, clothing, imagePath) => {
    if (!slotMap[emotion]) slotMap[emotion] = { plain: null, uncensored: null };
    if (clothing === "Naked" && isUncensoredName(imagePath)) {
      if (!slotMap[emotion].uncensored) {
        slotMap[emotion].uncensored = imagePath;
        return true;
      }
    } else if (!slotMap[emotion].plain) {
      slotMap[emotion].plain = imagePath;
      return true;
    }
    return false;
  };

  const enqueueVariantJobs = (slotMap, clothing, pose) => {
    const getPlain = (emotion) => slotMap?.[emotion]?.plain || null;
    const neutralPlain = getPlain("Neutral");
    if (neutralPlain) enqueueIdleJobs({ pose, clothing, neutralPath: neutralPlain });
    enqueueSpeakNaturalJobs({ pose, clothing, getImage: getPlain });
    if (clothing === "Naked") {
      const getUnc = (emotion) => slotMap?.[emotion]?.uncensored || null;
      const neutralUnc = getUnc("Neutral");
      if (neutralUnc) enqueueIdleJobs({ pose, clothing, neutralPath: neutralUnc });
      enqueueSpeakNaturalJobs({ pose, clothing, getImage: getUnc });
    }
  };

  const emotionFoldersAtRoot = listEmotionFoldersUnder(root);
  if (emotionFoldersAtRoot.length > 0) {
    const imageByPoseClothingEmotion = {
      Sit: { Clothed: {}, Naked: {} },
      Stand: { Clothed: {}, Naked: {} },
    };

    for (const emotion of emotionFoldersAtRoot) {
      const emotionPath = path.join(root, emotion);
      for (const imagePath of getAllImagesInFolder(emotionPath)) {
        const pose = getPoseFromFilename(imagePath);
        if (!pose) continue;

        const clothing = isNakedByFilename(imagePath) ? "Naked" : "Clothed";
        assignVariantImage(
          imageByPoseClothingEmotion[pose][clothing],
          emotion,
          clothing,
          imagePath,
        );
      }
    }

    for (const pose of AUTOMATION_POSES) {
      for (const clothing of selectedClothing) {
        enqueueVariantJobs(imageByPoseClothingEmotion[pose]?.[clothing], clothing, pose);
      }
    }

    return jobIds;
  }

  const rootImages = getAllImagesInFolder(root);
  if (rootImages.length > 0) {
    const imageByPoseClothingEmotion = {
      Sit: { Clothed: {}, Naked: {} },
      Stand: { Clothed: {}, Naked: {} },
    };
    let recognized = 0;

    for (const imagePath of rootImages) {
      const pose = getPoseFromFilename(imagePath);
      const emotion = findEmotionFromFilename(imagePath);
      if (!pose || !emotion) continue;
      const clothing = isNakedByFilename(imagePath) ? "Naked" : "Clothed";
      const slotMap = imageByPoseClothingEmotion[pose][clothing];
      if (assignVariantImage(slotMap, emotion, clothing, imagePath)) {
        recognized += 1;
      }
    }

    if (recognized > 0) {
      for (const pose of AUTOMATION_POSES) {
        for (const clothing of selectedClothing) {
          enqueueVariantJobs(imageByPoseClothingEmotion[pose]?.[clothing], clothing, pose);
        }
      }
      return jobIds;
    }
  }

  for (const pose of AUTOMATION_POSES) {
    const posePath = path.join(root, pose);
    if (!fs.existsSync(posePath) || !fs.statSync(posePath).isDirectory()) continue;

    const clothingSources = [];
    for (const clothing of AUTOMATION_CLOTHING) {
      const clothingPath = findClothingSubdir(posePath, clothing);
      if (clothingPath) clothingSources.push({ name: clothing, path: clothingPath });
    }

    if (clothingSources.length === 0) {
      const directEmotions = listEmotionFoldersUnder(posePath);
      if (directEmotions.length > 0) {
        clothingSources.push(
          { name: "Clothed", path: posePath, directByFilename: true },
          { name: "Naked", path: posePath, directByFilename: true },
        );
      }
    }

    if (clothingSources.length === 0) {
      const emotionDirs = listEmotionFoldersUnder(posePath);
      let hasEmotionClothing = false;
      for (const emotion of emotionDirs) {
        const emotionPath = path.join(posePath, emotion);
        if (findClothingSubdir(emotionPath, "Clothed") && findClothingSubdir(emotionPath, "Naked")) {
          hasEmotionClothing = true;
          break;
        }
      }
      if (hasEmotionClothing) {
        clothingSources.push(
          { name: "Clothed", path: posePath, emotionUnderClothing: true },
          { name: "Naked", path: posePath, emotionUnderClothing: true },
        );
      }
    }

    for (const src of clothingSources) {
      const clothing = src.name;
      if (!selectedClothingSet.has(clothing)) continue;

      const getImage = (emotion) => {
        if (src.directByFilename) {
          const emotionPath = path.join(posePath, emotion);
          const imagePaths = getAllImagesInFolder(emotionPath);
          if (src.name === "Naked") {
            // Plain nude only (uncensored handled in a separate pass below).
            return (
              imagePaths.find(
                (imagePath) =>
                  isNakedByFilename(imagePath) && !isUncensoredName(imagePath),
              ) || null
            );
          }
          return imagePaths.find((imagePath) => !isNakedByFilename(imagePath)) || null;
        }
        if (src.emotionUnderClothing) {
          const emotionPath = path.join(posePath, emotion);
          const clothingPath = findClothingSubdir(emotionPath, clothing);
          return clothingPath ? getFirstImageInFolder(clothingPath) : null;
        }
        const emotionPath = path.join(src.path, emotion);
        return getFirstImageInFolder(emotionPath);
      };

      const neutralPath = getImage("Neutral");
      if (neutralPath) enqueueIdleJobs({ pose, clothing, neutralPath });
      enqueueSpeakNaturalJobs({ pose, clothing, getImage });

      // Uncensored nude pass for filename-based nude folders.
      if (src.directByFilename && src.name === "Naked") {
        const getUncImage = (emotion) => {
          const emotionPath = path.join(posePath, emotion);
          const imagePaths = getAllImagesInFolder(emotionPath);
          return (
            imagePaths.find(
              (imagePath) =>
                isNakedByFilename(imagePath) && isUncensoredName(imagePath),
            ) || null
          );
        };
        const neutralUnc = getUncImage("Neutral");
        if (neutralUnc) enqueueIdleJobs({ pose, clothing, neutralPath: neutralUnc });
        enqueueSpeakNaturalJobs({ pose, clothing, getImage: getUncImage });
      }
    }
  }

  return jobIds;
}
