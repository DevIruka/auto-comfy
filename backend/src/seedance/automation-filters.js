export function normalizeTargetTransition(targetTransition) {
  const raw =
    typeof targetTransition === "string"
      ? targetTransition.trim().toLowerCase()
      : "all";
  if (raw === "same") return "same";
  if (raw === "toneutral" || raw === "to_neutral" || raw === "to-neutral") {
    return "toneutral";
  }
  // Backward compatibility for legacy values.
  if (raw === "both") return "all";
  return "all";
}

export function normalizeTargetClothing(targetClothing, clothingList) {
  const raw =
    typeof targetClothing === "string"
      ? targetClothing.trim().toLowerCase()
      : "all";
  if (raw === "clothed") return ["Clothed"];
  if (raw === "naked" || raw === "nude") return ["Naked"];
  return [...clothingList];
}

export function normalizeTargetEmotions(targetEmotions, emotionList) {
  const selectedRaw = new Set(
    (Array.isArray(targetEmotions) ? targetEmotions : [])
      .filter((v) => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => emotionList.includes(v)),
  );
  return selectedRaw.size > 0
    ? emotionList.filter((emotion) => selectedRaw.has(emotion))
    : [...emotionList];
}

export function buildSpeakTargets(emotionFrom, transitionMode) {
  const targets = [];
  if (transitionMode === "same" || transitionMode === "all") {
    targets.push(emotionFrom);
  }
  if (
    (transitionMode === "toneutral" || transitionMode === "all") &&
    emotionFrom !== "Neutral"
  ) {
    targets.push("Neutral");
  }
  return Array.from(new Set(targets));
}
