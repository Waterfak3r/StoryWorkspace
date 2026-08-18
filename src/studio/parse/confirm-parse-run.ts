import "server-only";

import { DEFAULT_COMICS_STYLE_VISUAL } from "../domain";
import {
  createChapter,
  createEntity,
  createScene,
  createVolume,
  deleteScene,
  listEntities,
  readScene,
  readStyle,
  readTree,
  updateChapter,
  updateEntity,
  updateScene,
  updateStyle,
  updateVolume,
} from "../fs";
import { StudioConflictError, StudioNotFoundError } from "../errors";
import type { StudioEntity, StudioParseProvenance, StudioScene } from "../domain";
import { nowIso, readParseRun, writeParseRun } from "./runs";
import { scriptMostlyCoveredBy } from "./preserve-scripts";
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

  const fallback = resolveConfirmTarget(projectId, values.volumeId, values.chapterId);
  const useProposedStructure = hasDistinctChapters(run.proposedScenes);
  ensureComicsStyle(projectId);

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
    const target = useProposedStructure
      ? ensureVolumeAndChapter(projectId, proposed.volumeName, proposed.chapterName)
      : fallback;
    writtenScenes.push(
      applyProposedScene(projectId, proposed, existingScenes, entitiesByName, overwriteCanon, provenance, target),
    );
  }

  removeEmptyUntitledScenes(projectId);
  const { writeInferredSceneStates } = await import("../state/infer-scene-state");
  writeInferredSceneStates(projectId);

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
      visual: proposed.description.trim()
        ? {
            base: proposed.description.trim(),
            references: [],
            spatial: proposed.kind === "location" ? proposed.description.trim() : "",
          }
        : created.visual,
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
  const matched = matchExistingScene(proposed, existingScenes);
  const characters = resolveEntityIds("character", proposed.characterNames, entitiesByName);
  const location = resolveLocationId(proposed.locationName, entitiesByName);
  const props = resolveEntityIds("prop", proposed.propNames, entitiesByName);
  const costumes = resolveEntityIds("costume", proposed.costumeNames, entitiesByName);

  if (!matched) {
    if (isCoveredLeftover(proposed, existingScenes)) {
      const overlap = existingScenes.find((entry) =>
        scriptMostlyCoveredBy(entry.scene.script, [proposed.script]),
      );
      return (overlap ?? existingScenes[0]!).scene;
    }
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
    characters?: string[];
    location?: string | null;
    props?: string[];
    costumes?: string[];
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
  const nextCharacters = unionIds(matched.scene.characters, characters);
  if (nextCharacters.join("\0") !== matched.scene.characters.join("\0")) {
    patch.characters = nextCharacters;
  }
  if (!matched.scene.location && location) {
    patch.location = location;
  }
  const nextProps = unionIds(matched.scene.props, props);
  if (nextProps.join("\0") !== matched.scene.props.join("\0")) {
    patch.props = nextProps;
  }
  const nextCostumes = unionIds(matched.scene.costumes, costumes);
  if (nextCostumes.join("\0") !== matched.scene.costumes.join("\0")) {
    patch.costumes = nextCostumes;
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

function unionIds(current: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set(current);
  const next = [...current];
  for (const id of extra) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    next.push(id);
  }
  return next;
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

function matchExistingScene(
  proposed: ProposedScene,
  existingScenes: readonly LocatedScene[],
): LocatedScene | undefined {
  const byTitle = existingScenes.find((entry) => namesEqual(entry.scene.title, proposed.title));
  if (byTitle) {
    return byTitle;
  }
  return existingScenes.find((entry) => isMutualScriptMatch(proposed.script, entry.scene.script));
}

function isMutualScriptMatch(left: string, right: string): boolean {
  const shorter = Math.min(left.trim().length, right.trim().length);
  const longer = Math.max(left.trim().length, right.trim().length);
  if (shorter < 80 || longer === 0 || shorter / longer < 0.5) {
    return false;
  }
  return scriptMostlyCoveredBy(left, [right]) && scriptMostlyCoveredBy(right, [left]);
}

function isCoveredLeftover(proposed: ProposedScene, existingScenes: readonly LocatedScene[]): boolean {
  if (proposed.script.trim().length < 400) {
    return false;
  }
  return scriptMostlyCoveredBy(
    proposed.script,
    existingScenes.map((entry) => entry.scene.script),
  );
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

function hasDistinctChapters(scenes: ProposedScene[]): boolean {
  const names = new Set(scenes.map((scene) => scene.chapterName.trim().toLowerCase()).filter(Boolean));
  return names.size >= 2;
}

function ensureVolumeAndChapter(
  projectId: string,
  volumeName: string,
  chapterName: string,
): { volumeId: string; chapterId: string } {
  const volumeTitle = volumeName.trim() || "Volume 1";
  const chapterTitle = chapterName.trim() || "Chapter 1";
  const volumeId = ensureVolumeByTitle(projectId, volumeTitle);
  const chapterId = ensureChapterByTitle(projectId, volumeId, chapterTitle);
  return { volumeId, chapterId };
}

function ensureVolumeByTitle(projectId: string, title: string): string {
  const tree = readTree(projectId);
  const matched = tree.volumes.find((volume) => namesEqual(volume.title, title));
  if (matched) {
    return matched.id;
  }

  const only = tree.volumes.length === 1 ? tree.volumes[0] : undefined;
  if (only && isGenericVolumeTitle(only.title)) {
    const latest = readTree(projectId).volumes.find((volume) => volume.id === only.id);
    if (latest && !namesEqual(latest.title, title)) {
      updateVolume(projectId, latest.id, { title, expectedUpdatedAt: latest.updatedAt });
    }
    return only.id;
  }

  return createVolume(projectId, { title }).id;
}

function ensureChapterByTitle(projectId: string, volumeId: string, title: string): string {
  const tree = readTree(projectId);
  const volume = tree.volumes.find((item) => item.id === volumeId);
  const matched = volume?.chapters.find((chapter) => namesEqual(chapter.title, title));
  if (matched) {
    return matched.id;
  }

  const only = volume?.chapters.length === 1 ? volume.chapters[0] : undefined;
  if (only && isGenericChapterTitle(only.title) && chapterLooksEmpty(projectId, volumeId, only.id, only.scenes)) {
    updateChapter(projectId, volumeId, only.id, { title, expectedUpdatedAt: only.updatedAt });
    return only.id;
  }

  return createChapter(projectId, volumeId, { title }).id;
}

function isGenericVolumeTitle(title: string): boolean {
  return /^volume\s*\d*$/i.test(title.trim()) || namesEqual(title, "Untitled volume");
}

function isGenericChapterTitle(title: string): boolean {
  return /^chapter\s*\d*$/i.test(title.trim()) || namesEqual(title, "Untitled chapter");
}

function chapterLooksEmpty(
  projectId: string,
  volumeId: string,
  chapterId: string,
  scenes: Array<{ id: string }>,
): boolean {
  if (scenes.length === 0) {
    return true;
  }
  return scenes.every((item) => {
    const scene = readScene(projectId, volumeId, chapterId, item.id);
    return namesEqual(scene.title, "Untitled scene") && scene.script.trim().length === 0 && scene.shots.length === 0;
  });
}

function removeEmptyUntitledScenes(projectId: string): void {
  const tree = readTree(projectId);
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      if (chapter.scenes.length < 2) {
        continue;
      }
      for (const item of chapter.scenes) {
        const scene = readScene(projectId, volume.id, chapter.id, item.id);
        if (namesEqual(scene.title, "Untitled scene") && scene.script.trim().length === 0 && scene.shots.length === 0) {
          deleteScene(projectId, volume.id, chapter.id, scene.id);
        }
      }
    }
  }
}

function ensureComicsStyle(projectId: string): void {
  const style = readStyle(projectId);
  if (style.visual.trim().length > 0) {
    return;
  }
  updateStyle(projectId, DEFAULT_COMICS_STYLE_VISUAL);
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
