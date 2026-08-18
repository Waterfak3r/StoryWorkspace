import "server-only";

import type { StudioScene } from "../domain";
import { readScene, readTree } from "../fs";
import { distinctiveSpans } from "../parse/preserve-scripts";
import { listParseRuns } from "../parse/runs";

export type LocatedStoryScene = {
  volumeId: string;
  chapterId: string;
  scene: StudioScene;
};

export function listScenesInStoryOrder(projectId: string): LocatedStoryScene[] {
  const treeScenes = listScenesInTreeOrder(projectId);
  const source = latestConfirmedSource(projectId);
  if (!source) {
    return treeScenes;
  }

  return treeScenes
    .map((item, treeIndex) => ({
      item,
      treeIndex,
      sourceIndex: scriptSourceIndex(source, item.scene.script),
    }))
    .sort((left, right) => {
      if (left.sourceIndex !== right.sourceIndex) {
        return left.sourceIndex - right.sourceIndex;
      }
      return left.treeIndex - right.treeIndex;
    })
    .map((entry) => entry.item);
}

export function listScenesInTreeOrder(projectId: string): LocatedStoryScene[] {
  const scenes: LocatedStoryScene[] = [];
  for (const volume of readTree(projectId).volumes) {
    for (const chapter of volume.chapters) {
      for (const node of chapter.scenes) {
        scenes.push({
          volumeId: volume.id,
          chapterId: chapter.id,
          scene: readScene(projectId, volume.id, chapter.id, node.id),
        });
      }
    }
  }
  return scenes;
}

function latestConfirmedSource(projectId: string): string | null {
  const confirmed = listParseRuns(projectId).filter((run) => run.status === "confirmed");
  const latest = confirmed[confirmed.length - 1];
  const text = latest?.sourceText.trim() ?? "";
  return text.length > 0 ? text : null;
}

function scriptSourceIndex(source: string, script: string): number {
  const hay = foldForIndex(source);
  if (!hay) {
    return Number.POSITIVE_INFINITY;
  }

  let best = Number.POSITIVE_INFINITY;
  for (const span of distinctiveSpans(script)) {
    const needle = foldForIndex(span);
    if (!needle) {
      continue;
    }
    const index = hay.indexOf(needle);
    if (index >= 0 && index < best) {
      best = index;
    }
  }

  if (best !== Number.POSITIVE_INFINITY) {
    return best;
  }

  const whole = foldForIndex(script);
  if (!whole) {
    return Number.POSITIVE_INFINITY;
  }
  const clipped = whole.slice(0, Math.min(80, whole.length));
  const index = hay.indexOf(clipped);
  return index >= 0 ? index : Number.POSITIVE_INFINITY;
}

function foldForIndex(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
