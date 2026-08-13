import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  buildContextInputSchema,
  canonicalContextJson,
  contextContentSchema,
  contextPolicyFor,
  contextSnapshotSchema,
  type BuildContextInput,
  type ContextContent,
  type ContextEntity,
  type ContextPurpose,
  type ContextSnapshot,
} from "@/domain/context-builder";
import { getCurrentSceneRevision, getScene, getSceneRevision } from "./document";
import { getDatabase } from "./connection";
import { listFacts } from "./story-bible";
import { resolveSceneState } from "./scene-state";
import { SceneAnalysisStaleError, StoryBibleDataIntegrityError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";
import type { Entity, Fact } from "@/domain/story-bible";
import type { SceneEntityLink } from "@/domain/scene-link";

type SqliteParameters = Record<string, string | number | null>;
type ContextSnapshotRow = {
  id: string;
  project_id: string;
  scene_id: string;
  scene_revision_id: string;
  purpose: ContextPurpose;
  policy_id: "storyboard-default-v1" | "video-default-v1";
  policy_version: string;
  input_hash: string;
  content_json: string;
  content_hash: string;
  is_latest: number;
  created_at: string;
};
type LinkRow = {
  id: string;
  project_id: string;
  scene_id: string;
  scene_revision_id: string;
  entity_id: string;
  entity_type: Entity["type"];
  role: SceneEntityLink["role"];
  status: "candidate" | "confirmed" | "rejected" | "stale";
  version: number;
  created_at: string;
};
type EntityRow = {
  id: string;
  project_id: string;
  entity_type: Entity["type"];
  canonical_name: string;
  status: Entity["status"];
  merged_into_entity_id: string | null;
  version: number;
};

const OPERATION = "context.build";

function resolveDatabase(database?: DatabaseSync) {
  return database ?? getDatabase();
}

function now() {
  return new Date().toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new StoryBibleDataIntegrityError(message);
  }
}

function placeholders(prefix: string, values: string[]) {
  return values.map((_, index) => `:${prefix}${index}`);
}

function toSnapshot(row: ContextSnapshotRow): ContextSnapshot {
  const content = contextContentSchema.parse(parseJson(row.content_json, `Invalid context snapshot content ${row.id}`));
  return contextSnapshotSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    sceneRevisionId: row.scene_revision_id,
    purpose: row.purpose,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    inputHash: row.input_hash,
    content,
    contentHash: row.content_hash,
    isLatest: row.is_latest === 1,
    createdAt: row.created_at,
  });
}

function snapshotRow(database: DatabaseSync, projectId: string, contextId: string) {
  return database.prepare("SELECT id, project_id, scene_id, scene_revision_id, purpose, policy_id, policy_version, input_hash, content_json, content_hash, is_latest, created_at FROM context_snapshots WHERE id = :contextId AND project_id = :projectId").get({ contextId, projectId }) as unknown as ContextSnapshotRow | undefined;
}

function getProject(database: DatabaseSync, projectId: string) {
  const row = database.prepare("SELECT id FROM projects WHERE id = :projectId").get({ projectId }) as { id?: string } | undefined;
  if (!row) throw new StoryBibleNotFoundError("Project not found");
}

function withTransaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

function writeEvent(database: DatabaseSync, values: { projectId: string; eventType: string; aggregateType: string; aggregateId: string; aggregateVersion?: number | null; payload?: Record<string, unknown>; actorId: string; requestId: string }) {
  const createdAt = now();
  const payloadJson = JSON.stringify(values.payload ?? {});
  database.prepare("INSERT INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, actorId: values.actorId, requestId: values.requestId, createdAt });
  database.prepare("INSERT INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, requestId: values.requestId, availableAt: createdAt, createdAt });
}

function storeIdempotency(database: DatabaseSync, values: { projectId: string; requestId: string; resourceId: string; requestFingerprint: string; snapshot: ContextSnapshot }) {
  database.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, :operation, :requestId, 'context_snapshot', :resourceId, :responseJson, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, operation: OPERATION, requestId: values.requestId, resourceId: values.resourceId, responseJson: JSON.stringify({ contextId: values.resourceId, requestFingerprint: values.requestFingerprint }), createdAt: values.snapshot.createdAt });
}

function linkRows(database: DatabaseSync, projectId: string, sceneId: string, sceneRevisionId: string) {
  return database.prepare("SELECT id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, version, created_at FROM scene_entity_links WHERE project_id = :projectId AND scene_id = :sceneId AND scene_revision_id = :sceneRevisionId ORDER BY entity_type ASC, entity_id ASC, role ASC, created_at ASC, id ASC").all({ projectId, sceneId, sceneRevisionId }) as unknown as LinkRow[];
}

function entityRows(database: DatabaseSync, projectId: string, ids: string[]) {
  if (ids.length === 0) return [] as EntityRow[];
  const names = placeholders("entity", ids);
  return database.prepare(`SELECT id, project_id, entity_type, canonical_name, status, merged_into_entity_id, version FROM entities WHERE project_id = :projectId AND id IN (${names.join(", ")}) AND status IN ('active', 'draft') AND merged_into_entity_id IS NULL ORDER BY entity_type ASC, canonical_name ASC, id ASC`).all({ projectId, ...Object.fromEntries(ids.map((id, index) => [`entity${index}`, id])) }) as unknown as EntityRow[];
}

function factPathIncluded(purpose: ContextPurpose, predicate: string) {
  // Both first-cut policies deliberately share one provider-neutral visual
  // path set. Keeping this code-owned makes a policy change hash-visible.
  void purpose;
  return predicate.startsWith("identity.") || predicate.startsWith("appearance.") || predicate === "visual.default_wardrobe" || predicate === "speech.style";
}

function factProvenance(fact: Fact) {
  return { kind: "fact" as const, recordId: fact.id, version: fact.version, sourceId: fact.sourceId };
}

function buildContent(database: DatabaseSync, projectId: string, input: ReturnType<typeof buildContextInputSchema.parse>, sceneRevision: NonNullable<ReturnType<typeof getSceneRevision>>, links: LinkRow[], entities: EntityRow[]) {
  const policy = contextPolicyFor(input.policyId);
  const omitted: ContextContent["omitted"] = [];
  const missing: ContextContent["missing"] = [];
  const conflicts: ContextContent["conflicts"] = [];
  const warnings: ContextContent["warnings"] = [];
  const provenance: ContextContent["provenance"] = [{ kind: "scene_revision", recordId: sceneRevision.id }];
  const sceneText = sceneRevision.content.length > policy.budgets.sceneChars ? sceneRevision.content.slice(0, policy.budgets.sceneChars) : sceneRevision.content;
  if (sceneText.length !== sceneRevision.content.length) {
    omitted.push({ kind: "scene", reason: "budget" });
    warnings.push({ code: "budget.sceneChars", message: `Scene text was clipped to ${policy.budgets.sceneChars} characters.` });
  }

  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const confirmed = links.filter((link) => link.status === "confirmed" && byId.has(link.entity_id));
  const excludedLinks = links.filter((link) => link.status !== "confirmed" || !byId.has(link.entity_id));
  for (const link of excludedLinks) {
    omitted.push({ kind: "link", recordId: link.id, entityId: link.entity_id, reason: "not_confirmed" });
    if (link.status === "candidate") warnings.push({ code: "candidate.link_omitted", message: "A candidate scene link was not included in deterministic context.", entityId: link.entity_id });
  }
  const selectedEntityIds = [...new Set(confirmed.map((link) => link.entity_id))].sort();
  const entityIds = selectedEntityIds.slice(0, policy.budgets.maxEntities);
  const budgetExcludedEntityIds = selectedEntityIds.slice(policy.budgets.maxEntities);
  const budgetExcludedEntityIdSet = new Set(budgetExcludedEntityIds);
  const factRows = listFacts(projectId, {}, database).filter((fact) => fact.status === "active" && fact.scope === "base");
  for (const entityId of budgetExcludedEntityIds) {
    omitted.push({ kind: "entity", recordId: entityId, entityId, reason: "budget" });
    for (const link of confirmed.filter((candidate) => candidate.entity_id === entityId)) {
      omitted.push({ kind: "link", recordId: link.id, entityId, reason: "budget" });
    }
    for (const fact of factRows.filter((candidate) => candidate.subjectEntityId === entityId)) {
      omitted.push({ kind: "fact", recordId: fact.id, entityId, predicate: fact.predicate, reason: "budget" });
    }
    warnings.push({ code: "budget.maxEntities", message: `Entity budget is ${policy.budgets.maxEntities}.`, entityId });
  }
  const includedLinks = confirmed.filter((link) => entityIds.includes(link.entity_id));
  const factsByEntity = new Map<string, Fact[]>();
  for (const fact of factRows) {
    if (!entityIds.includes(fact.subjectEntityId)) continue;
    if (!factPathIncluded(input.purpose, fact.predicate)) {
      omitted.push({ kind: "fact", recordId: fact.id, entityId: fact.subjectEntityId, predicate: fact.predicate, reason: "policy_excluded" });
      continue;
    }
    const current = factsByEntity.get(fact.subjectEntityId) ?? [];
    current.push(fact);
    factsByEntity.set(fact.subjectEntityId, current);
  }
  const resolved = confirmed.some((link) => byId.get(link.entity_id)?.entity_type === "character")
    ? resolveSceneState(projectId, sceneRevision.sceneId, sceneRevision.id, undefined, database)
    : null;
  const resolvedStateIds = [...new Set((resolved?.entities ?? []).flatMap((entity) => entity.fields.flatMap((field) => field.sources.filter((source) => source.kind === "state").map((source) => source.recordId))))];
  const resolvedStateVersions = new Map<string, number>(resolvedStateIds.length === 0 ? [] : (database.prepare(`SELECT id, version FROM entity_states WHERE project_id = :projectId AND id IN (${placeholders("resolvedState", resolvedStateIds).join(", ")})`).all({ projectId, ...Object.fromEntries(resolvedStateIds.map((id, index) => [`resolvedState${index}`, id])) }) as Array<{ id: string; version: number }>).map((row) => [row.id, row.version]));
  const factVersions = new Map(factRows.map((fact) => [fact.id, fact.version]));
  const omittedStateIds = new Set<string>();
  for (const entity of resolved?.entities ?? []) {
    if (!budgetExcludedEntityIdSet.has(entity.entityId)) continue;
    for (const field of entity.fields) for (const source of field.sources) {
      if (source.kind !== "state" || omittedStateIds.has(source.recordId)) continue;
      omittedStateIds.add(source.recordId);
      omitted.push({ kind: "state", recordId: source.recordId, entityId: entity.entityId, predicate: field.predicate, reason: "budget" });
    }
  }
  const resolvedByEntity = new Map((resolved?.entities ?? []).map((entity) => [entity.entityId, entity]));
  const contextEntities: ContextEntity[] = [];
  for (const entityId of entityIds) {
    const entity = byId.get(entityId);
    if (!entity) continue;
    const entityLinks = includedLinks.filter((link) => link.entity_id === entity.id);
    const entityFacts = (factsByEntity.get(entity.id) ?? []).sort((left, right) => left.predicate.localeCompare(right.predicate) || left.id.localeCompare(right.id));
    const includedFacts = entityFacts.slice(0, policy.budgets.maxBaseFactsPerEntity);
    for (const fact of entityFacts.slice(policy.budgets.maxBaseFactsPerEntity)) omitted.push({ kind: "fact", recordId: fact.id, entityId: entity.id, predicate: fact.predicate, reason: "budget" });
    if (entityFacts.length > policy.budgets.maxBaseFactsPerEntity) warnings.push({ code: "budget.maxBaseFactsPerEntity", message: `Base fact budget is ${policy.budgets.maxBaseFactsPerEntity}.`, entityId: entity.id });
    const baseFacts = includedFacts.map((fact) => ({ factId: fact.id, predicate: fact.predicate, value: fact.value, valueType: fact.valueType, version: fact.version, sourceId: fact.sourceId }));
    const resolvedState = entity.entity_type === "character" ? (resolvedByEntity.get(entity.id) ?? { entityId: entity.id, fields: [], hasBlockingConflicts: false }) : null;
    for (const fact of includedFacts) provenance.push(factProvenance(fact));
    provenance.push({ kind: "entity", recordId: entity.id, version: entity.version });
    for (const link of entityLinks) provenance.push({ kind: "scene_entity_link", recordId: link.id, version: link.version });
    if (resolvedState) {
      const blockingFields = resolvedState.fields.filter((field) => field.blockingConflict);
      for (const field of blockingFields) {
        const sourceIds = field.sources.flatMap((source) => [source.recordId, source.evidenceSourceId]).sort();
        conflicts.push({ code: "state.conflict", severity: "blocking", message: `Resolved state has a blocking conflict for ${field.predicate}.`, entityId: entity.id, predicate: field.predicate, sourceIds, values: field.conflictValues });
      }
      for (const field of resolvedState.fields) for (const source of field.sources) {
        provenance.push({ kind: source.kind === "state" ? "state" : "fact", recordId: source.recordId, version: source.kind === "state" ? resolvedStateVersions.get(source.recordId) : factVersions.get(source.recordId), sourceId: source.evidenceSourceId });
      }
    }
    const hasVisualBase = baseFacts.some((fact) => fact.predicate.startsWith("appearance.") || fact.predicate === "visual.default_wardrobe");
    const wardrobe = resolvedState?.fields.find((field) => field.predicate === "wardrobe.current");
    if (entity.entity_type === "character" && !hasVisualBase && (!wardrobe || wardrobe.tier === "missing")) {
      missing.push({ code: "character.visual_identity_missing", severity: "warning", message: "Character has no visual Base Fact and no resolved wardrobe.", entityId: entity.id, entityType: entity.entity_type });
    }
    contextEntities.push({ entityId: entity.id, type: entity.entity_type, canonicalName: entity.canonical_name, entityVersion: entity.version, roles: [...new Set(entityLinks.map((link) => link.role))].sort(), linkIds: entityLinks.map((link) => link.id).sort(), baseFacts, resolvedState });
  }
  if (!contextEntities.some((entity) => entity.type === "character")) missing.push({ code: "character.confirmed_missing", severity: "blocking", message: "No confirmed Character is linked to this scene.", entityType: "character" });
  if (!contextEntities.some((entity) => entity.type === "location")) missing.push({ code: "location.confirmed_missing", severity: "warning", message: "No confirmed Location is linked to this scene.", entityType: "location" });
  const hasBlockingIssues = missing.some((item) => item.severity === "blocking") || conflicts.length > 0;
  const uniqueProvenance = [...new Map(provenance.map((item) => [`${item.kind}:${item.recordId}:${item.sourceId ?? ""}`, item])).values()]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.recordId.localeCompare(right.recordId) || (left.sourceId ?? "").localeCompare(right.sourceId ?? ""));
  const content = contextContentSchema.parse({
    scene: { id: sceneRevision.sceneId, revisionId: sceneRevision.id, title: sceneRevision.title, text: sceneText, contentHash: sceneRevision.contentHash },
    purpose: input.purpose,
    policy,
    entities: contextEntities,
    organizations: [],
    events: [],
    history: [],
    globalStyle: {},
    missing,
    conflicts,
    warnings,
    omitted,
    provenance: uniqueProvenance,
    hasBlockingIssues,
  });
  return { content, resolved };
}

function requestFingerprint(projectId: string, input: ReturnType<typeof buildContextInputSchema.parse>) {
  return sha256(canonicalContextJson({ projectId, sceneId: input.sceneId, sceneRevisionId: input.sceneRevisionId, purpose: input.purpose, policyId: input.policyId, allowInferred: input.allowInferred, actorId: input.actorId }));
}

function inputFingerprint(database: DatabaseSync, projectId: string, input: ReturnType<typeof buildContextInputSchema.parse>, sceneRevision: NonNullable<ReturnType<typeof getSceneRevision>>, content: ContextContent) {
  const includedLinkIds = new Set(content.entities.flatMap((entity) => entity.linkIds));
  const includedFactIds = new Set(content.entities.flatMap((entity) => entity.baseFacts.map((fact) => fact.factId)));
  const stateIds = [...new Set(content.entities.flatMap((entity) => entity.resolvedState?.fields.flatMap((field) => field.sources.filter((source) => source.kind === "state").map((source) => source.recordId)) ?? []))].sort();
  const stateVersions = stateIds.length === 0 ? [] : (database.prepare(`SELECT id, version FROM entity_states WHERE project_id = :projectId AND id IN (${placeholders("state", stateIds).join(", ")})`).all({ projectId, ...Object.fromEntries(stateIds.map((id, index) => [`state${index}`, id])) }) as Array<{ id: string; version: number }>).sort((a, b) => a.id.localeCompare(b.id));
  const linkVersions = includedLinkIds.size === 0 ? [] : (database.prepare(`SELECT id, version FROM scene_entity_links WHERE project_id = :projectId AND id IN (${placeholders("link", [...includedLinkIds]).join(", ")})`).all({ projectId, ...Object.fromEntries([...includedLinkIds].map((id, index) => [`link${index}`, id])) }) as Array<{ id: string; version: number }>).sort((a, b) => a.id.localeCompare(b.id));
  const factVersions = includedFactIds.size === 0 ? [] : (database.prepare(`SELECT id, version FROM facts WHERE project_id = :projectId AND id IN (${placeholders("fact", [...includedFactIds]).join(", ")})`).all({ projectId, ...Object.fromEntries([...includedFactIds].map((id, index) => [`fact${index}`, id])) }) as Array<{ id: string; version: number }>).sort((a, b) => a.id.localeCompare(b.id));
  return sha256(canonicalContextJson({ projectId, sceneId: input.sceneId, sceneRevisionId: sceneRevision.id, sceneContentHash: sceneRevision.contentHash, purpose: input.purpose, policyId: input.policyId, policyVersion: contextPolicyFor(input.policyId).version, allowInferred: input.allowInferred, links: linkVersions, entities: content.entities.map((entity) => ({ id: entity.entityId, version: entity.entityVersion })).sort((a, b) => a.id.localeCompare(b.id)), facts: factVersions, states: stateVersions }));
}

export type BuildContextResult = { snapshot: ContextSnapshot; idempotent: boolean };

export function buildContextSnapshot(projectId: string, input: BuildContextInput, database?: DatabaseSync): BuildContextResult {
  const values = buildContextInputSchema.parse(input);
  const db = resolveDatabase(database);
  return withTransaction(db, () => {
    getProject(db, projectId);
    if (values.allowInferred !== false) throw new StoryBibleValidationError("allowInferred must be false", ["allowInferred"]);
    const fingerprint = requestFingerprint(projectId, values);
    const duplicate = db.prepare("SELECT resource_id, response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = :operation AND request_id = :requestId").get({ projectId, operation: OPERATION, requestId: values.requestId }) as { resource_id?: string; response_json?: string } | undefined;
    if (duplicate) {
      const stored = parseJson(duplicate.response_json ?? "null", "Stored context idempotency response is invalid") as { contextId?: string; requestFingerprint?: string };
      if (stored.requestFingerprint !== fingerprint) throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different context build");
      const row = stored.contextId ? snapshotRow(db, projectId, stored.contextId) : undefined;
      if (!row) throw new StoryBibleDataIntegrityError("Idempotent context snapshot is missing");
      return { snapshot: toSnapshot(row), idempotent: true };
    }
    const scene = getScene(values.sceneId, projectId, undefined, db);
    const current = getCurrentSceneRevision(values.sceneId, projectId, db);
    const selected = getSceneRevision(values.sceneRevisionId, projectId, db);
    if (!scene || scene.status === "deleted") throw new StoryBibleNotFoundError("Scene not found");
    if (!selected || selected.sceneId !== values.sceneId || selected.status === "deleted" || !current || current.id !== selected.id || current.status === "deleted") throw new SceneAnalysisStaleError("Context requires the current active scene revision");
    const links = linkRows(db, projectId, values.sceneId, values.sceneRevisionId);
    const entityIds = [...new Set(links.map((link) => link.entity_id))];
    const entities = entityRows(db, projectId, entityIds);
    const built = buildContent(db, projectId, values, selected, links, entities);
    const contentJson = canonicalContextJson(built.content);
    const contentHash = sha256(contentJson);
    const finalInputHash = inputFingerprint(db, projectId, values, selected, built.content);
    const existing = db.prepare("SELECT id, project_id, scene_id, scene_revision_id, purpose, policy_id, policy_version, input_hash, content_json, content_hash, is_latest, created_at FROM context_snapshots WHERE project_id = :projectId AND content_hash = :contentHash").get({ projectId, contentHash }) as unknown as ContextSnapshotRow | undefined;
    let row: ContextSnapshotRow;
    let created = false;
    if (existing) {
      row = existing;
      db.prepare("UPDATE context_snapshots SET is_latest = 0 WHERE project_id = :projectId AND scene_id = :sceneId AND purpose = :purpose AND policy_id = :policyId AND id <> :id AND is_latest = 1").run({ projectId, sceneId: values.sceneId, purpose: values.purpose, policyId: values.policyId, id: existing.id });
      db.prepare("UPDATE context_snapshots SET is_latest = 1 WHERE id = :id AND project_id = :projectId").run({ id: existing.id, projectId });
      row = snapshotRow(db, projectId, existing.id) as ContextSnapshotRow;
    } else {
      const id = randomUUID();
      const createdAt = now();
      db.prepare("UPDATE context_snapshots SET is_latest = 0 WHERE project_id = :projectId AND scene_id = :sceneId AND purpose = :purpose AND policy_id = :policyId AND is_latest = 1").run({ projectId, sceneId: values.sceneId, purpose: values.purpose, policyId: values.policyId });
      db.prepare("INSERT INTO context_snapshots (id, project_id, scene_id, scene_revision_id, purpose, policy_id, policy_version, input_hash, content_json, content_hash, is_latest, created_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :purpose, :policyId, '1', :inputHash, :contentJson, :contentHash, 1, :createdAt)").run({ id, projectId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, purpose: values.purpose, policyId: values.policyId, inputHash: finalInputHash, contentJson, contentHash, createdAt });
      row = snapshotRow(db, projectId, id) as ContextSnapshotRow;
      created = true;
    }
    const snapshot = toSnapshot(row);
    storeIdempotency(db, { projectId, requestId: values.requestId, resourceId: snapshot.id, requestFingerprint: fingerprint, snapshot });
    if (created) writeEvent(db, { projectId, eventType: "context.built", aggregateType: "context_snapshot", aggregateId: snapshot.id, aggregateVersion: 1, payload: { sceneId: snapshot.sceneId, sceneRevisionId: snapshot.sceneRevisionId, purpose: snapshot.purpose, policyId: snapshot.policyId, contentHash: snapshot.contentHash }, actorId: values.actorId, requestId: values.requestId });
    return { snapshot, idempotent: !created };
  });
}

export function getContextSnapshot(contextId: string, projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const row = snapshotRow(db, projectId, contextId);
  return row ? toSnapshot(row) : null;
}

export function listContextSnapshots(projectId: string, options: { sceneId?: string; sceneRevisionId?: string; purpose?: ContextPurpose; policyId?: "storyboard-default-v1" | "video-default-v1"; latest?: boolean } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const conditions = ["project_id = :projectId"];
  const params: SqliteParameters = { projectId };
  if (options.sceneId) { conditions.push("scene_id = :sceneId"); params.sceneId = options.sceneId; }
  if (options.sceneRevisionId) { conditions.push("scene_revision_id = :sceneRevisionId"); params.sceneRevisionId = options.sceneRevisionId; }
  if (options.purpose) { conditions.push("purpose = :purpose"); params.purpose = options.purpose; }
  if (options.policyId) { conditions.push("policy_id = :policyId"); params.policyId = options.policyId; }
  if (options.latest !== undefined) { conditions.push("is_latest = :latest"); params.latest = options.latest ? 1 : 0; }
  const rows = db.prepare(`SELECT id, project_id, scene_id, scene_revision_id, purpose, policy_id, policy_version, input_hash, content_json, content_hash, is_latest, created_at FROM context_snapshots WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC`).all(params) as unknown as ContextSnapshotRow[];
  return rows.map(toSnapshot);
}

export function createContextBuilderRepository(database: DatabaseSync = getDatabase()) {
  return {
    buildContextSnapshot: (projectId: string, input: BuildContextInput) => buildContextSnapshot(projectId, input, database),
    build: (projectId: string, input: BuildContextInput) => buildContextSnapshot(projectId, input, database),
    getContextSnapshot: (contextId: string, projectId: string) => getContextSnapshot(contextId, projectId, database),
    get: (contextId: string, projectId: string) => getContextSnapshot(contextId, projectId, database),
    listContextSnapshots: (projectId: string, options?: Parameters<typeof listContextSnapshots>[1]) => listContextSnapshots(projectId, options, database),
    list: (projectId: string, options?: Parameters<typeof listContextSnapshots>[1]) => listContextSnapshots(projectId, options, database),
  };
}

export const buildContext = buildContextSnapshot;
export const getContext = getContextSnapshot;
export const listContexts = listContextSnapshots;
