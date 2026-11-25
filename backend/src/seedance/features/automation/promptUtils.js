const BASE_IDLE_VARIANT_COUNT = 5;

export function createAutomationPromptUtils({ fs, emotionConfigPath }) {
  let emotionConfig = null;

  function loadEmotionConfig() {
    if (emotionConfig) return emotionConfig;
    if (!fs.existsSync(emotionConfigPath)) return null;
    emotionConfig = JSON.parse(fs.readFileSync(emotionConfigPath, "utf8"));
    return emotionConfig;
  }

  /**
   * List all selectable idle prompts: base idle_0..4 (across sit/stand) plus
   * every named prompt under neutral.common. Returns ordered metadata only.
   */
  function listIdlePrompts(config) {
    const prompts = [];
    const sit = config?.neutral?.sit || {};
    const stand = config?.neutral?.stand || {};
    for (let index = 0; index < BASE_IDLE_VARIANT_COUNT; index += 1) {
      const key = `idle_${index}_prompt`;
      // Include the base variant if either pose defines it (exact key only,
      // so deprecated "/old" or typo keys are ignored).
      if (typeof sit[key] === "string" || typeof stand[key] === "string") {
        prompts.push({ id: `idle_${index}`, label: `기본 Idle ${index + 1}`, kind: "base" });
      }
    }
    const common = config?.neutral?.common || {};
    for (const name of Object.keys(common)) {
      if (typeof common[name] !== "string" || !common[name].trim()) continue;
      prompts.push({ id: `common:${name}`, label: name, kind: "common" });
    }
    return prompts;
  }

  /**
   * Build an idle prompt body (without prefix) for a given prompt id.
   * id forms: "idle_<n>" → neutral[pose].idle_<n>_prompt; "common:<name>" → neutral.common[name].
   */
  function buildPromptIdleById(pose, config, promptId) {
    const suffix = config?.stability_block_idle || "";
    let body = null;

    if (typeof promptId === "string" && promptId.startsWith("common:")) {
      const name = promptId.slice("common:".length);
      body = config?.neutral?.common?.[name] || null;
    } else {
      const poseKey = String(pose || "").toLowerCase();
      const neutral = config?.neutral?.[poseKey];
      if (!neutral) return null;
      const match = typeof promptId === "string" ? promptId.match(/^idle_(\d+)$/) : null;
      const index = match ? Number(match[1]) : 0;
      body = neutral[`idle_${index}_prompt`] || neutral.idle_0_prompt || null;
    }

    if (!body) return null;
    return [body, suffix].filter(Boolean).join(" ");
  }

  function buildPromptIdle(pose, clothing, config, idleIndex) {
    const index = typeof idleIndex === "number" && idleIndex >= 0 && idleIndex <= 4 ? idleIndex : 0;
    return buildPromptIdleById(pose, config, `idle_${index}`);
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
    listIdlePrompts,
    buildPromptIdle,
    buildPromptIdleById,
    buildPromptSpeakNatural,
  };
}
