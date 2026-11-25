export const LORA_SLOT_COUNT = 7;
export const EXTRA_LORA_START = 4;

export interface LoraSlotState {
  enabled: boolean;
  loraName: string;
  strengthModel: number;
  strengthClip: number;
}

export function emptyLoraSlot(enabled = false): LoraSlotState {
  return { enabled, loraName: "", strengthModel: 1, strengthClip: 1 };
}

export function defaultLoraSlots(): LoraSlotState[] {
  return [
    emptyLoraSlot(true),
    emptyLoraSlot(true),
    emptyLoraSlot(false),
    emptyLoraSlot(false),
    emptyLoraSlot(false),
    emptyLoraSlot(false),
    emptyLoraSlot(false),
  ];
}

export function padLoraSlots(
  slots: Array<Partial<LoraSlotState> | undefined> | undefined,
): LoraSlotState[] {
  const mapped = (slots ?? []).map((s) => ({
    enabled: !!s?.enabled,
    loraName: s?.loraName ?? "",
    strengthModel: typeof s?.strengthModel === "number" ? s.strengthModel : 1,
    strengthClip: typeof s?.strengthClip === "number" ? s.strengthClip : 1,
  }));
  while (mapped.length < LORA_SLOT_COUNT) {
    mapped.push(emptyLoraSlot(false));
  }
  return mapped.slice(0, LORA_SLOT_COUNT);
}

export function extraLoraEnabledCount(slots: LoraSlotState[]): number {
  return slots.slice(EXTRA_LORA_START).filter((s) => s.enabled).length;
}

export function extraLoraLabel(slots: LoraSlotState[]): string {
  const n = extraLoraEnabledCount(slots);
  return n > 0 ? `Extra LoRA (5–7) · ${n} enabled` : "Extra LoRA (5–7)";
}
