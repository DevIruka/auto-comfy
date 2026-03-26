export function buildAutomationScanResult({
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
}) {
  const result = { poses: {}, warnings: [], structure: "Pose/Clothed|Naked/Emotions" };
  const findEmotionFromFilename = (filePath) => {
    const lower = path.basename(filePath).toLowerCase();
    return AUTOMATION_EMOTIONS.find((emotion) => lower.includes(emotion.toLowerCase())) || null;
  };

  const emotionFoldersAtRoot = listEmotionFoldersUnder(root);
  if (emotionFoldersAtRoot.length > 0) {
    let foundAny = false;

    for (const emotion of emotionFoldersAtRoot) {
      const emotionPath = path.join(root, emotion);
      const imagePaths = getAllImagesInFolder(emotionPath);

      for (const imagePath of imagePaths) {
        const pose = getPoseFromFilename(imagePath);
        if (!pose) continue;

        if (!result.poses[pose]) result.poses[pose] = { Clothed: {}, Naked: {} };
        const clothing = isNakedByFilename(imagePath) ? "Naked" : "Clothed";
        if (!result.poses[pose][clothing][emotion]) {
          result.poses[pose][clothing][emotion] = { imagePath };
          foundAny = true;
        }
      }

      if (imagePaths.length > 0 && !imagePaths.some((p) => getPoseFromFilename(p))) {
        result.warnings.push(`${emotion}: no pose marker found in filenames (expected sit or stand).`);
      }
    }

    if (foundAny) {
      dropEmptyPoses(result);
      result.structure = "Emotion/Image (pose from filename, nude|naked => Naked)";
      return result;
    }
  }

  const rootImages = getAllImagesInFolder(root);
  if (rootImages.length > 0) {
    let foundAny = false;

    for (const imagePath of rootImages) {
      const pose = getPoseFromFilename(imagePath);
      const emotion = findEmotionFromFilename(imagePath);
      if (!pose || !emotion) continue;

      if (!result.poses[pose]) result.poses[pose] = { Clothed: {}, Naked: {} };
      const clothing = isNakedByFilename(imagePath) ? "Naked" : "Clothed";
      if (!result.poses[pose][clothing][emotion]) {
        result.poses[pose][clothing][emotion] = { imagePath };
        foundAny = true;
      }
    }

    if (foundAny) {
      dropEmptyPoses(result);
      result.structure = "Image at root (pose+emotion from filename, nude|naked => Naked)";
      return result;
    }
  }

  for (const pose of AUTOMATION_POSES) {
    const posePath = path.join(root, pose);
    if (!fs.existsSync(posePath) || !fs.statSync(posePath).isDirectory()) continue;

    result.poses[pose] = { Clothed: {}, Naked: {} };
    let hasAny = false;

    for (const clothing of AUTOMATION_CLOTHING) {
      const clothingPath = findClothingSubdir(posePath, clothing);
      if (!clothingPath) continue;

      for (const emotion of AUTOMATION_EMOTIONS) {
        const emotionPath = path.join(clothingPath, emotion);
        if (!fs.existsSync(emotionPath) || !fs.statSync(emotionPath).isDirectory()) continue;

        const imagePath = getFirstImageInFolder(emotionPath);
        if (imagePath) {
          result.poses[pose][clothing][emotion] = { imagePath };
          hasAny = true;
        } else {
          result.warnings.push(`${pose}/${clothing}/${emotion}: no image found.`);
        }
      }
    }

    if (!hasAny) {
      const directEmotions = listEmotionFoldersUnder(posePath);
      if (directEmotions.length > 0) {
        for (const emotion of directEmotions) {
          const emotionPath = path.join(posePath, emotion);
          const imagePaths = getAllImagesInFolder(emotionPath);

          let clothedPath = null;
          let nakedPath = null;
          for (const imagePath of imagePaths) {
            if (isNakedByFilename(imagePath)) nakedPath = nakedPath || imagePath;
            else clothedPath = clothedPath || imagePath;
          }

          if (clothedPath) {
            result.poses[pose].Clothed[emotion] = { imagePath: clothedPath };
            hasAny = true;
          }
          if (nakedPath) {
            result.poses[pose].Naked[emotion] = { imagePath: nakedPath };
            hasAny = true;
          }

          if (!clothedPath && !nakedPath && imagePaths.length === 0) {
            result.warnings.push(`${pose}/${emotion}: no image found.`);
          }
        }

        if (hasAny) {
          result.structure = "Pose/Emotion/Image (nude|naked => Naked, else Clothed)";
        }
      }
    }

    if (!hasAny) {
      const directEmotions = listEmotionFoldersUnder(posePath);
      if (directEmotions.length > 0) {
        result.structure = "Pose/Emotions (no Clothed/Naked folders)";
        for (const emotion of directEmotions) {
          const emotionPath = path.join(posePath, emotion);
          const imagePath = getFirstImageInFolder(emotionPath);
          if (imagePath) {
            result.poses[pose].Clothed[emotion] = { imagePath };
            hasAny = true;
          } else {
            result.warnings.push(`${pose}/${emotion}: no image found.`);
          }
        }
      }
    }

    if (!hasAny) {
      const emotionDirs = listEmotionFoldersUnder(posePath);
      let foundEmotionClothing = 0;

      for (const emotion of emotionDirs) {
        const emotionPath = path.join(posePath, emotion);
        for (const clothing of AUTOMATION_CLOTHING) {
          const clothingPath = findClothingSubdir(emotionPath, clothing);
          if (!clothingPath) continue;

          const imagePath = getFirstImageInFolder(clothingPath);
          if (imagePath) {
            result.poses[pose][clothing][emotion] = { imagePath };
            foundEmotionClothing += 1;
            hasAny = true;
          } else {
            result.warnings.push(`${pose}/${emotion}/${clothing}: folder exists but no image found.`);
          }
        }
      }

      if (foundEmotionClothing > 0) {
        result.structure = "Pose/Emotion/Clothed|Naked";
      }
    }
  }

  dropEmptyPoses(result);
  return result;
}
