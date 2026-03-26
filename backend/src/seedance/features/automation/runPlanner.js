import { buildSpeakTargets } from "../../automation-filters.js";

export function queueAutomationJobsForPair({
  fs,
  path,
  root,
  resolvedOutput,
  prefixPrompt,
  config,
  batchCount,
  idleTarget,
  duration,
  aspectRatio,
  watermark,
  queueIndex,
  endpoint,
  selectedClothing,
  selectedEmotions,
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
  buildPromptSpeakNatural,
  enqueueAutomationJob,
  getSourceKeyFromImagePath,
  buildIdleExistingKey,
  buildSpeakExistingKey,
}) {
  const jobIds = [];
  const selectedEmotionSet = new Set(selectedEmotions);
  const selectedClothingSet = new Set(selectedClothing);
  const findEmotionFromFilename = (filePath) => {
    const lower = path.basename(filePath).toLowerCase();
    return AUTOMATION_EMOTIONS.find((emotion) => lower.includes(emotion.toLowerCase())) || null;
  };

  const enqueueIdleJobs = ({ pose, clothing, neutralPath }) => {
    if (!selectedEmotionSet.has("Neutral")) return;

    const sourceKey = getSourceKeyFromImagePath(neutralPath);
    const idleKey = buildIdleExistingKey(pose, clothing, sourceKey);
    const existingIdleCount = existingOutput.idle[idleKey] || 0;
    let remaining = idleTarget - existingIdleCount;
    if (remaining <= 0) return;

    const availableIdlePrompts = [];
    for (let idleIndex = 0; idleIndex < 5; idleIndex += 1) {
      const prompt = buildPromptIdle(pose, clothing, config, idleIndex);
      if (prompt) availableIdlePrompts.push({ idleIndex, prompt });
    }
    if (availableIdlePrompts.length === 0) return;

    for (let j = 0; remaining > 0; j += 1) {
      const promptEntry = availableIdlePrompts[j % availableIdlePrompts.length];
      const fullPrompt = [prefixPrompt.trim(), promptEntry.prompt].filter(Boolean).join(" ");
      const jobBatchCount = Math.min(batchCount, remaining);
      jobIds.push(
        enqueueAutomationJob({
          queueIndex,
          endpoint,
          type: "idle",
          pose,
          clothing,
          sourceKey,
          idleIndex: promptEntry.idleIndex,
          outputPath: resolvedOutput,
          prompt: fullPrompt,
          firstFramePath: neutralPath,
          lastFramePath: neutralPath,
          duration,
          aspectRatio,
          watermark,
          batchCount: jobBatchCount,
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
      const targets = buildSpeakTargets(emotionFrom, targetTransition);
      if (targets.length === 0) continue;

      for (const emotionTo of targets) {
        const speakKey = buildSpeakExistingKey(
          pose,
          clothing,
          emotionFrom,
          emotionTo,
          sourceKey,
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
          }),
        );
        existingOutput.speakNatural[speakKey] = existingSpeakCount + jobBatchCount;
      }
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
        if (!imageByPoseClothingEmotion[pose][clothing][emotion]) {
          imageByPoseClothingEmotion[pose][clothing][emotion] = imagePath;
        }
      }
    }

    for (const pose of AUTOMATION_POSES) {
      for (const clothing of selectedClothing) {
        const getImage = (emotion) =>
          imageByPoseClothingEmotion[pose]?.[clothing]?.[emotion] || null;

        const neutralPath = getImage("Neutral");
        if (neutralPath) enqueueIdleJobs({ pose, clothing, neutralPath });
        enqueueSpeakNaturalJobs({ pose, clothing, getImage });
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
      if (!imageByPoseClothingEmotion[pose][clothing][emotion]) {
        imageByPoseClothingEmotion[pose][clothing][emotion] = imagePath;
        recognized += 1;
      }
    }

    if (recognized > 0) {
      for (const pose of AUTOMATION_POSES) {
        for (const clothing of selectedClothing) {
          const getImage = (emotion) =>
            imageByPoseClothingEmotion[pose]?.[clothing]?.[emotion] || null;
          const neutralPath = getImage("Neutral");
          if (neutralPath) enqueueIdleJobs({ pose, clothing, neutralPath });
          enqueueSpeakNaturalJobs({ pose, clothing, getImage });
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
            return imagePaths.find((imagePath) => isNakedByFilename(imagePath)) || null;
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
    }
  }

  return jobIds;
}
