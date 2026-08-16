import { allocateUniqueSlug, isStudioSlug, slugifyTitle, STUDIO_ENTITY_KINDS } from "../domain";

const SCENE_SOURCE_KEYS = ["proposedScenes", "scenes", "proposed_scenes"] as const;
const ENTITY_SOURCE_KEYS = ["proposedEntities", "entities", "proposed_entities"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function asNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      names.push(item);
      continue;
    }
    if (isRecord(item) && typeof item.name === "string") {
      names.push(item.name);
    }
  }
  return names;
}

function asLocationName(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function pickSource(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function pickProposalSource(value: Record<string, unknown>, keys: readonly string[]): unknown {
  const direct = pickSource(value, keys);
  if (direct !== undefined) {
    return direct;
  }
  if (isRecord(value.data)) {
    return pickSource(value.data, keys);
  }
  return undefined;
}

function resolveItemKey(
  record: Record<string, unknown>,
  labelField: "title" | "name",
  fallback: string,
): string {
  const rawKey =
    typeof record.key === "string" ? record.key : typeof record.id === "string" ? record.id : "";
  if (isStudioSlug(rawKey)) {
    return rawKey;
  }
  const label = asString(record[labelField]);
  return slugifyTitle(label || fallback);
}

function normalizeKind(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const kind = value.trim().toLowerCase();
  if (kind === "person" || kind === "role" || kind === "char" || kind === "角色" || kind === "人物") {
    return "character";
  }
  if (kind === "place" || kind === "loc" || kind === "地点" || kind === "场所" || kind === "场景") {
    return "location";
  }
  if (kind === "item" || kind === "object" || kind === "weapon" || kind === "tool" || kind === "道具") {
    return "prop";
  }
  if (
    kind === "clothing"
    || kind === "clothes"
    || kind === "outfit"
    || kind === "wardrobe"
    || kind === "dress"
    || kind === "garment"
    || kind === "服饰"
    || kind === "服装"
    || kind === "衣服"
  ) {
    return "costume";
  }
  return kind;
}

function isKnownEntityKind(kind: string): kind is (typeof STUDIO_ENTITY_KINDS)[number] {
  return (STUDIO_ENTITY_KINDS as readonly string[]).includes(kind);
}

function normalizeScenes(items: unknown[]): unknown[] {
  const used = new Set<string>();
  return items.map((item) => {
    if (!isRecord(item)) {
      return item;
    }
    const title = firstNonEmptyString(item.title, item.name) || "Imported";
    const baseKey = resolveItemKey({ ...item, title }, "title", "scene");
    const key = allocateUniqueSlug(baseKey, (candidate) => used.has(candidate));
    used.add(key);
    return {
      key,
      title,
      script: asString(item.script),
      intent: asString(item.intent),
      characterNames: asNameList(firstDefined(item.characterNames, item.character_names, item.characters)),
      locationName: asLocationName(
        firstDefined(item.locationName, item.location_name, item.location, item.place),
      ),
      propNames: asNameList(firstDefined(item.propNames, item.prop_names, item.props)),
      costumeNames: asNameList(
        firstDefined(item.costumeNames, item.costume_names, item.costumes, item.outfits),
      ),
      volumeName: firstNonEmptyString(
        item.volumeName,
        item.volume_name,
        item.volume,
        item.volumeTitle,
        item.volume_title,
      ),
      chapterName: firstNonEmptyString(
        item.chapterName,
        item.chapter_name,
        item.chapter,
        item.chapterTitle,
        item.chapter_title,
        item.章,
      ),
    };
  });
}

function normalizeEntities(items: unknown[]): unknown[] {
  const used = new Set<string>();
  const entities: unknown[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const name = firstNonEmptyString(item.name, item.title);
    if (name.trim().length === 0) {
      continue;
    }
    const kind = normalizeKind(item.kind);
    if (!isKnownEntityKind(kind)) {
      continue;
    }
    const baseKey = resolveItemKey({ ...item, name }, "name", "entity");
    const key = allocateUniqueSlug(baseKey, (candidate) => used.has(candidate));
    used.add(key);
    entities.push({
      key,
      kind,
      name,
      description: asString(item.description),
    });
  }
  return entities;
}

export function normalizeLlmParseProposal(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const scenesSource = pickProposalSource(value, SCENE_SOURCE_KEYS);
  const entitiesSource = pickProposalSource(value, ENTITY_SOURCE_KEYS);

  if (scenesSource === undefined && entitiesSource === undefined) {
    return value;
  }

  return {
    proposedScenes: Array.isArray(scenesSource) ? normalizeScenes(scenesSource) : scenesSource,
    proposedEntities: Array.isArray(entitiesSource) ? normalizeEntities(entitiesSource) : entitiesSource,
  };
}
