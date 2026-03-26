/** Append a single path segment; preserves backslash style when base uses Windows separators. */
export function joinWorkspaceSubfolder(base: string, segment: string): string {
  const b = base.trim().replace(/[/\\]+$/, "");
  const s = segment.replace(/^[/\\]+/, "");
  if (!b) return s;
  const sep = b.includes("\\") ? "\\" : "/";
  return `${b}${sep}${s}`;
}

/** Last `segmentCount` path segments only (Drive/UNC-safe). Full path: use `title` on the element. */
export function pathDisplayTail(absolutePath: string, segmentCount = 4): string {
  const trimmed = absolutePath.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/[/\\]+/).filter((p) => p.length > 0);
  const sep = trimmed.includes("\\") ? "\\" : "/";
  return parts.slice(-segmentCount).join(sep);
}
