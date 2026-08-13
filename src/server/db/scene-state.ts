import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { entityStateSchema, isSceneStatePredicate, type EntityState, type Fact } from "@/domain/story-bible";
import { continuityGroupSchema, resolvedStateResponseSchema, type ContinuityGroup } from "@/domain/scene-state";
import { getCurrentSceneRevision, getScene, getSceneRevision } from "./document";
import { getDatabase } from "./connection";
import { getEntityForProject, listFacts } from "./story-bible";
import { SceneAnalysisStaleError, StoryBibleDataIntegrityError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";

type EntityStateRow = {
  id: string;
  project_id: string;
  entity_id: string;
  predicate: EntityState["predicate"];
  value_json: string;
  value_type: EntityState["valueType"];
  applies_at_scene_id: string;
  source_revision_id: string;
  continuity_group_id: string;
  carry_forward: number;
  priority: number;
  valid_to_scene_id: string | null;
  source_id: string;
  truth_class: "canon";
  status: EntityState["status"];
  version: number;
  created_at: string;
};

type EvidenceRow = {
  id: string;
  scene_revision_id: string | null;
  anchor_start: string | null;
  anchor_end: string | null;
  quoted_text: string | null;
};

type ContinuityGroupRow = {
  id: string;
  project_id: string;
  document_id: string;
  name: string;
  kind: ContinuityGroup["kind"];
  is_default: number;
  version: number;
  created_at: string;
  updated_at: string;
};

type CurrentSceneRow = {
  scene_id: string;
  narrative_rank: number;
  status: string;
  continuity_group_id: string;
};

function resolveDatabase(database?: DatabaseSync) {
  return database ?? getDatabase();
}

function parseJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new StoryBibleDataIntegrityError(message);
  }
}

function toState(row: EntityStateRow): EntityState {
  return entityStateSchema.parse({
    id: row.id,
    projectId: row.project_id,
    entityId: row.entity_id,
    predicate: row.predicate,
    value: parseJson(row.value_json, `Invalid EntityState value ${row.id}`),
    valueType: row.value_type,
    appliesAtSceneId: row.applies_at_scene_id,
    sourceRevisionId: row.source_revision_id,
    continuityGroupId: row.continuity_group_id,
    carryForward: row.carry_forward === 1,
    priority: row.priority,
    validToSceneId: row.valid_to_scene_id,
    sourceId: row.source_id,
    truthClass: row.truth_class,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
  });
}

function groupFromRow(row: ContinuityGroupRow): ContinuityGroup {
  return continuityGroupSchema.parse({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    name: row.name,
    kind: row.kind,
    isDefault: row.is_default === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function stateRows(database: DatabaseSync, projectId: string, entityId?: string, predicate?: EntityState["predicate"]) {
  const conditions = ["project_id = :projectId", "status = 'active'"];
  const params: Record<string, string> = { projectId };
  if (entityId) {
    conditions.push("entity_id = :entityId");
    params.entityId = entityId;
  }
  if (predicate) {
    conditions.push("predicate = :predicate");
    params.predicate = predicate;
  }
  return database.prepare(`SELECT id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at FROM entity_states WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC, id ASC`).all(params) as unknown as EntityStateRow[];
}

export function getEntityState(stateId: string, projectId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const row = db.prepare("SELECT id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, status, version, created_at FROM entity_states WHERE id = :stateId").get({ stateId }) as unknown as EntityStateRow | undefined;
  if (!row || (projectId !== undefined && row.project_id !== projectId)) return null;
  return toState(row);
}

export function listEntityStates(projectId: string, options: { entityId?: string; predicate?: EntityState["predicate"] } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const rows = stateRows(db, projectId, options.entityId, options.predicate);
  return rows.map(toState);
}

type Candidate = {
  kind: "state" | "fact";
  id: string;
  value: string;
  valueType: string;
  sourceId: string;
  evidenceSourceId: string;
  sourceRevisionId: string | null;
  quotedText: string | null;
  priority: number;
  rank: number;
  appliesAtSceneId?: string;
  carryForward?: boolean;
};

function candidateFromState(state: EntityState, rank: number, evidenceById: ReadonlyMap<string, EvidenceRow>): Candidate {
  const evidence = evidenceById.get(state.sourceId);
  return {
    kind: "state",
    id: state.id,
    value: state.value,
    valueType: state.valueType,
    sourceId: state.id,
    evidenceSourceId: evidence?.id ?? state.sourceId,
    sourceRevisionId: state.sourceRevisionId,
    quotedText: evidence?.quoted_text ?? null,
    priority: state.priority,
    rank,
    appliesAtSceneId: state.appliesAtSceneId,
    carryForward: state.carryForward,
  };
}

function candidateFromFact(fact: Fact, evidenceById: ReadonlyMap<string, EvidenceRow>, appliesAtSceneId?: string | null): Candidate {
  const evidence = evidenceById.get(fact.sourceId);
  return {
    kind: "fact",
    id: fact.id,
    value: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value),
    valueType: fact.valueType,
    sourceId: fact.id,
    evidenceSourceId: evidence?.id ?? fact.sourceId,
    sourceRevisionId: evidence?.scene_revision_id ?? null,
    quotedText: evidence?.quoted_text ?? null,
    priority: 100,
    rank: 0,
    appliesAtSceneId: appliesAtSceneId ?? undefined,
  };
}

function sourceOutput(candidate: Candidate, tier: "explicit" | "carried" | "base") {
  return {
    kind: candidate.kind,
    recordId: candidate.id,
    evidenceSourceId: candidate.evidenceSourceId,
    value: candidate.value,
    tier,
    priority: candidate.priority,
    appliesAtSceneId: candidate.appliesAtSceneId ?? null,
    sourceRevisionId: candidate.sourceRevisionId,
    quotedText: candidate.quotedText,
  };
}

function resolveField(predicate: EntityState["predicate"], explicit: Candidate[], carried: Candidate[], base: Candidate[]) {
  const isMulti = predicate === "state.held_prop";
  const valueType = isMulti ? "entity_ref" as const : "string" as const;
  const cardinality = isMulti ? "multi" as const : "single" as const;
  let tier: "explicit" | "carried" | "base" | "missing" | "conflict" = "missing";
  let candidates: Candidate[] = [];
  if (explicit.length > 0) {
    tier = "explicit";
    candidates = explicit;
  } else if (carried.length > 0) {
    tier = "carried";
    const nearest = Math.max(...carried.map((candidate) => candidate.rank));
    candidates = carried.filter((candidate) => candidate.rank === nearest);
  } else if (base.length > 0) {
    tier = "base";
    candidates = base;
  }

  if (candidates.length === 0) {
    return { predicate, tier: "missing" as const, value: null, valueType, cardinality, priority: null, blockingConflict: false, conflictValues: [], sources: [] };
  }
  const topPriority = Math.max(...candidates.map((candidate) => candidate.priority));
  const top = candidates.filter((candidate) => candidate.priority === topPriority);
  const uniqueValues = [...new Set(top.map((candidate) => candidate.value))];
  if (isMulti) {
    const refs = uniqueValues;
    return { predicate, tier: tier as "explicit" | "carried" | "base", value: refs, valueType, cardinality, priority: topPriority, blockingConflict: false, conflictValues: [], sources: top.map((candidate) => sourceOutput(candidate, tier as "explicit" | "carried" | "base")) };
  }
  if (uniqueValues.length > 1) {
    return { predicate, tier: "conflict" as const, value: null, valueType, cardinality, priority: topPriority, blockingConflict: true, conflictValues: uniqueValues, sources: top.map((candidate) => sourceOutput(candidate, tier as "explicit" | "carried" | "base")) };
  }
  return { predicate, tier: tier as "explicit" | "carried" | "base", value: uniqueValues[0], valueType, cardinality, priority: topPriority, blockingConflict: false, conflictValues: [], sources: top.map((candidate) => sourceOutput(candidate, tier as "explicit" | "carried" | "base")) };
}

export function resolveSceneState(projectId: string, sceneId: string, sceneRevisionId: string, entityId?: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const scene = getScene(sceneId, projectId, undefined, db);
  if (!scene) throw new StoryBibleNotFoundError("Scene not found");
  const currentRevision = getCurrentSceneRevision(sceneId, projectId, db);
  if (!currentRevision || currentRevision.status === "deleted") throw new SceneAnalysisStaleError("Scene has no current active revision");
  if (currentRevision.id !== sceneRevisionId) throw new SceneAnalysisStaleError("Resolved state requires the current scene revision");
  const selectedRevision = getSceneRevision(sceneRevisionId, projectId, db);
  if (!selectedRevision || selectedRevision.sceneId !== sceneId || selectedRevision.status === "deleted") throw new SceneAnalysisStaleError("Scene revision is not current");
  const groupRow = db.prepare("SELECT id, project_id, document_id, name, kind, is_default, version, created_at, updated_at FROM continuity_groups WHERE id = :groupId AND project_id = :projectId AND document_id = :documentId").get({ groupId: selectedRevision.continuityGroupId, projectId, documentId: selectedRevision.documentId }) as unknown as ContinuityGroupRow | undefined;
  if (!groupRow) throw new StoryBibleDataIntegrityError("Scene continuity group is missing");
  const group = groupFromRow(groupRow);
  const targetRank = selectedRevision.narrativeRank;
  let entityIds: string[];
  if (entityId) {
    const entity = getEntityForProject(projectId, entityId, db);
    if (!entity) throw new StoryBibleNotFoundError("Entity not found");
    if (entity.type !== "character" || !["active", "draft"].includes(entity.status) || entity.mergedIntoEntityId !== null) throw new StoryBibleValidationError("entityId must refer to an active or draft character", ["entityId"]);
    entityIds = [entity.id];
  } else {
    entityIds = (db.prepare("SELECT DISTINCT l.entity_id FROM scene_entity_links l JOIN entities e ON e.id = l.entity_id AND e.project_id = l.project_id WHERE l.project_id = :projectId AND l.scene_id = :sceneId AND l.scene_revision_id = :sceneRevisionId AND l.status = 'confirmed' AND e.entity_type = 'character' AND e.status IN ('active', 'draft') AND e.merged_into_entity_id IS NULL ORDER BY l.entity_id").all({ projectId, sceneId, sceneRevisionId }) as Array<{ entity_id: string }>).map((row) => row.entity_id);
  }
  const entityPlaceholders = entityIds.map((_, index) => `:entity${index}`);
  const currentSceneRows = db.prepare("SELECT scene_id, narrative_rank, status, continuity_group_id FROM scene_revisions WHERE document_revision_id = :documentRevisionId").all({ documentRevisionId: selectedRevision.documentRevisionId }) as CurrentSceneRow[];
  const currentScenes = new Map(currentSceneRows.map((row) => [row.scene_id, row]));
  const targetScene = currentScenes.get(sceneId);
  if (!targetScene || targetScene.status !== "active" || targetScene.continuity_group_id !== group.id) throw new SceneAnalysisStaleError("Scene is not active in the selected current revision");
  const resolutionRows = entityIds.length === 0 ? [] : db.prepare(`SELECT es.id, es.project_id, es.entity_id, es.predicate, es.value_json, es.value_type, es.applies_at_scene_id, es.source_revision_id, es.continuity_group_id, es.carry_forward, es.priority, es.valid_to_scene_id, es.source_id, es.truth_class, es.status, es.version, es.created_at, applies_sr.narrative_rank AS applies_rank, applies_sr.status AS applies_status, applies_sr.continuity_group_id AS applies_group, end_sr.narrative_rank AS valid_to_rank, end_sr.status AS valid_to_status, end_sr.continuity_group_id AS valid_to_group FROM entity_states es JOIN script_documents d ON d.id = :documentId AND d.project_id = :projectId AND d.current_revision_id = :documentRevisionId JOIN scene_revisions applies_sr ON applies_sr.document_revision_id = d.current_revision_id AND applies_sr.scene_id = es.applies_at_scene_id LEFT JOIN scene_revisions end_sr ON end_sr.document_revision_id = d.current_revision_id AND end_sr.scene_id = es.valid_to_scene_id WHERE es.project_id = :projectId AND es.status = 'active' AND es.entity_id IN (${entityPlaceholders.join(", ")}) AND es.continuity_group_id = :continuityGroupId AND applies_sr.status = 'active' AND applies_sr.continuity_group_id = :continuityGroupId AND applies_sr.narrative_rank <= :targetRank`).all({ projectId, documentId: selectedRevision.documentId, documentRevisionId: selectedRevision.documentRevisionId, continuityGroupId: group.id, targetRank, ...Object.fromEntries(entityIds.map((id, index) => [`entity${index}`, id])) }) as Array<EntityStateRow & { applies_rank?: number; applies_status?: string; applies_group?: string; valid_to_rank?: number | null; valid_to_status?: string | null; valid_to_group?: string | null }>;
  const activeStates = resolutionRows
    .filter((row) => row.applies_group === group.id && (row.valid_to_scene_id === null || (row.valid_to_status === "active" && row.valid_to_group === group.id && row.valid_to_rank !== null && row.valid_to_rank !== undefined && row.valid_to_rank >= targetRank)))
    .map((row) => ({ state: toState(row), rank: row.applies_rank ?? 0 }));
  const allFacts = listFacts(projectId, {}, db);
  const baseFacts = new Map<string, Fact[]>();
  const scopedFacts = new Map<string, Fact[]>();
  for (const fact of allFacts) {
    if (fact.status !== "active" || !entityIds.includes(fact.subjectEntityId)) continue;
    if (fact.scope === "base" && fact.predicate === "visual.default_wardrobe") {
      const existing = baseFacts.get(fact.subjectEntityId) ?? [];
      existing.push(fact);
      baseFacts.set(fact.subjectEntityId, existing);
      continue;
    }
    if (!isSceneStatePredicate(fact.predicate) || fact.scope === "base") continue;
    const from = fact.scope === "scene" ? currentScenes.get(fact.sceneId ?? "") : currentScenes.get(fact.validFromSceneId ?? "");
    const to = fact.scope === "scene" ? from : (fact.validToSceneId ? currentScenes.get(fact.validToSceneId) : null);
    if (!from || from.status !== "active" || from.continuity_group_id !== group.id || from.narrative_rank > targetRank) continue;
    if (fact.scope === "scene" && from.scene_id !== sceneId) continue;
    if (fact.scope === "range" && to && (to.status !== "active" || to.continuity_group_id !== group.id || to.narrative_rank < targetRank)) continue;
    if (fact.scope === "range" && !to && from.narrative_rank > targetRank) continue;
    const existing = scopedFacts.get(fact.subjectEntityId) ?? [];
    existing.push(fact);
    scopedFacts.set(fact.subjectEntityId, existing);
  }
  const evidenceById = new Map<string, EvidenceRow>();
  const sourceIds = [...activeStates.map(({ state }) => state.sourceId), ...[...baseFacts.values()].flat().map((fact) => fact.sourceId), ...[...scopedFacts.values()].flat().map((fact) => fact.sourceId)];
  const evidencePlaceholders = [...new Set(sourceIds)].map((_, index) => `:evidence${index}`);
  if (evidencePlaceholders.length > 0) {
    const evidenceRows = db.prepare(`SELECT id, scene_revision_id, anchor_start, anchor_end, quoted_text FROM evidence_sources WHERE project_id = :projectId AND id IN (${evidencePlaceholders.join(", ")})`).all({ projectId, ...Object.fromEntries([...new Set(sourceIds)].map((id, index) => [`evidence${index}`, id])) }) as EvidenceRow[];
    for (const evidence of evidenceRows) evidenceById.set(evidence.id, evidence);
  }
  const entities = entityIds.map((id) => {
    const fields = {} as Record<EntityState["predicate"], ReturnType<typeof resolveField>>;
    let blocking = false;
    for (const predicate of ["wardrobe.current", "state.injury", "state.held_prop"] as const) {
      const matching = activeStates.filter(({ state }) => state.entityId === id && state.predicate === predicate);
      const explicit = matching.filter(({ state }) => state.appliesAtSceneId === sceneId).map(({ state }) => candidateFromState(state, targetRank, evidenceById));
      explicit.push(...(scopedFacts.get(id) ?? []).filter((fact) => fact.predicate === predicate).map((fact) => candidateFromFact(fact, evidenceById, fact.sceneId ?? fact.validFromSceneId)));
      const carried = matching.filter(({ state }) => state.carryForward && state.appliesAtSceneId !== sceneId).map(({ state, rank }) => candidateFromState(state, rank, evidenceById));
      const base = predicate === "wardrobe.current" ? (baseFacts.get(id) ?? []).map((fact) => candidateFromFact(fact, evidenceById)) : [];
      fields[predicate] = resolveField(predicate, explicit, carried, base);
      blocking ||= fields[predicate].blockingConflict;
    }
    return { entityId: id, fields: Object.values(fields), hasBlockingConflicts: blocking };
  });
  const hasBlockingConflicts = entities.some((entity) => entity.hasBlockingConflicts);
  return resolvedStateResponseSchema.parse({ sceneId, sceneRevisionId, continuityGroupId: group.id, entities, hasBlockingConflicts });
}

export function createSceneStateRepository(database: DatabaseSync = getDatabase()) {
  return {
    getEntityState: (stateId: string, projectId?: string) => getEntityState(stateId, projectId, database),
    listEntityStates: (projectId: string, options?: { entityId?: string; predicate?: EntityState["predicate"] }) => listEntityStates(projectId, options, database),
    resolveSceneState: (projectId: string, sceneId: string, sceneRevisionId: string, entityId?: string) => resolveSceneState(projectId, sceneId, sceneRevisionId, entityId, database),
  };
}
