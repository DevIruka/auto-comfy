export function parseLeadingNumber(name: string): string | null {
  const m = name.trim().match(/^(\d+)\b/);
  return m?.[1] ?? null;
}

export function parseSpotNumber(name: string): string | null {
  const m = name.match(/\bspot\s*-?\s*(\d+)/i);
  return m?.[1] ?? null;
}

/**
 * Exact name wins. Otherwise unique (leading number + spot number) match.
 * 0 or 2+ matches → null (caller skips auto-load).
 */
export function resolveWorkspacePresetName(
  workspaceName: string,
  presetNames: string[],
): string | null {
  const preferred = workspaceName.trim();
  if (!preferred) return null;
  if (presetNames.includes(preferred)) return preferred;

  const num = parseLeadingNumber(preferred);
  const spot = parseSpotNumber(preferred);
  if (!num || !spot) return null;

  const matches = presetNames.filter(
    (name) => parseLeadingNumber(name) === num && parseSpotNumber(name) === spot,
  );
  return matches.length === 1 ? matches[0] : null;
}
