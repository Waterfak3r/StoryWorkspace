import "server-only";

import {
  comicsStylePresetIdSchema,
  composeModeSchema,
  letteringModeSchema,
  pageLayoutSchema,
  type StudioStyle,
} from "../domain";
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

export function selectComicsLettering(projectId: string, lettering: string): StudioStyle {
  const parsed = letteringModeSchema.safeParse(lettering);
  if (!parsed.success) {
    throw new StudioValidationError("Unknown lettering mode.", "lettering");
  }
  return updateStyle(projectId, { lettering: parsed.data });
}

export function applyComicsStylePatch(
  projectId: string,
  input: { presetId?: string; lettering?: string; compose?: string; layout?: string },
): StudioStyle {
  let style = readStyle(projectId);
  if (input.presetId) {
    style = selectComicsStyle(projectId, input.presetId);
  }
  if (input.lettering) {
    style = selectComicsLettering(projectId, input.lettering);
  }
  const compose = parseOptionalCompose(input.compose);
  const layout = parseOptionalLayout(input.layout);
  if (compose !== undefined || layout !== undefined) {
    style = updateStyle(projectId, { compose, layout });
  }
  return style;
}

function parseOptionalCompose(value: string | undefined): StudioStyle["compose"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = composeModeSchema.safeParse(value);
  if (!parsed.success) {
    throw new StudioValidationError("Unknown compose mode.", "compose");
  }
  return parsed.data;
}

function parseOptionalLayout(value: string | undefined): StudioStyle["layout"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = pageLayoutSchema.safeParse(value);
  if (!parsed.success) {
    throw new StudioValidationError("Unknown page layout.", "layout");
  }
  return parsed.data;
}

export function readProjectStyle(projectId: string): StudioStyle {
  return readStyle(projectId);
}
