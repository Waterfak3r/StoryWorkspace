import "server-only";

import {
  contextSnapshotSchema,
  type StudioContentStatePatch,
  type StudioContextSnapshot,
  type StudioEntity,
  type StudioScene,
  type StudioShot,
  type StudioStyle,
} from "../domain";
import { StudioNotFoundError } from "../errors";
import { readContentState, readEntity, readScene, readStyle } from "../fs";
import { listScenesInStoryOrder } from "../state/story-order";

const STORY_POSITION_LIMIT = 8;
const STORY_POSITION_SUMMARY_MAX = 240;

export function resolveContext(input: {
  projectId: string;
  volumeId: string;
  chapterId: string;
  sceneId: string;
  shotId: string;
}): StudioContextSnapshot {
  const scene = readScene(input.projectId, input.volumeId, input.chapterId, input.sceneId);
  const style = readStyle(input.projectId);
  const entities = loadReferencedEntities(input.projectId, scene);
  const prior = priorStoryScenes(input.projectId, input.volumeId, input.chapterId, input.sceneId);
  const priorPatches = prior.flatMap(
    (item) => readContentState(input.projectId, item.volumeId, item.chapterId, item.sceneId)?.patches ?? [],
  );
  const currentPatches =
    readContentState(input.projectId, input.volumeId, input.chapterId, input.sceneId)?.patches ?? [];
  return buildContextSnapshot({
    scene,
    style,
    entities,
    shotId: input.shotId,
    storyPosition: {
      events: prior.slice(-STORY_POSITION_LIMIT).map((item) => ({
        title: item.title,
        summary: truncateSummary(item.summary),
      })),
    },
    priorPatches: [...priorPatches, ...currentPatches],
  });
}

export function buildContextSnapshot(input: {
  scene: StudioScene;
  style: StudioStyle;
  entities: readonly StudioEntity[];
  shotId: string;
  storyPosition?: { events: { title: string; summary: string }[] };
  priorPatches?: readonly StudioContentStatePatch[];
}): StudioContextSnapshot {
  const index = input.scene.shots.findIndex((shot) => shot.id === input.shotId);
  const shot = input.scene.shots[index];
  if (index < 0 || !shot) {
    throw new StudioNotFoundError("Shot not found.");
  }

  return contextSnapshotSchema.parse({
    scene: {
      id: input.scene.id,
      title: input.scene.title,
      script: input.scene.script,
      intent: input.scene.intent,
    },
    entities: input.entities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      description: entity.description,
      visual: {
        base: entity.visual.base,
        references: [...entity.visual.references],
        spatial: entity.visual.spatial ?? "",
      },
      state: stackedEntityState(entity, input.priorPatches ?? []),
    })),
    style: {
      id: input.style.id,
      label: input.style.label,
      visual: input.style.visual,
    },
    intent: input.scene.intent,
    shot: {
      id: shot.id,
      purpose: shot.purpose,
      action: shot.action,
      camera: shot.camera,
    },
    continuity: continuityFor(input.scene.shots, shot, index),
    storyPosition: input.storyPosition ?? { events: [] },
  });
}

function stackedEntityState(
  entity: StudioEntity,
  patches: readonly StudioContentStatePatch[],
): { outfit: string; condition: string } {
  let outfit = entity.states.default.outfit;
  let condition = entity.states.default.condition;
  for (const patch of patches) {
    if (patch.entityId !== entity.id) {
      continue;
    }
    if (patch.outfit !== undefined) {
      outfit = patch.outfit;
    }
    if (patch.condition !== undefined) {
      condition = patch.condition;
    }
  }
  return { outfit, condition };
}

function priorStoryScenes(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
): { volumeId: string; chapterId: string; sceneId: string; title: string; summary: string }[] {
  const ordered = listScenesInStoryOrder(projectId).map((item) => ({
    volumeId: item.volumeId,
    chapterId: item.chapterId,
    sceneId: item.scene.id,
    title: item.scene.title,
    summary: item.scene.intent.trim() || item.scene.script.trim(),
  }));

  const currentIndex = ordered.findIndex(
    (item) => item.volumeId === volumeId && item.chapterId === chapterId && item.sceneId === sceneId,
  );
  if (currentIndex <= 0) {
    return [];
  }
  return ordered.slice(0, currentIndex);
}

function truncateSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= STORY_POSITION_SUMMARY_MAX) {
    return normalized;
  }
  return `${normalized.slice(0, STORY_POSITION_SUMMARY_MAX - 1).trimEnd()}…`;
}

function continuityFor(shots: readonly StudioShot[], shot: StudioShot, index: number) {
  const from = shot.continuity_from ?? (index > 0 ? shots[index - 1]?.id ?? null : null);
  const prior = from ? shots.find((candidate) => candidate.id === from) : undefined;
  return {
    from,
    prior: prior
      ? {
          action: prior.action,
          camera: prior.camera,
          purpose: prior.purpose,
        }
      : null,
  };
}

function loadReferencedEntities(projectId: string, scene: StudioScene): StudioEntity[] {
  const ids: string[] = [...scene.characters];
  if (scene.location && !ids.includes(scene.location)) {
    ids.push(scene.location);
  }
  for (const id of scene.props) {
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  for (const id of scene.costumes) {
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }

  const entities: StudioEntity[] = [];
  for (const id of ids) {
    try {
      entities.push(readEntity(projectId, id));
    } catch (error) {
      if (error instanceof StudioNotFoundError) {
        continue;
      }
      throw error;
    }
  }
  return entities;
}
