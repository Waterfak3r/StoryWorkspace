import "server-only";

import { comicsStylePresetIdSchema, type StudioStyle } from "../domain";
import { StudioValidationError } from "../errors";
import { readStyle, updateStyle } from "../fs";
import { requireComicsStylePreset } from "./catalog";

export function selectComicsStyle(projectId: string, presetId: string): StudioStyle {
  const parsed = comicsStylePresetIdSchema.safeParse(presetId);
  if (!parsed.success) {
    throw new StudioValidationError("Unknown comics style.", "presetId");
  }
  const preset = requireComicsStylePreset(parsed.data);
  return updateStyle(projectId, {
    presetId: preset.id,
    label: preset.label,
    visual: preset.visual,
  });
}

export function readProjectStyle(projectId: string): StudioStyle {
  return readStyle(projectId);
}
