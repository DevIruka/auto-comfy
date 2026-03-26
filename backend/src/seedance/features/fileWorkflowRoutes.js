function ensureDirectory(fs, targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

function findNextIdleNumber(fs, folderPath, pose, clothing) {
  const regex = new RegExp(`^${pose}_${clothing}_Idle_(\\d+)\\.mp4$`, "i");
  const existing = fs
    .readdirSync(folderPath)
    .map((name) => {
      const match = name.match(regex);
      return match ? Number(match[1]) : 0;
    })
    .filter((n) => Number.isInteger(n) && n > 0);

  if (existing.length === 0) {
    return 1;
  }
  return Math.max(...existing) + 1;
}

async function resolveVideoData(axios, videoUrl) {
  if (typeof videoUrl !== "string" || videoUrl.length === 0) {
    throw new Error("videoUrl is required");
  }

  if (videoUrl.startsWith("http")) {
    const response = await axios.get(videoUrl, { responseType: "arraybuffer" });
    return response.data;
  }

  const base64Data = videoUrl.replace(/^data:video\/\w+;base64,/, "");
  return Buffer.from(base64Data, "base64");
}

export function registerFileWorkflowRoutes({ app, axios, fs, path }) {
  app.post("/save-video", async (req, res) => {
    try {
      const videoUrl = String(req.body?.videoUrl || "");
      const basePath = String(req.body?.basePath || "").trim();
      const pose = String(req.body?.pose || "").trim();
      const clothing = String(req.body?.clothing || "").trim();
      const action = String(req.body?.action || "").trim();
      const startEmotion = String(req.body?.startEmotion || "Neutral").trim() || "Neutral";
      const endEmotion = String(req.body?.endEmotion || "Neutral").trim() || "Neutral";

      if (!videoUrl || !basePath || !pose || !clothing || !action) {
        return res.status(400).json({
          success: false,
          error: "videoUrl, basePath, pose, clothing, action are required.",
        });
      }

      const videoData = await resolveVideoData(axios, videoUrl);
      const savedFiles = [];
      let folderPath = "";
      let fileName = "";

      if (action === "Idle") {
        folderPath = path.join(basePath, pose, "Idle");
        ensureDirectory(fs, folderPath);
        const nextNumber = findNextIdleNumber(fs, folderPath, pose, clothing);
        fileName = `${pose}_${clothing}_Idle_${nextNumber}.mp4`;
        const fullPath = path.join(folderPath, fileName);
        fs.writeFileSync(fullPath, videoData);
        savedFiles.push(fullPath);
      } else if (action === "SpeakNatural") {
        folderPath = path.join(basePath, pose, "SpeakNatural", startEmotion);
        ensureDirectory(fs, folderPath);
        fileName = `${pose}_SpeakNatural_${startEmotion}_to_${endEmotion}_${clothing}.mp4`;
        const fullPath = path.join(folderPath, fileName);
        fs.writeFileSync(fullPath, videoData);
        savedFiles.push(fullPath);

        if (startEmotion === "Neutral" && endEmotion === "Idle") {
          const extraName = `${pose}_SpeakNatural_Neutral_to_Neutral_${clothing}.mp4`;
          const extraPath = path.join(folderPath, extraName);
          fs.writeFileSync(extraPath, videoData);
          savedFiles.push(extraPath);
        }
      } else {
        return res.status(400).json({
          success: false,
          error: "Unsupported action. Use Idle or SpeakNatural.",
        });
      }

      return res.json({
        success: true,
        filePath: savedFiles[0],
        fileName,
        savedFiles,
        savedCount: savedFiles.length,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to save video.",
        details: error.message,
      });
    }
  });
}
