import "server-only";

import { planScenePages } from "../comics/plan-pages";
import { confirmSceneDialogue, reassignSceneDialogue, sceneHasUnassignedSpeech } from "../dialogue";
import { directSceneAsync, type SceneDirector } from "../director";
import { readScene, readStyle, readTree, replaceSceneShots } from "../fs";
import { listScenesInStoryOrder } from "../state/story-order";
import { scriptMostlyCoveredBy } from "../parse/preserve-scripts";
import type { ImageAdapter } from "../generate/adapter";
import { generateShot } from "../generate/generate-shot";
import { comicsCurrentPagePath, isRenderableComicsFile } from "../generate/image-output";
import { projectFileExists, resolveProjectRelativeFile } from "../generate/workflow-store";

export type StartWorkflowResult = {
  directed: string[];
  confirmed: string[];
  generated: string[];
  skipped: string[];
};

export type StartWorkflowOptions = {
  adapter?: ImageAdapter;
  director?: SceneDirector;
};

export async function startWorkflow(
  projectId: string,
  options: StartWorkflowOptions = {},
): Promise<StartWorkflowResult> {
  const directed: string[] = [];
  const confirmed: string[] = [];
  const generated: string[] = [];
  const skipped: string[] = [];
  const { writeInferredSceneStatesAsync } = await import("../state/infer-scene-state");
  await writeInferredSceneStatesAsync(projectId);

  const layout = readStyle(projectId).layout;
  const storyScenes = listScenesInStoryOrder(projectId);

  // Parse evidence first. The first pass may leave dialogue unassigned; shot
  // references are attached only after a storyboard exists.
  for (const located of storyScenes) {
    const scene = readScene(projectId, located.volumeId, located.chapterId, located.scene.id);
    if (scene.dialogue.status !== "confirmed") {
      await confirmSceneDialogue(projectId, located.volumeId, located.chapterId, scene.id);
      confirmed.push(scene.id);
    }
  }

  for (const located of storyScenes) {
    let scene = readScene(projectId, located.volumeId, located.chapterId, located.scene.id);
    if (scene.shots.length > 0) {
      continue;
    }
    if (scriptMostlyCoveredBy(scene.script, directedScripts(projectId))) {
      skipped.push(scene.id);
      continue;
    }
    scene = await directSceneAsync(projectId, located.volumeId, located.chapterId, scene.id, options.director);
    directed.push(scene.id);
  }

  for (const located of listScenesInStoryOrder(projectId)) {
    const scene = readScene(projectId, located.volumeId, located.chapterId, located.scene.id);
    if (scene.shots.length === 0 || scene.dialogue.status !== "confirmed" || !sceneHasUnassignedSpeech(scene)) {
      continue;
    }
    reassignSceneDialogue(projectId, located.volumeId, located.chapterId, scene.id);
    confirmed.push(scene.id);
  }

  for (const located of listScenesInStoryOrder(projectId)) {
        const scene = readScene(projectId, located.volumeId, located.chapterId, located.scene.id);
        if (scene.shots.length === 0) {
          continue;
        }
        const planned = planScenePages(scene.id, scene.shots, layout);
        const pageIds = uniquePageIds(planned);
        for (const pageId of pageIds) {
          const members = planned.filter((item) => item.pageId === pageId);
          const pageShots = members
            .slice()
            .sort((left, right) => left.panelIndex - right.panelIndex)
            .map((item) => scene.shots.find((shot) => shot.id === item.shotId))
            .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot));
          const locked = pageShots.some((shot) => shot.status === "locked");
          const alreadyImaged =
            pageShots.length > 0 && pageShots.every((shot) => Boolean(shot.selected_image?.trim()));
          const currentRenderable = currentPageIsRenderable(projectId, pageId);
          if (currentPageExists(projectId, pageId) && !currentRenderable) {
            demotePageShots(projectId, located.volumeId, located.chapterId, scene.id, pageShots);
          }
          const leftoverWithoutCurrent = alreadyImaged && !currentPageExists(projectId, pageId);
          if (locked || currentRenderable || leftoverWithoutCurrent) {
            skipped.push(pageId);
            continue;
          }
          const lead = pageShots[0];
          if (!lead) {
            skipped.push(pageId);
            continue;
          }
          await generateShot(
            projectId,
            located.volumeId,
            located.chapterId,
            scene.id,
            lead.id,
            { mode: "generate" },
            options.adapter,
          );
          generated.push(pageId);
        }
  }

  return { directed, confirmed, generated, skipped };
}

function uniquePageIds(planned: readonly { pageId: string }[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of planned) {
    if (seen.has(item.pageId)) {
      continue;
    }
    seen.add(item.pageId);
    ids.push(item.pageId);
  }
  return ids;
}

function currentPageExists(projectId: string, pageId: string): boolean {
  try {
    return projectFileExists(resolveProjectRelativeFile(projectId, comicsCurrentPagePath(pageId)));
  } catch {
    return false;
  }
}

function directedScripts(projectId: string): string[] {
  const scripts: string[] = [];
  const tree = readTree(projectId);
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        if (scene.shots.length > 0 && scene.script.trim()) {
          scripts.push(scene.script);
        }
      }
    }
  }
  return scripts;
}

function demotePageShots(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
  pageShots: readonly { id: string }[],
): void {
  const scene = readScene(projectId, volumeId, chapterId, sceneId);
  const ids = new Set(pageShots.map((shot) => shot.id));
  const now = new Date().toISOString();
  replaceSceneShots(
    projectId,
    volumeId,
    chapterId,
    sceneId,
    scene.shots.map((shot) =>
      ids.has(shot.id) ? { ...shot, status: "failed" as const, updatedAt: now } : shot,
    ),
  );
}

function currentPageIsRenderable(projectId: string, pageId: string): boolean {
  try {
    return isRenderableComicsFile(resolveProjectRelativeFile(projectId, comicsCurrentPagePath(pageId)));
  } catch {
    return false;
  }
}
