import "server-only";

import {
  STUDIO_ENTITY_KINDS,
  storyOutlineSchema,
  type StudioEntity,
  type StudioScene,
  type StudioStoryOutline,
  type StudioStoryOutlineEntityRef,
  type StudioStoryTimelineEntity,
  type StudioStoryTimelineStateChange,
} from "../domain";
import { listEntities, readContentState, readEntity, readProject, readScene, readTree } from "../fs";
import { buildStoryTimeline, type TimelineEventInput } from "./build-timeline";

export function assembleStoryOutline(projectId: string): StudioStoryOutline {
  const project = readProject(projectId);
  const tree = readTree(projectId);
  const characters = listEntities(projectId, "character").map((entity) => ({
    id: entity.id,
    name: entity.name,
  }));
  const events: TimelineEventInput[] = [];
  const scenes: { scene: StudioScene; volumeId: string; chapterId: string }[] = [];

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
          scenes.push({ scene, volumeId: volume.id, chapterId: chapter.id });
          events.push({
            title: scene.title,
            volumeId: volume.id,
            chapterId: chapter.id,
            sceneId: scene.id,
            summary: scene.intent.trim() || scene.script.trim(),
            participantIds: scene.characters,
          });
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
    timeline: buildStoryTimeline({
      characters,
      events,
      volumes: tree.volumes.map((volume) => ({
        id: volume.id,
        title: volume.title,
        chapters: volume.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
        })),
      })),
      reservedIds: STUDIO_ENTITY_KINDS.flatMap((kind) =>
        listEntities(projectId, kind).map((entity) => entity.id),
      ),
    }),
  };

  const timeline = outline.timeline;
  return storyOutlineSchema.parse({
    ...outline,
    timeline: {
      ...timeline,
      entities: assembleTimelineEntities(projectId, scenes, timeline.events),
      stateChanges: assembleStateChanges(projectId, scenes, timeline.events),
    },
  });
}

function assembleTimelineEntities(
  projectId: string,
  scenes: readonly { scene: StudioScene; volumeId: string; chapterId: string }[],
  events: readonly { id: string; volumeId: string; chapterId: string; sceneId: string }[],
): StudioStoryTimelineEntity[] {
  const byId = new Map<string, { entity: StudioEntity; appearanceEventIds: string[] }>();

  for (const entity of [...listEntities(projectId, "character"), ...listEntities(projectId, "location")]) {
    byId.set(entity.id, { entity, appearanceEventIds: [] });
  }

  for (const item of scenes) {
    const event = events.find(
      (candidate) =>
        candidate.volumeId === item.volumeId &&
        candidate.chapterId === item.chapterId &&
        candidate.sceneId === item.scene.id,
    );
    for (const entityId of referencedEntityIds(item.scene)) {
      let entry = byId.get(entityId);
      if (!entry) {
        const entity = tryReadEntity(projectId, entityId);
        if (!entity) {
          continue;
        }
        entry = { entity, appearanceEventIds: [] };
        byId.set(entityId, entry);
      }
      if (event && !entry.appearanceEventIds.includes(event.id)) {
        entry.appearanceEventIds.push(event.id);
      }
    }
  }

  return [...byId.values()]
    .map(({ entity, appearanceEventIds }) => ({
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      description: entity.description,
      visualBase: entity.visual.base,
      appearanceEventIds,
    }))
    .sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
}

function assembleStateChanges(
  projectId: string,
  scenes: readonly { scene: StudioScene; volumeId: string; chapterId: string }[],
  events: readonly { id: string; volumeId: string; chapterId: string; sceneId: string }[],
): StudioStoryTimelineStateChange[] {
  const changes: StudioStoryTimelineStateChange[] = [];

  for (const item of scenes) {
    const state = readContentState(projectId, item.volumeId, item.chapterId, item.scene.id);
    if (!state || state.patches.length === 0) {
      continue;
    }
    const event = events.find(
      (candidate) =>
        candidate.volumeId === item.volumeId &&
        candidate.chapterId === item.chapterId &&
        candidate.sceneId === item.scene.id,
    );
    if (!event) {
      continue;
    }
    for (const patch of state.patches) {
      const change: StudioStoryTimelineStateChange = {
        entityId: patch.entityId,
        eventId: event.id,
        truth: patch.truth,
      };
      if (patch.condition !== undefined) {
        change.condition = patch.condition;
      }
      if (patch.outfit !== undefined) {
        change.outfit = patch.outfit;
      }
      changes.push(change);
    }
  }

  return changes;
}

function referencedEntityIds(scene: StudioScene): string[] {
  const ids = [...scene.characters, ...scene.props, ...scene.costumes];
  if (scene.location) {
    ids.push(scene.location);
  }
  return ids;
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
