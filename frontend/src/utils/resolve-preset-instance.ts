export function resolvePresetInstanceId(
  saved: string | undefined,
  instances: { id: string }[],
): string {
  if (saved && instances.some((i) => i.id === saved)) return saved;
  return instances[0]?.id ?? "";
}
