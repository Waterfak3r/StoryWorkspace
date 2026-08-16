import "server-only";

import {
  storyOutlineSchema,
  type StudioEntity,
  type StudioStoryOutline,
  type StudioStoryOutlineEntityRef,
} from "../domain";
import { readEntity, readProject, readScene, readTree } from "../fs";

export function assembleStoryOutline(projectId: string): StudioStoryOutline {
  const project = readProject(projectId);
  const tree = readTree(projectId);

  const outline = {
    projectId: project.id,
    title: project.title,
    volumes: tree.volumes.map((volume) => ({
      id: volume.id,
      title: volume.title,
      chapters: volume.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        scenes: chapter.scenes.map((sceneNode) => {
          const scene = readScene(projectId, volume.id, chapter.id, sceneNode.id);
          const linked = collectLinkedEntities(projectId, scene);
          return {
            id: scene.id,
            title: scene.title,
            intent: scene.intent,
            plot: scene.script,
            environment: linked.environment,
            entities: linked.entities,
            beats: scene.shots.map((shot) => ({
              id: shot.id,
              purpose: shot.purpose,
              action: shot.action,
              camera: shot.camera,
            })),
          };
        }),
      })),
    })),
  };

  return storyOutlineSchema.parse(outline);
}

function collectLinkedEntities(
  projectId: string,
  scene: { characters: string[]; location: string | null; props: string[]; costumes: string[] },
): { environment: StudioStoryOutlineEntityRef | null; entities: StudioStoryOutlineEntityRef[] } {
  const environment = scene.location ? toRef(tryReadEntity(projectId, scene.location)) : null;
  const entities: StudioStoryOutlineEntityRef[] = [];
  const seen = new Set<string>();

  for (const id of [...scene.characters, ...scene.props, ...scene.costumes]) {
    if (seen.has(id)) {
      continue;
    }
    const entity = tryReadEntity(projectId, id);
    if (!entity) {
      continue;
    }
    seen.add(id);
    const ref = toRef(entity);
    if (ref) {
      entities.push(ref);
    }
  }

  return { environment, entities };
}

function tryReadEntity(projectId: string, entityId: string): StudioEntity | null {
  try {
    return readEntity(projectId, entityId);
  } catch {
    return null;
  }
}

function toRef(entity: StudioEntity | null): StudioStoryOutlineEntityRef | null {
  if (!entity) {
    return null;
  }
  return { id: entity.id, kind: entity.kind, name: entity.name };
}
