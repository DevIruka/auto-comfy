export function createAutomationStructureUtils({
  fs,
  path,
  AUTOMATION_CLOTHING,
  AUTOMATION_EMOTIONS,
  AUTOMATION_IMAGE_EXT,
}) {
  function getFirstImageInFolder(dirPath) {
    if (!fs.existsSync(dirPath)) return null;
    const files = fs.readdirSync(dirPath);
    const image = files.find((name) => AUTOMATION_IMAGE_EXT.includes(path.extname(name).toLowerCase()));
    return image ? path.join(dirPath, image) : null;
  }

  function getAllImagesInFolder(dirPath) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
    const files = fs.readdirSync(dirPath);
    return files
      .filter((name) => AUTOMATION_IMAGE_EXT.includes(path.extname(name).toLowerCase()))
      .map((name) => path.join(dirPath, name));
  }

  function isNakedByFilename(filePath) {
    const lower = path.basename(filePath).toLowerCase();
    return lower.includes("nude") || lower.includes("naked");
  }

  function getPoseFromFilename(filePath) {
    const lower = path.basename(filePath).toLowerCase();
    if (lower.includes("sit")) return "Sit";
    if (lower.includes("stand")) return "Stand";
    return null;
  }

  function countImagesInPose(poseObj) {
    if (!poseObj || typeof poseObj !== "object") return 0;
    let count = 0;
    for (const clothing of AUTOMATION_CLOTHING) {
      count += Object.keys(poseObj[clothing] || {}).length;
    }
    return count;
  }

  function dropEmptyPoses(result) {
    for (const pose of Object.keys(result.poses || {})) {
      if (countImagesInPose(result.poses[pose]) === 0) {
        delete result.poses[pose];
      }
    }
  }

  function findFoldersMatching(dirPath, canonicalNames) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
    const names = fs.readdirSync(dirPath);
    const lowerToCanonical = Object.fromEntries(canonicalNames.map((name) => [name.toLowerCase(), name]));
    return names
      .filter((name) => {
        const fullPath = path.join(dirPath, name);
        return fs.statSync(fullPath).isDirectory() && lowerToCanonical[name.toLowerCase()];
      })
      .map((name) => lowerToCanonical[name.toLowerCase()]);
  }

  function listEmotionFoldersUnder(dirPath) {
    return findFoldersMatching(dirPath, AUTOMATION_EMOTIONS);
  }

  function findClothingSubdir(dirPath, clothingCanonical) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return null;
    const names = fs.readdirSync(dirPath);
    const found = names.find((name) => name.toLowerCase() === clothingCanonical.toLowerCase());
    return found ? path.join(dirPath, found) : null;
  }

  return {
    getFirstImageInFolder,
    getAllImagesInFolder,
    isNakedByFilename,
    getPoseFromFilename,
    dropEmptyPoses,
    listEmotionFoldersUnder,
    findClothingSubdir,
  };
}
