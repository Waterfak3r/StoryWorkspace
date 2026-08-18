import type { PageLayout } from "../domain";

export type PlannedPageShot = {
  shotId: string;
  pageId: string;
  panelIndex: number;
};

export function planScenePages(
  sceneId: string,
  shots: readonly { id: string }[],
  layout: PageLayout | number,
): PlannedPageShot[] {
  const sizes = pageSizesForShotCount(shots.length, layout);
  const planned: PlannedPageShot[] = [];
  let offset = 0;
  for (let pageIndex = 0; pageIndex < sizes.length; pageIndex += 1) {
    const size = sizes[pageIndex] ?? 0;
    const pageId = scenePageId(sceneId, pageIndex + 1);
    for (let panelIndex = 0; panelIndex < size; panelIndex += 1) {
      const shot = shots[offset];
      if (!shot) {
        break;
      }
      planned.push({ shotId: shot.id, pageId, panelIndex });
      offset += 1;
    }
  }
  return planned;
}

export function pageSizesForShotCount(count: number, layout: PageLayout | number): number[] {
  if (count <= 0) {
    return [];
  }
  if (typeof layout === "number" || layout === "2" || layout === "3" || layout === "4") {
    const size = typeof layout === "number" ? layout : Number(layout);
    if (!Number.isFinite(size) || size <= 0) {
      return autoPageSizes(count);
    }
    const sizes: number[] = [];
    for (let remaining = count; remaining > 0; remaining -= size) {
      sizes.push(Math.min(size, remaining));
    }
    return sizes;
  }
  return autoPageSizes(count);
}

export function scenePageId(sceneId: string, pageNumber: number): string {
  const sceneSlug = sceneId.replace(/^scene-/, "");
  return `page-${sceneSlug}-${String(pageNumber).padStart(2, "0")}`;
}

function autoPageSizes(count: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [1];
  }
  const rem = count % 3;
  if (rem === 0) {
    return Array.from({ length: count / 3 }, () => 3);
  }
  if (rem === 1) {
    return [4, ...Array.from({ length: (count - 4) / 3 }, () => 3)];
  }
  if (count === 2) {
    return [2];
  }
  if (count === 5) {
    return [3, 2];
  }
  return [4, 4, ...Array.from({ length: (count - 8) / 3 }, () => 3)];
}
