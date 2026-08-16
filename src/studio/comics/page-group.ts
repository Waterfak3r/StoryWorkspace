import { COMICS_PANELS_PER_PAGE } from "../domain";

export function comicsPageStartIndex(shotIndex: number, size = COMICS_PANELS_PER_PAGE): number {
  return Math.floor(shotIndex / size) * size;
}

export function comicsPageGroup<T>(shots: readonly T[], shotIndex: number, size = COMICS_PANELS_PER_PAGE): T[] {
  const start = comicsPageStartIndex(shotIndex, size);
  return shots.slice(start, start + size);
}

export function comicsPageId(sceneId: string, shotIndex: number, size = COMICS_PANELS_PER_PAGE): string {
  const group = Math.floor(shotIndex / size) + 1;
  const sceneSlug = sceneId.replace(/^scene-/, "");
  return `page-${sceneSlug}-${String(group).padStart(2, "0")}`;
}

export function comicsPageLayoutLabel(panelCount: number): string {
  if (panelCount <= 1) {
    return "one full-page panel";
  }
  if (panelCount === 2) {
    return "two stacked panels, top then bottom";
  }
  if (panelCount === 3) {
    return "three panels: two on the top row (left then right), one wide panel on the bottom";
  }
  return "four panels in a 2x2 grid, left-to-right then top-to-bottom";
}
