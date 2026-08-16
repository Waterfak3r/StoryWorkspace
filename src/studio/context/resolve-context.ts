import "server-only";

import {
  contextSnapshotSchema,
  type StudioContextSnapshot,
  type StudioEntity,
  type StudioScene,
  type StudioShot,
  type StudioStyle,
} from "../domain";
import { StudioNotFoundError } from "../errors";
import { readEntity, readScene, readStyle } from "../fs";

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
  return buildContextSnapshot({ scene, style, entities, shotId: input.shotId });
}

export function buildContextSnapshot(input: {
  scene: StudioScene;
  style: StudioStyle;
  entities: readonly StudioEntity[];
  shotId: string;
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
      visual: { base: entity.visual.base, references: [...entity.visual.references] },
      state: { outfit: entity.states.default.outfit, condition: entity.states.default.condition },
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
  });
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
