import { allocateUniqueSlug, isStudioSlug, slugifyTitle } from "../domain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return [];
  }
  return value;
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
  if (kind === "person" || kind === "role" || kind === "char") {
    return "character";
  }
  if (kind === "place" || kind === "loc") {
    return "location";
  }
  return kind;
}

function normalizeScenes(items: unknown[]): unknown[] {
  const used = new Set<string>();
  return items.map((item) => {
    if (!isRecord(item)) {
      return item;
    }
    const baseKey = resolveItemKey(item, "title", "scene");
    const key = allocateUniqueSlug(baseKey, (candidate) => used.has(candidate));
    used.add(key);
    return {
      key,
      title: asString(item.title),
      script: asString(item.script),
      intent: asString(item.intent),
      characterNames: asStringArray(item.characterNames),
      locationName: asLocationName(item.locationName),
    };
  });
}

function normalizeEntities(items: unknown[]): unknown[] {
  const used = new Set<string>();
  return items.map((item) => {
    if (!isRecord(item)) {
      return item;
    }
    const baseKey = resolveItemKey(item, "name", "entity");
    const key = allocateUniqueSlug(baseKey, (candidate) => used.has(candidate));
    used.add(key);
    return {
      key,
      kind: normalizeKind(item.kind),
      name: asString(item.name),
      description: asString(item.description),
    };
  });
}

export function normalizeLlmParseProposal(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const scenesSource =
    value.proposedScenes !== undefined
      ? value.proposedScenes
      : value.scenes !== undefined
        ? value.scenes
        : undefined;
  const entitiesSource =
    value.proposedEntities !== undefined
      ? value.proposedEntities
      : value.entities !== undefined
        ? value.entities
        : undefined;

  if (scenesSource === undefined && entitiesSource === undefined) {
    return value;
  }

  return {
    proposedScenes: Array.isArray(scenesSource) ? normalizeScenes(scenesSource) : scenesSource,
    proposedEntities: Array.isArray(entitiesSource) ? normalizeEntities(entitiesSource) : entitiesSource,
  };
}
