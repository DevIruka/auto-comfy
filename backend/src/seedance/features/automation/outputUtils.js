export function createAutomationOutputUtils({
  fs,
  path,
  axios,
  AUTOMATION_POSES,
  AUTOMATION_EMOTIONS,
}) {
  const sequenceNextByFileGroup = new Map();

  function createEmptyExistingOutputState() {
    return { idle: {}, speakNatural: {} };
  }

  function escapeForRegex(input) {
    return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function sanitizeSourceKey(raw) {
    const cleaned = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return cleaned;
  }

  const genericSourceTokenSet = new Set(
    [
      ...AUTOMATION_POSES.map((pose) => pose.toLowerCase()),
      ...AUTOMATION_EMOTIONS.map((emotion) => emotion.toLowerCase()),
      "clothed",
      "naked",
      "nude",
      "uncensored",
      "pose",
      "img",
      "image",
      "frame",
      "first",
      "last",
    ].map((token) => sanitizeSourceKey(token)),
  );

  function sourceKeyIsOnlyGenericTokens(sanitizedSlug) {
    if (!sanitizedSlug) return true;
    const parts = sanitizedSlug.split("-").filter(Boolean);
    if (parts.length === 0) return true;
    return parts.every(
      (p) => genericSourceTokenSet.has(p) || /^\d+$/.test(p),
    );
  }

  /** Normalize filename middle segment: drop pose/emotion/index-only slugs (legacy names). */
  function normalizeParsedFilenameSource(slug) {
    const s = sanitizeSourceKey(slug || "");
    return sourceKeyIsOnlyGenericTokens(s) ? "" : s;
  }

  function getSourceKeyFromImagePath(filePath) {
    if (!filePath) return "";
    const base = path.basename(filePath, path.extname(filePath));
    const spotMatch = base.match(/(spot[0-9a-z]+)/i);
    if (spotMatch) return sanitizeSourceKey(spotMatch[1]);

    const tokens = base
      .split(/[_\s-]+/)
      .map((token) => sanitizeSourceKey(token))
      .filter(Boolean);

    const firstToken = tokens[0] || sanitizeSourceKey(base);
    if (
      firstToken &&
      !genericSourceTokenSet.has(firstToken) &&
      !/^\d+$/.test(firstToken)
    ) {
      return firstToken;
    }

    const reduced = tokens
      .filter(
        (token) => !genericSourceTokenSet.has(token) && !/^\d+$/.test(token),
      )
      .join("-");
    if (reduced) return sanitizeSourceKey(reduced);

    // Basename is only pose / clothing / emotion / index tokens — already reflected in
    // output prefix (e.g. Stand_Clothed_Idle). Omit suffix so we get Stand_Clothed_Idle_001.mp4.
    return "";
  }

  function buildIdleExistingKey(pose, clothing, sourceKey, uncensored) {
    const source = sanitizeSourceKey(sourceKey);
    const suffix = uncensored ? "_unc" : "";
    return source
      ? `${pose}_${clothing}_${source}${suffix}`
      : `${pose}_${clothing}${suffix}`;
  }

  function buildSpeakExistingKey(
    pose,
    clothing,
    emotionFrom,
    emotionTo,
    sourceKey,
    uncensored,
  ) {
    const source = sanitizeSourceKey(sourceKey);
    const suffix = uncensored ? "_unc" : "";
    const base = `${pose}_${clothing}_${emotionFrom}_to_${emotionTo}`;
    return source ? `${base}_${source}${suffix}` : `${base}${suffix}`;
  }

  function normalizeClothingToken(token) {
    const lower = String(token || "").toLowerCase();
    if (lower === "clothed") return "Clothed";
    if (lower === "naked" || lower === "nude") return "Naked";
    return null;
  }

  /** File token: internal Naked → "Naked" in filenames (naked/nude both save as "Naked"). */
  function clothingFileSuffix(internalClothing) {
    return internalClothing === "Naked" ? "Naked" : "Clothed";
  }

  function formatSequenceDigits(n) {
    return String(Math.max(1, Number(n) || 1)).padStart(3, "0");
  }

  function listExistingMp4Files(dirPath) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
    return fs.readdirSync(dirPath).filter((name) => {
      if (path.extname(name).toLowerCase() !== ".mp4") return false;
      const fullPath = path.join(dirPath, name);
      try {
        const st = fs.statSync(fullPath);
        return st.isFile() && st.size > 0;
      } catch {
        return false;
      }
    });
  }

  function ensureNextSequenceNumber(key, folderPath, numRegex) {
    if (sequenceNextByFileGroup.has(key)) return;

    const files = listExistingMp4Files(folderPath);
    let maxNum = 0;
    for (const fileName of files) {
      const matched = fileName.match(numRegex);
      if (!matched) continue;
      const parsed = matched[1] ? parseInt(matched[1], 10) : 1;
      if (Number.isFinite(parsed) && parsed > maxNum) maxNum = parsed;
    }
    sequenceNextByFileGroup.set(key, maxNum + 1);
  }

  function reserveNextSequenceNumber(folderPath, baseName, numRegex) {
    const key = `${folderPath}::${baseName}`.toLowerCase();
    ensureNextSequenceNumber(key, folderPath, numRegex);
    const current = sequenceNextByFileGroup.get(key) || 1;
    sequenceNextByFileGroup.set(key, current + 1);
    return current;
  }

  function scanOutputForExisting(outputPath) {
    const { idle, speakNatural } = createEmptyExistingOutputState();

    if (!outputPath) {
      return { idle, speakNatural };
    }
    if (!fs.existsSync(outputPath)) {
      return { idle, speakNatural };
    }
    if (!fs.statSync(outputPath).isDirectory()) {
      return { idle, speakNatural };
    }

    // Current format: Pose_Clothing_Idle[_source]_NNN (e.g. Stand_Clothed_Idle_001).
    const idleRegexCurrent =
      /^(Sit|Stand)_(Clothed|Naked|Nude)_Idle(?:_([a-z0-9-]+))?_(\d+)\.mp4$/i;
    // Older format: Pose_Idle_Clothing[_source]_NNN (e.g. Stand_Idle_Clothed_001).
    const idleRegexMid =
      /^(Sit|Stand)_Idle_(Clothed|Naked|Nude)(?:_([a-z0-9-]+))?_(\d+)\.mp4$/i;
    // Oldest legacy: Pose_Clothing[_source]_Idle[_NNN].
    const idleRegexLegacy =
      /^(Sit|Stand)_(Clothed|Naked|Nude)(?:_([a-z0-9-]+))?_Idle(?:_(\d+))?\.mp4$/i;
    const speakRegexNew =
      /^(Sit|Stand)_SpeakNatural_(Angry|Sad|Aroused|Neutral|Happy)_to_(Angry|Sad|Aroused|Neutral|Happy)_(Clothed|Naked|Nude)(?:_([a-z0-9-]+))?_(\d+)\.mp4$/i;
    const speakRegexLegacy =
      /^(Sit|Stand)_SpeakNatural_(Angry|Sad|Aroused|Neutral|Happy)_to_(Angry|Sad|Aroused|Neutral|Happy)_(Clothed|Naked|Nude)(?:_([a-z0-9-]+))?(?:_(\d+))?\.mp4$/i;

    function accumulateIdleDir(idleDir, uncensored) {
      if (!fs.existsSync(idleDir) || !fs.statSync(idleDir).isDirectory()) {
        return;
      }
      const files = listExistingMp4Files(idleDir);
      for (const fileName of files) {
        const m =
          fileName.match(idleRegexCurrent) ||
          fileName.match(idleRegexMid) ||
          fileName.match(idleRegexLegacy);
        if (!m) continue;
        const parsedPose = m[1];
        const parsedClothing = normalizeClothingToken(m[2]);
        const parsedSource = normalizeParsedFilenameSource(m[3] || "");
        if (!parsedClothing) continue;
        const key = buildIdleExistingKey(
          parsedPose,
          parsedClothing,
          parsedSource,
          uncensored,
        );
        idle[key] = (idle[key] || 0) + 1;
      }
    }

    function accumulateSpeakEmotionDir(emotionDir, uncensored) {
      if (!fs.existsSync(emotionDir) || !fs.statSync(emotionDir).isDirectory()) {
        return;
      }
      const files = listExistingMp4Files(emotionDir);
      for (const fileName of files) {
        let m = fileName.match(speakRegexNew);
        let parsedPose;
        let parsedFrom;
        let parsedTo;
        let parsedClothing;
        let parsedSource;
        if (m) {
          parsedPose = m[1];
          parsedFrom = m[2];
          parsedTo = m[3];
          parsedClothing = normalizeClothingToken(m[4]);
          parsedSource = normalizeParsedFilenameSource(m[5] || "");
        } else {
          m = fileName.match(speakRegexLegacy);
          if (!m) continue;
          parsedPose = m[1];
          parsedFrom = m[2];
          parsedTo = m[3];
          parsedClothing = normalizeClothingToken(m[4]);
          parsedSource = normalizeParsedFilenameSource(m[5] || "");
        }
        if (!parsedClothing) continue;
        const key = buildSpeakExistingKey(
          parsedPose,
          parsedClothing,
          parsedFrom,
          parsedTo,
          parsedSource,
          uncensored,
        );
        speakNatural[key] = (speakNatural[key] || 0) + 1;
      }
    }

    for (const pose of AUTOMATION_POSES) {
      accumulateIdleDir(path.join(outputPath, pose, "Idle"), false);
      accumulateIdleDir(path.join(outputPath, pose, "Idle", "Uncensored"), true);
    }
    accumulateIdleDir(path.join(outputPath, "Idle"), false);
    accumulateIdleDir(path.join(outputPath, "Idle", "Uncensored"), true);

    for (const emotionFrom of AUTOMATION_EMOTIONS) {
      for (const pose of AUTOMATION_POSES) {
        accumulateSpeakEmotionDir(
          path.join(outputPath, pose, "SpeakNatural", emotionFrom),
          false,
        );
        accumulateSpeakEmotionDir(
          path.join(outputPath, pose, "SpeakNatural", "Uncensored", emotionFrom),
          true,
        );
      }
      accumulateSpeakEmotionDir(
        path.join(outputPath, "SpeakNatural", emotionFrom),
        false,
      );
      accumulateSpeakEmotionDir(
        path.join(outputPath, "SpeakNatural", "Uncensored", emotionFrom),
        true,
      );
    }

    return { idle, speakNatural };
  }

  async function saveAutomationVideosToOutput(basePath, jobMeta, videoUrls) {
    if (!basePath || !videoUrls?.length) return [];

    const { type, pose, clothing, emotionFrom, emotionTo } = jobMeta;
    const sourceKey = sanitizeSourceKey(jobMeta?.sourceKey || "");
    const sourceSuffix = sourceKey ? `_${sourceKey}` : "";
    const uncensored = Boolean(jobMeta?.uncensored);
    const savedPaths = [];

    if (type === "idle") {
      const folderPath = uncensored
        ? path.join(basePath, "Idle", "Uncensored")
        : path.join(basePath, "Idle");
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

      const cloth = clothingFileSuffix(clothing);
      const basePrefix = `${pose}_${cloth}_Idle${sourceSuffix}`;
      const numRegex = new RegExp(
        `^${escapeForRegex(basePrefix)}_(\\d+)\\.mp4$`,
        "i",
      );

      for (const videoUrl of videoUrls) {
        try {
          const response = await axios.get(videoUrl, {
            responseType: "arraybuffer",
            timeout: 120000,
          });
          const n = reserveNextSequenceNumber(folderPath, basePrefix, numRegex);
          const fileName = `${basePrefix}_${formatSequenceDigits(n)}.mp4`;
          const fullPath = path.join(folderPath, fileName);
          fs.writeFileSync(fullPath, response.data);
          savedPaths.push(fullPath);
          console.log(`[automation] saved video: ${fullPath}`);
        } catch (error) {
          console.error(`[automation] failed to save idle video:`, error.message);
        }
      }
      return savedPaths;
    }

    const startEmotion = emotionFrom || "Neutral";
    const endEmotion = emotionTo || "Neutral";
    const folderPath = uncensored
      ? path.join(basePath, "SpeakNatural", "Uncensored", startEmotion)
      : path.join(basePath, "SpeakNatural", startEmotion);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

    const cloth = clothingFileSuffix(clothing);
    const basePrefix = `${pose}_SpeakNatural_${startEmotion}_to_${endEmotion}_${cloth}${sourceSuffix}`;
    const numRegex = new RegExp(
      `^${escapeForRegex(basePrefix)}_(\\d+)\\.mp4$`,
      "i",
    );

    for (const videoUrl of videoUrls) {
      try {
        const response = await axios.get(videoUrl, {
          responseType: "arraybuffer",
          timeout: 120000,
        });
        const n = reserveNextSequenceNumber(folderPath, basePrefix, numRegex);
        const fileName = `${basePrefix}_${formatSequenceDigits(n)}.mp4`;
        const fullPath = path.join(folderPath, fileName);
        fs.writeFileSync(fullPath, response.data);
        savedPaths.push(fullPath);
        console.log(`[automation] saved video: ${fullPath}`);
      } catch (error) {
        console.error(`[automation] failed to save speak video:`, error.message);
      }
    }

    return savedPaths;
  }

  return {
    createEmptyExistingOutputState,
    sanitizeSourceKey,
    getSourceKeyFromImagePath,
    buildIdleExistingKey,
    buildSpeakExistingKey,
    scanOutputForExisting,
    saveAutomationVideosToOutput,
  };
}
