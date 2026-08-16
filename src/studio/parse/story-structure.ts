import type { ProposedScene } from "./schemas";

const DEFAULT_VOLUME_NAME = "Volume 1";

export function ensureStoryStructure(scenes: ProposedScene[]): ProposedScene[] {
  if (scenes.length === 0) {
    return scenes;
  }

  const carried = carryForwardStructure(scenes);
  const named = carried.filter((scene) => scene.chapterName.trim().length > 0);
  if (named.length === scenes.length) {
    return carried.map((scene) => ({
      ...scene,
      volumeName: scene.volumeName.trim() || DEFAULT_VOLUME_NAME,
      chapterName: scene.chapterName.trim(),
    }));
  }

  if (named.length === 0 && scenes.length >= 3) {
    return deriveChapters(carried);
  }

  return carried.map((scene, index) => ({
    ...scene,
    volumeName: scene.volumeName.trim() || DEFAULT_VOLUME_NAME,
    chapterName: scene.chapterName.trim() || carried[index - 1]?.chapterName.trim() || scene.title || `Chapter ${index + 1}`,
  }));
}

function carryForwardStructure(scenes: ProposedScene[]): ProposedScene[] {
  let volumeName = "";
  let chapterName = "";
  return scenes.map((scene) => {
    const nextVolume = scene.volumeName.trim() || volumeName;
    const nextChapter = scene.chapterName.trim() || chapterName;
    if (nextVolume) {
      volumeName = nextVolume;
    }
    if (nextChapter) {
      chapterName = nextChapter;
    }
    return {
      ...scene,
      volumeName: nextVolume,
      chapterName: nextChapter,
    };
  });
}

function deriveChapters(scenes: ProposedScene[]): ProposedScene[] {
  const groupSize = scenes.length <= 4 ? 2 : 3;
  const titles: string[] = [];
  return scenes.map((scene, index) => {
    const group = Math.floor(index / groupSize);
    if (titles[group] === undefined) {
      titles[group] = scene.title.trim() || `Chapter ${group + 1}`;
    }
    return {
      ...scene,
      volumeName: scene.volumeName.trim() || DEFAULT_VOLUME_NAME,
      chapterName: titles[group]!,
    };
  });
}
