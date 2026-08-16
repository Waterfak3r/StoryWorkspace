import "server-only";

import {
  createChapter,
  createEntity,
  createScene,
  createVolume,
  listEntities,
  readScene,
  readTree,
  updateEntity,
  updateScene,
} from "../fs";
import { StudioConflictError, StudioNotFoundError } from "../errors";
import type { StudioEntity, StudioParseProvenance, StudioScene } from "../domain";
import { nowIso, readParseRun, writeParseRun } from "./runs";
import { confirmParseInputSchema, type ConfirmParseInput, type ProposedEntity, type ProposedScene, type StudioParseRun } from "./schemas";

const DEFAULT_VOLUME_ID = "volume-01";
const DEFAULT_CHAPTER_ID = "chapter-01";

const SCENE_FIELDS = ["title", "script", "intent"] as const;
const ENTITY_FIELDS = ["name", "description"] as const;

type LocatedScene = {
  volumeId: string;
  chapterId: string;
  scene: StudioScene;
};

export async function confirmParseRun(
  projectId: string,
  runId: string,
  input: ConfirmParseInput = {},
): Promise<{ run: StudioParseRun; scenes: StudioScene[]; entities: StudioEntity[] }> {
  const values = confirmParseInputSchema.parse(input);
  const overwriteCanon = new Set(values.overwriteCanon ?? []);
  const run = readParseRun(projectId, runId);
  if (run.status !== "pending") {
    throw new StudioConflictError(
      run.status === "confirmed" ? "This parse run is already confirmed." : "This parse run was rejected.",
    );
  }

  const target = resolveConfirmTarget(projectId, values.volumeId, values.chapterId);

  const confirmedAt = nowIso();
  const provenance: StudioParseProvenance = {
    source: "parse",
    parseRunId: run.id,
    confirmedAt,
  };

  const existingEntities = [
    ...listEntities(projectId, "character"),
    ...listEntities(projectId, "location"),
    ...listEntities(projectId, "prop"),
    ...listEntities(projectId, "costume"),
  ];
  const writtenEntities: StudioEntity[] = [];

  for (const proposed of run.proposedEntities) {
    writtenEntities.push(applyProposedEntity(projectId, proposed, existingEntities, overwriteCanon, provenance));
  }

  const entitiesByName = new Map<string, StudioEntity>();
  for (const entity of [...existingEntities, ...writtenEntities]) {
    entitiesByName.set(nameKey(entity.kind, entity.name), entity);
  }

  const existingScenes = listLocatedScenes(projectId);
  const writtenScenes: StudioScene[] = [];

  for (const proposed of run.proposedScenes) {
    writtenScenes.push(
      applyProposedScene(projectId, proposed, existingScenes, entitiesByName, overwriteCanon, provenance, target),
    );
  }

  const confirmed: StudioParseRun = {
    ...run,
    status: "confirmed",
    updatedAt: nowIso(run.updatedAt),
  };

  return {
    run: writeParseRun(projectId, confirmed),
    scenes: writtenScenes,
    entities: writtenEntities,
  };
}

function applyProposedEntity(
  projectId: string,
  proposed: ProposedEntity,
  existingEntities: StudioEntity[],
  overwriteCanon: Set<string>,
  provenance: StudioParseProvenance,
): StudioEntity {
  const matched = existingEntities.find(
    (entity) => entity.kind === proposed.kind && namesEqual(entity.name, proposed.name),
  );

  if (!matched) {
    const created = createEntity(projectId, { kind: proposed.kind, name: proposed.name });
    const written = updateEntity(projectId, created.id, {
      description: proposed.description,
      expectedUpdatedAt: created.updatedAt,
      provenance,
      canonFields: [...ENTITY_FIELDS],
    });
    existingEntities.push(written);
    return written;
  }

  const patch: { name?: string; description?: string } = {};
  if (mayWrite(proposed.key, "name", matched, overwriteCanon) && proposed.name !== matched.name) {
    patch.name = proposed.name;
  }
  if (mayWrite(proposed.key, "description", matched, overwriteCanon) && proposed.description !== matched.description) {
    patch.description = proposed.description;
  }

  if (Object.keys(patch).length === 0) {
    return matched;
  }

  const written = updateEntity(projectId, matched.id, {
    ...patch,
    expectedUpdatedAt: matched.updatedAt,
    provenance,
    canonFields: mergeCanonFields(matched.canonFields, ENTITY_FIELDS),
  });
  const index = existingEntities.findIndex((entity) => entity.id === written.id);
  if (index >= 0) {
    existingEntities[index] = written;
  }
  return written;
}

function applyProposedScene(
  projectId: string,
  proposed: ProposedScene,
  existingScenes: LocatedScene[],
  entitiesByName: Map<string, StudioEntity>,
  overwriteCanon: Set<string>,
  provenance: StudioParseProvenance,
  target: { volumeId: string; chapterId: string },
): StudioScene {
  const matched = existingScenes.find((entry) => namesEqual(entry.scene.title, proposed.title));
  const characters = resolveEntityIds("character", proposed.characterNames, entitiesByName);
  const location = resolveLocationId(proposed.locationName, entitiesByName);
  const props = resolveEntityIds("prop", proposed.propNames, entitiesByName);
  const costumes = resolveEntityIds("costume", proposed.costumeNames, entitiesByName);

  if (!matched) {
    const { volumeId, chapterId } = target;
    const created = createScene(projectId, volumeId, chapterId, { title: proposed.title });
    const written = updateScene(projectId, volumeId, chapterId, created.id, {
      title: proposed.title,
      script: proposed.script,
      intent: proposed.intent,
      characters,
      location,
      props,
      costumes,
      expectedUpdatedAt: created.updatedAt,
      provenance,
      canonFields: [...SCENE_FIELDS],
    });
    existingScenes.push({ volumeId, chapterId, scene: written });
    return written;
  }

  const patch: {
    title?: string;
    script?: string;
    intent?: string;
  } = {};
  if (mayWrite(proposed.key, "title", matched.scene, overwriteCanon) && proposed.title !== matched.scene.title) {
    patch.title = proposed.title;
  }
  if (mayWrite(proposed.key, "script", matched.scene, overwriteCanon) && proposed.script !== matched.scene.script) {
    patch.script = proposed.script;
  }
  if (mayWrite(proposed.key, "intent", matched.scene, overwriteCanon) && proposed.intent !== matched.scene.intent) {
    patch.intent = proposed.intent;
  }

  if (Object.keys(patch).length === 0) {
    return matched.scene;
  }

  const written = updateScene(projectId, matched.volumeId, matched.chapterId, matched.scene.id, {
    ...patch,
    expectedUpdatedAt: matched.scene.updatedAt,
    provenance,
    canonFields: mergeCanonFields(matched.scene.canonFields, SCENE_FIELDS),
  });
  matched.scene = written;
  return written;
}

function mayWrite(
  proposedKey: string,
  field: string,
  existing: { canonFields?: string[] },
  overwriteCanon: Set<string>,
): boolean {
  if (overwriteCanon.has(`${proposedKey}.${field}`)) {
    return true;
  }
  if (!existing.canonFields || existing.canonFields.length === 0) {
    return false;
  }
  return !existing.canonFields.includes(field);
}

function mergeCanonFields(current: string[] | undefined, fields: readonly string[]): string[] {
  return [...new Set([...(current ?? []), ...fields])];
}

function namesEqual(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function nameKey(kind: string, name: string): string {
  return `${kind}:${name.trim().toLowerCase()}`;
}

function resolveEntityIds(
  kind: "character" | "prop" | "costume",
  names: string[],
  entitiesByName: Map<string, StudioEntity>,
): string[] {
  const ids: string[] = [];
  for (const name of names) {
    const entity = entitiesByName.get(nameKey(kind, name));
    if (entity && !ids.includes(entity.id)) {
      ids.push(entity.id);
    }
  }
  return ids;
}

function resolveLocationId(name: string | null, entitiesByName: Map<string, StudioEntity>): string | null {
  if (!name || name.trim() === "") {
    return null;
  }
  return entitiesByName.get(nameKey("location", name))?.id ?? null;
}

function resolveConfirmTarget(
  projectId: string,
  volumeId?: string,
  chapterId?: string,
): { volumeId: string; chapterId: string } {
  if (!volumeId || !chapterId) {
    return ensureDefaultChapter(projectId);
  }

  const tree = readTree(projectId);
  const volume = tree.volumes.find((item) => item.id === volumeId);
  if (!volume) {
    throw new StudioNotFoundError("Volume not found.");
  }
  if (!volume.chapters.some((chapter) => chapter.id === chapterId)) {
    throw new StudioNotFoundError("Chapter not found.");
  }

  return { volumeId, chapterId };
}

function listLocatedScenes(projectId: string): LocatedScene[] {
  const tree = readTree(projectId);
  const scenes: LocatedScene[] = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const item of chapter.scenes) {
        scenes.push({
          volumeId: volume.id,
          chapterId: chapter.id,
          scene: readScene(projectId, volume.id, chapter.id, item.id),
        });
      }
    }
  }
  return scenes;
}

function ensureDefaultChapter(projectId: string): { volumeId: string; chapterId: string } {
  const tree = readTree(projectId);
  if (!tree.volumes.some((volume) => volume.id === DEFAULT_VOLUME_ID)) {
    createVolume(projectId, { id: DEFAULT_VOLUME_ID });
  }

  const nextTree = readTree(projectId);
  const volume = nextTree.volumes.find((item) => item.id === DEFAULT_VOLUME_ID);
  if (!volume?.chapters.some((chapter) => chapter.id === DEFAULT_CHAPTER_ID)) {
    createChapter(projectId, DEFAULT_VOLUME_ID, { id: DEFAULT_CHAPTER_ID });
  }

  return { volumeId: DEFAULT_VOLUME_ID, chapterId: DEFAULT_CHAPTER_ID };
}
