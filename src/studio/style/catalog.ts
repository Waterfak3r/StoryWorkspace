import {
  DEFAULT_COMICS_STYLE_PRESET_ID,
  DEFAULT_COMICS_STYLE_VISUAL,
  type ComicsStylePresetId,
} from "../domain";

export type ComicsStylePreset = {
  id: ComicsStylePresetId;
  label: string;
  visual: string;
};

export const COMICS_STYLE_PRESETS: readonly ComicsStylePreset[] = [
  {
    id: "sequential-ink",
    label: "Sequential ink",
    visual: DEFAULT_COMICS_STYLE_VISUAL,
  },
  {
    id: "shonen-manga",
    label: "Shonen manga",
    visual:
      "Black-and-white shonen manga; crisp ink contours; screentone shadows; speed lines; expressive eyes; consistent character sheets reused across panels; no photorealism; leave space for speech balloons.",
  },
  {
    id: "ligne-claire",
    label: "Ligne claire",
    visual:
      "Franco-Belgian ligne claire comics; even ink weights; flat colors; clear silhouettes; uncluttered backgrounds; no photorealism; leave space for speech balloons.",
  },
  {
    id: "watercolor-indie",
    label: "Watercolor indie",
    visual:
      "Indie watercolor comics; soft pigment washes; visible paper grain; muted palette; inked outlines; consistent faces; leave space for speech balloons.",
  },
  {
    id: "noir-comics",
    label: "Noir comics",
    visual:
      "High-contrast noir comics; heavy blacks; rain-slick streets; cinematic framing; limited color; inked faces reused across panels; leave space for speech balloons.",
  },
];

export { DEFAULT_COMICS_STYLE_PRESET_ID };

export function comicsStyleById(presetId: string): ComicsStylePreset | null {
  return COMICS_STYLE_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function requireComicsStylePreset(presetId: string): ComicsStylePreset {
  const preset = comicsStyleById(presetId);
  if (!preset) {
    throw new Error(`Unknown comics style: ${presetId}`);
  }
  return preset;
}
