import "server-only";

import { planScenePages } from "../comics/plan-pages";
import { confirmSceneDialogue, reassignSceneDialogue, sceneHasUnassignedSpeech } from "../dialogue";
import { directSceneAsync, type SceneDirector } from "../director";
import { STUDIO_ENTITY_KINDS } from "../domain";
import { listEntities, readScene, readStyle, readTree, replaceSceneShots, updateScene } from "../fs";
import { listScenesInStoryOrder } from "../state/story-order";
import { nameAppearsInText, scriptMostlyCoveredBy } from "../parse/preserve-scripts";
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
  const { writeInferredSceneStates } = await import("../state/infer-scene-state");
  writeInferredSceneStates(projectId);
  attachMentionedEntities(projectId);

  const layout = readStyle(projectId).layout;
  const storyScenes = listScenesInStoryOrder(projectId);

  for (const located of storyScenes) {
        let scene = readScene(projectId, located.volumeId, located.chapterId, located.scene.id);
        if (scene.shots.length === 0) {
          if (scriptMostlyCoveredBy(scene.script, directedScripts(projectId))) {
            skipped.push(scene.id);
            continue;
          }
          scene = await directSceneAsync(projectId, located.volumeId, located.chapterId, scene.id, options.director);
          directed.push(scene.id);
        }
        if (scene.shots.length > 0 && scene.dialogue.status !== "confirmed") {
          scene = await confirmSceneDialogue(projectId, located.volumeId, located.chapterId, scene.id);
          confirmed.push(scene.id);
        } else if (scene.shots.length > 0 && scene.dialogue.status === "confirmed") {
          const hadUnassigned = sceneHasUnassignedSpeech(scene);
          scene = reassignSceneDialogue(projectId, located.volumeId, located.chapterId, scene.id);
          if (hadUnassigned) {
            confirmed.push(scene.id);
          }
        }
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

function attachMentionedEntities(projectId: string): void {
  const catalog = STUDIO_ENTITY_KINDS.flatMap((kind) => listEntities(projectId, kind));
  const tree = readTree(projectId);
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const sceneNode of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
        if (!scene.script.trim()) {
          continue;
        }
        const characters = unionNamed(scene.characters, catalog, "character", scene.script);
        const props = unionNamed(scene.props, catalog, "prop", scene.script);
        const costumes = unionNamed(scene.costumes, catalog, "costume", scene.script);
        const location =
          scene.location ??
          catalog.find((entity) => entity.kind === "location" && entityNamedInScript(scene.script, entity.name))?.id ??
          null;
        if (
          characters.join("\0") === scene.characters.join("\0") &&
          props.join("\0") === scene.props.join("\0") &&
          costumes.join("\0") === scene.costumes.join("\0") &&
          location === scene.location
        ) {
          continue;
        }
        updateScene(projectId, volume.id, chapter.id, scene.id, {
          characters,
          location,
          props,
          costumes,
          expectedUpdatedAt: scene.updatedAt,
        });
      }
    }
  }
}

function entityNamedInScript(script: string, name: string): boolean {
  const foldedName = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hay = ` ${script.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, " ").replace(/\s+/g, " ")} `;
  if (foldedName && hay.includes(` ${foldedName} `)) {
    return true;
  }
  const tokens = foldedName.split(" ").filter((token) => token.length >= 4);
  if (tokens.length === 0) {
    return nameAppearsInText(script, name);
  }
  const noun = tokens[tokens.length - 1]!;
  return hay.includes(` ${noun} `);
}

function unionNamed(
  current: readonly string[],
  catalog: readonly { id: string; kind: string; name: string }[],
  kind: string,
  script: string,
): string[] {
  const next = [...current];
  const seen = new Set(current);
  for (const entity of catalog) {
    if (entity.kind !== kind || seen.has(entity.id) || !entityNamedInScript(script, entity.name)) {
      continue;
    }
    seen.add(entity.id);
    next.push(entity.id);
  }
  return next;
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
