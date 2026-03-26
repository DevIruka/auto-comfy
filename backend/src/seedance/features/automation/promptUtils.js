export function createAutomationPromptUtils({ fs, emotionConfigPath }) {
  let emotionConfig = null;

  function loadEmotionConfig() {
    if (emotionConfig) return emotionConfig;
    if (!fs.existsSync(emotionConfigPath)) return null;
    emotionConfig = JSON.parse(fs.readFileSync(emotionConfigPath, "utf8"));
    return emotionConfig;
  }

  function buildPromptIdle(pose, clothing, config, idleIndex) {
    const poseKey = pose.toLowerCase();
    const neutral = config?.neutral?.[poseKey];
    if (!neutral) return null;

    const index = typeof idleIndex === "number" && idleIndex >= 0 && idleIndex <= 4 ? idleIndex : 0;
    const body = neutral[`idle_${index}_prompt`] || neutral.idle_0_prompt;
    const suffix = config?.stability_block_idle || "";
    return [body, suffix].filter(Boolean).join(" ");
  }

  function getSpeakNaturalPrompt(emotion, toNeutral, pose, config) {
    const poseKey = pose.toLowerCase();

    if (emotion === "Neutral" || emotion === "Happy") {
      const neutral = config?.neutral?.[poseKey];
      return neutral?.speaknatural_same_prompt || (emotion === "Happy" ? "" : null);
    }

    const block = config?.[emotion.toLowerCase()]?.[poseKey];
    if (!block) return null;

    if (toNeutral && (emotion === "Angry" || emotion === "Sad")) {
      return block.speaknatural_to_neutral_prompt || block.speaknatural_same_prompt;
    }

    return block.speaknatural_same_prompt || null;
  }

  function buildPromptSpeakNatural(emotionFrom, emotionTo, pose, config) {
    const toNeutral = emotionTo === "Neutral";
    const body = getSpeakNaturalPrompt(emotionFrom, toNeutral, pose, config);
    if (!body) return null;

    const suffix = config?.stability_block_speaknatural || "";
    return [body, suffix].filter(Boolean).join(" ");
  }

  return {
    loadEmotionConfig,
    buildPromptIdle,
    buildPromptSpeakNatural,
  };
}
