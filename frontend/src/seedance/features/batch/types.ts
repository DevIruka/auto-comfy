import type { ImageFile } from "../../types/app";

export type BatchSettingsPatch = Partial<
  Omit<ImageFile, "id" | "file" | "preview" | "name">
>;
