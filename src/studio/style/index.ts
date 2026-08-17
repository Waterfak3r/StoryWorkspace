import "server-only";

export {
  COMICS_STYLE_PRESETS,
  DEFAULT_COMICS_STYLE_PRESET_ID,
  comicsStyleById,
  requireComicsStylePreset,
  type ComicsStylePreset,
} from "./catalog";
export { readProjectStyle, selectComicsStyle } from "./select-style";
