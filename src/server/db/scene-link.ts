import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  entityMentionSchema,
  normalizeAnalysisText,
  type EntityMention,
  type AnalysisEntityType,
} from "@/domain/analysis";
import {
  reviewSceneEntityLinkInputSchema,
  sceneEntityLinkSchema,
  sceneEntityLinkRoleForType,
  type ReviewSceneEntityLinkInput,
  type SceneEntityLink,
  type SceneEntityLinkRole,
} from "@/domain/scene-link";
import { getDatabase } from "./connection";
import {
  SceneEntityLinkConflictError,
  SceneAnalysisStaleError,
  StoryBibleDataIntegrityError,
  StoryBibleIdempotencyConflictError,
  StoryBibleNotFoundError,
} from "./story-bible-errors";

type SqliteParameters = Record<string, string | number | null>;

type MentionRow = {
  id: string;
  project_id: string;
  document_id: string;
  scene_id: string;
  scene_revision_id: string;
  analysis_run_id: string;
  entity_id: string | null;
  entity_type: AnalysisEntityType;
  surface: string;
  normalized_surface: string;
  anchor_start: number;
  anchor_end: number;
  candidate_group_id: string;
  fingerprint: string;
  evidence_source_id: string;
  status: EntityMention["status"];
  created_at: string;
  updated_at: string;
};

type LinkRow = {
  id: string;
  project_id: string;
  scene_id: string;
  scene_revision_id: string;
  entity_id: string;
  entity_type: AnalysisEntityType;
  role: SceneEntityLinkRole;
  status: SceneEntityLink["status"];
  resolver: SceneEntityLink["resolver"];
  confidence: number | null;
  version: number;
  candidate_group_id: string;
  fingerprint: string;
  analysis_run_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AnalysisProjectionCandidate = {
  entityId?: string;
  entityType: AnalysisEntityType;
  role?: SceneEntityLinkRole;
  surface: string;
  normalizedSurface: string;
  anchorStart: number;
  anchorEnd: number;
  candidateGroupId: string;
  fingerprint: string;
  resolver: "exact_alias" | "explicit_stub";
  confidence?: number | null;
  stubName?: string;
};

function resolveDatabase(database?: DatabaseSync) {
  return database ?? getDatabase();
}

function now() {
  return new Date().toISOString();
}

function withTransaction<T>(database: DatabaseSync, operation: () => T) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new StoryBibleDataIntegrityError("Stored scene-link idempotency response is invalid");
  }
}

function getProject(database: DatabaseSync, projectId: string) {
  const row = database.prepare("SELECT id FROM projects WHERE id = :projectId").get({ projectId }) as { id?: string } | undefined;
  if (!row) throw new StoryBibleNotFoundError("Project not found");
}

function assertSceneRevision(database: DatabaseSync, projectId: string, sceneId: string, sceneRevisionId: string) {
  const row = database.prepare("SELECT project_id, scene_id FROM scene_revisions WHERE id = :sceneRevisionId").get({ sceneRevisionId }) as { project_id?: string; scene_id?: string } | undefined;
  if (!row || row.project_id !== projectId || row.scene_id !== sceneId) throw new StoryBibleNotFoundError("Scene revision not found");
}

function toMention(row: MentionRow): EntityMention {
  return entityMentionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    sceneId: row.scene_id,
    sceneRevisionId: row.scene_revision_id,
    analysisRunId: row.analysis_run_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    surface: row.surface,
    normalizedSurface: row.normalized_surface,
    anchorStart: row.anchor_start,
    anchorEnd: row.anchor_end,
    candidateGroupId: row.candidate_group_id,
    fingerprint: row.fingerprint,
    evidenceSourceId: row.evidence_source_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function listMentionIds(database: DatabaseSync, projectId: string, linkId: string) {
  return (database.prepare("SELECT lm.mention_id FROM scene_entity_link_mentions lm JOIN entity_mentions em ON em.id = lm.mention_id AND em.project_id = lm.project_id WHERE lm.project_id = :projectId AND lm.link_id = :linkId AND em.status <> 'stale' ORDER BY lm.created_at ASC, lm.mention_id ASC").all({ projectId, linkId }) as unknown as Array<{ mention_id: string }>).map((row) => row.mention_id);
}

function toLink(row: LinkRow, database: DatabaseSync): SceneEntityLink {
  return sceneEntityLinkSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    sceneRevisionId: row.scene_revision_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    role: row.role,
    status: row.status,
    resolver: row.resolver,
    confidence: row.confidence,
    version: row.version,
    candidateGroupId: row.candidate_group_id,
    fingerprint: row.fingerprint,
    analysisRunId: row.analysis_run_id,
    mentionIds: listMentionIds(database, row.project_id, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function getLinkRow(linkId: string, projectId: string, database: DatabaseSync) {
  return database.prepare("SELECT id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at FROM scene_entity_links WHERE id = :linkId AND project_id = :projectId").get({ linkId, projectId }) as unknown as LinkRow | undefined;
}

function getLinkWithDatabase(linkId: string, projectId: string, database: DatabaseSync) {
  const row = getLinkRow(linkId, projectId, database);
  return row ? toLink(row, database) : null;
}

function writeEvent(database: DatabaseSync, values: { projectId: string; eventType: string; aggregateType: string; aggregateId: string; aggregateVersion?: number | null; requestId: string; payload?: Record<string, unknown>; actorId?: string }) {
  const createdAt = now();
  const payloadJson = JSON.stringify(values.payload ?? {});
  database.prepare("INSERT OR IGNORE INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, actorId: values.actorId ?? "local-user", requestId: values.requestId, createdAt });
  database.prepare("INSERT OR IGNORE INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, requestId: values.requestId, availableAt: createdAt, createdAt });
}

export function listEntityMentions(projectId: string, options: { sceneId?: string; sceneRevisionId?: string; status?: EntityMention["status"] } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const conditions = ["project_id = :projectId"];
  const parameters: SqliteParameters = { projectId };
  if (options.sceneId) { conditions.push("scene_id = :sceneId"); parameters.sceneId = options.sceneId; }
  if (options.sceneRevisionId) { conditions.push("scene_revision_id = :sceneRevisionId"); parameters.sceneRevisionId = options.sceneRevisionId; }
  if (options.status) { conditions.push("status = :status"); parameters.status = options.status; }
  const rows = db.prepare(`SELECT id, project_id, document_id, scene_id, scene_revision_id, analysis_run_id, entity_id, entity_type, surface, normalized_surface, anchor_start, anchor_end, candidate_group_id, fingerprint, evidence_source_id, status, created_at, updated_at FROM entity_mentions WHERE ${conditions.join(" AND ")} ORDER BY anchor_start ASC, created_at ASC, id ASC`).all(parameters) as unknown as MentionRow[];
  return rows.map(toMention);
}

export const listMentions = listEntityMentions;

export function listSceneEntityLinks(projectId: string, sceneId: string, options: { sceneRevisionId?: string; status?: SceneEntityLink["status"] } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const scene = db.prepare("SELECT project_id FROM scenes WHERE id = :sceneId").get({ sceneId }) as { project_id?: string } | undefined;
  if (!scene || scene.project_id !== projectId) throw new StoryBibleNotFoundError("Scene not found");
  const conditions = ["project_id = :projectId", "scene_id = :sceneId"];
  const parameters: SqliteParameters = { projectId, sceneId };
  if (options.sceneRevisionId) { conditions.push("scene_revision_id = :sceneRevisionId"); parameters.sceneRevisionId = options.sceneRevisionId; }
  if (options.status) { conditions.push("status = :status"); parameters.status = options.status; }
  const rows = db.prepare(`SELECT id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at FROM scene_entity_links WHERE ${conditions.join(" AND ")} ORDER BY role ASC, created_at ASC, id ASC`).all(parameters) as unknown as LinkRow[];
  return rows.map((row) => toLink(row, db));
}

export const listSceneLinks = listSceneEntityLinks;

export function getSceneEntityLink(linkId: string, projectId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  return getLinkWithDatabase(linkId, projectId, db);
}

export const getSceneLink = getSceneEntityLink;

/** Mark projections for earlier revisions stale without touching rejection feedback. */
export function markSceneAnalysisStale(projectId: string, sceneId: string, currentSceneRevisionId: string, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  assertSceneRevision(db, projectId, sceneId, currentSceneRevisionId);
  const updatedAt = now();
  return withTransaction(db, () => {
    const mentions = db.prepare("UPDATE entity_mentions SET status = 'stale', updated_at = :updatedAt WHERE project_id = :projectId AND scene_id = :sceneId AND scene_revision_id <> :sceneRevisionId AND status NOT IN ('rejected', 'stale')").run({ projectId, sceneId, sceneRevisionId: currentSceneRevisionId, updatedAt }).changes;
    const links = db.prepare("UPDATE scene_entity_links SET status = 'stale', version = version + 1, updated_at = :updatedAt WHERE project_id = :projectId AND scene_id = :sceneId AND scene_revision_id <> :sceneRevisionId AND status NOT IN ('rejected', 'stale')").run({ projectId, sceneId, sceneRevisionId: currentSceneRevisionId, updatedAt }).changes;
    return { mentions, links };
  });
}

/**
 * Commit deterministic resolver output only after the caller has rechecked the
 * current document revision. Existing rejection fingerprints are intentionally
 * retained and suppress future projections for that same revision.
 */
export function projectAnalysisCandidates(values: {
  projectId: string;
  documentId: string;
  sceneId: string;
  sceneRevisionId: string;
  analysisRunId: string;
  leaseToken: string;
  candidates: AnalysisProjectionCandidate[];
  actorId?: string;
  requestId?: string;
  completeRun?: { leaseToken: string; requestId: string; mentionCount: number; actorId?: string };
}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, values.projectId);
  assertSceneRevision(db, values.projectId, values.sceneId, values.sceneRevisionId);
  return withTransaction(db, () => {
    const currentDocument = db.prepare("SELECT d.project_id, sr.id AS current_scene_revision_id FROM script_documents d JOIN scene_revisions sr ON sr.document_revision_id = d.current_revision_id AND sr.scene_id = :sceneId WHERE d.id = :documentId").get({ documentId: values.documentId, sceneId: values.sceneId }) as { project_id?: string; current_scene_revision_id?: string } | undefined;
    if (!currentDocument || currentDocument.project_id !== values.projectId || currentDocument.current_scene_revision_id !== values.sceneRevisionId) throw new SceneAnalysisStaleError();
    const lease = db.prepare("SELECT status, lease_token, lease_expires_at, project_id, scene_revision_id FROM analysis_runs WHERE id = :analysisRunId AND project_id = :projectId").get({ analysisRunId: values.analysisRunId, projectId: values.projectId }) as { status?: string; lease_token?: string | null; lease_expires_at?: string | null; project_id?: string; scene_revision_id?: string } | undefined;
    if (!lease || lease.project_id !== values.projectId || lease.scene_revision_id !== values.sceneRevisionId || lease.status !== "running" || lease.lease_token !== values.leaseToken || !lease.lease_expires_at || Date.parse(lease.lease_expires_at) <= Date.now()) throw new SceneAnalysisStaleError("The analysis lease is no longer valid");
    const timestamp = now();
    db.prepare("UPDATE entity_mentions SET status = 'stale', updated_at = :updatedAt WHERE project_id = :projectId AND scene_id = :sceneId AND scene_revision_id = :sceneRevisionId AND status NOT IN ('rejected', 'stale')").run({ projectId: values.projectId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, updatedAt: timestamp });
    db.prepare("UPDATE scene_entity_links SET status = 'stale', version = version + 1, updated_at = :updatedAt WHERE project_id = :projectId AND scene_id = :sceneId AND scene_revision_id = :sceneRevisionId AND status = 'candidate'").run({ projectId: values.projectId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, updatedAt: timestamp });

    const links: string[] = [];
    for (const originalCandidate of values.candidates) {
      const candidate = { ...originalCandidate };
      if (!candidate.entityId) {
        const normalizedName = normalizeAnalysisText(candidate.stubName ?? candidate.surface);
        const draftRows = db.prepare("SELECT e.id, e.canonical_name, ea.normalized_alias FROM entities e LEFT JOIN entity_aliases ea ON ea.project_id = e.project_id AND ea.entity_id = e.id AND ea.status = 'active' WHERE e.project_id = :projectId AND e.entity_type = :entityType AND e.status = 'draft' ORDER BY e.id ASC").all({ projectId: values.projectId, entityType: candidate.entityType }) as unknown as Array<{ id: string; canonical_name: string; normalized_alias: string | null }>;
        const existingDraft = draftRows.find((row) => normalizeAnalysisText(row.canonical_name) === normalizedName || (row.normalized_alias !== null && normalizeAnalysisText(row.normalized_alias) === normalizedName));
        candidate.entityId = existingDraft?.id ?? randomUUID();
        if (!existingDraft?.id) {
        db.prepare("INSERT INTO entities (id, project_id, entity_type, canonical_name, status, merged_into_entity_id, attributes_json, schema_version, version, created_at, updated_at) VALUES (:id, :projectId, :entityType, :canonicalName, 'draft', NULL, '{}', 1, 1, :createdAt, :updatedAt)").run({ id: candidate.entityId, projectId: values.projectId, entityType: candidate.entityType, canonicalName: candidate.stubName?.trim() || candidate.surface, createdAt: timestamp, updatedAt: timestamp });
          const aliasId = randomUUID();
          db.prepare("INSERT OR IGNORE INTO entity_aliases (id, project_id, entity_id, alias, normalized_alias, locale, status, created_at) VALUES (:id, :projectId, :entityId, :alias, :normalizedAlias, 'und', 'active', :createdAt)").run({ id: aliasId, projectId: values.projectId, entityId: candidate.entityId, alias: candidate.stubName?.trim() || candidate.surface, normalizedAlias: normalizedName, createdAt: timestamp });
          const entityEventRequestId = values.requestId ?? `analysis:${values.analysisRunId}:entity:${candidate.entityId}`;
          writeEvent(db, { projectId: values.projectId, eventType: "entity.created", aggregateType: "entity", aggregateId: candidate.entityId, aggregateVersion: 1, requestId: entityEventRequestId, actorId: values.actorId, payload: { type: candidate.entityType, canonicalName: candidate.stubName?.trim() || candidate.surface, source: "explicit_stub" } });
          writeEvent(db, { projectId: values.projectId, eventType: "entity.alias.created", aggregateType: "entity", aggregateId: candidate.entityId, aggregateVersion: 1, requestId: `${entityEventRequestId}:alias:${aliasId}`, actorId: values.actorId, payload: { aliasId, normalizedAlias: normalizedName, source: "explicit_stub" } });
        }
      }
      const entityId = candidate.entityId;
      if (!entityId) throw new StoryBibleDataIntegrityError("Analysis candidate has no entity after stub resolution");
      const entityRow = db.prepare("SELECT entity_type, status, merged_into_entity_id FROM entities WHERE id = :entityId AND project_id = :projectId").get({ entityId, projectId: values.projectId }) as { entity_type?: string; status?: string; merged_into_entity_id?: string | null } | undefined;
      if (!entityRow || entityRow.entity_type !== candidate.entityType || !["active", "draft"].includes(entityRow.status ?? "") || entityRow.merged_into_entity_id !== null) {
        throw new StoryBibleDataIntegrityError("Analysis candidate entity is not a resolvable project-scoped entity");
      }
      const role = candidate.role ?? sceneEntityLinkRoleForType(candidate.entityType);
      /* A link is the revision-scoped entity/role projection; individual
       * occurrences remain distinct mentions and carry their own fingerprint. */
      const linkFingerprint = `${values.sceneRevisionId}:${entityId}:${role}`;
      const rejectedMention = db.prepare("SELECT id FROM entity_mentions WHERE project_id = :projectId AND scene_revision_id = :sceneRevisionId AND fingerprint = :fingerprint AND status = 'rejected' LIMIT 1").get({ projectId: values.projectId, sceneRevisionId: values.sceneRevisionId, fingerprint: candidate.fingerprint }) as { id?: string } | undefined;
      const rejectedLink = db.prepare("SELECT id FROM scene_entity_links WHERE project_id = :projectId AND scene_revision_id = :sceneRevisionId AND entity_id = :entityId AND role = :role AND status = 'rejected' LIMIT 1").get({ projectId: values.projectId, sceneRevisionId: values.sceneRevisionId, entityId, role }) as { id?: string } | undefined;
      if (rejectedMention?.id || rejectedLink?.id) continue;

      const evidenceSourceId = randomUUID();
      db.prepare("INSERT INTO evidence_sources (id, project_id, kind, document_id, scene_id, scene_revision_id, revision_id, anchor_start, anchor_end, quoted_text, created_by_user_id, model_run_id, created_at) VALUES (:id, :projectId, 'text_span', :documentId, :sceneId, :sceneRevisionId, :sceneRevisionId, :anchorStart, :anchorEnd, :quotedText, NULL, :modelRunId, :createdAt)").run({ id: evidenceSourceId, projectId: values.projectId, documentId: values.documentId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, anchorStart: String(candidate.anchorStart), anchorEnd: String(candidate.anchorEnd), quotedText: candidate.surface, modelRunId: values.analysisRunId, createdAt: timestamp });
      const mentionId = randomUUID();
      db.prepare("INSERT INTO entity_mentions (id, project_id, document_id, scene_id, scene_revision_id, analysis_run_id, entity_id, entity_type, surface, normalized_surface, anchor_start, anchor_end, candidate_group_id, fingerprint, evidence_source_id, status, created_at, updated_at) VALUES (:id, :projectId, :documentId, :sceneId, :sceneRevisionId, :analysisRunId, :entityId, :entityType, :surface, :normalizedSurface, :anchorStart, :anchorEnd, :candidateGroupId, :fingerprint, :evidenceSourceId, 'active', :createdAt, :updatedAt)").run({ id: mentionId, projectId: values.projectId, documentId: values.documentId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, analysisRunId: values.analysisRunId, entityId, entityType: candidate.entityType, surface: candidate.surface, normalizedSurface: candidate.normalizedSurface, anchorStart: candidate.anchorStart, anchorEnd: candidate.anchorEnd, candidateGroupId: candidate.candidateGroupId, fingerprint: candidate.fingerprint, evidenceSourceId, createdAt: timestamp, updatedAt: timestamp });
      const existing = db.prepare("SELECT id, status, version, confidence FROM scene_entity_links WHERE project_id = :projectId AND scene_revision_id = :sceneRevisionId AND entity_id = :entityId AND role = :role ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'candidate' THEN 1 WHEN 'stale' THEN 2 ELSE 3 END, created_at ASC, id ASC LIMIT 1").get({ projectId: values.projectId, sceneRevisionId: values.sceneRevisionId, entityId, role }) as { id?: string; status?: SceneEntityLink["status"]; version?: number; confidence?: number | null } | undefined;
      const linkId = existing?.id ?? randomUUID();
      if (existing?.id && existing.status !== "confirmed") {
        /* Identity, resolver, candidate group, and provenance are immutable.
         * Reanalysis may refresh confidence and lifecycle only. A repeated
         * occurrence with the same lifecycle is an attach-only operation and
         * must not manufacture a version transition. */
        const nextStatus = candidate.confidence === 1 ? "confirmed" : "candidate";
        const nextConfidence = candidate.confidence ?? null;
        if (existing.status !== nextStatus || existing.confidence !== nextConfidence) {
          db.prepare("UPDATE scene_entity_links SET status = :status, confidence = :confidence, version = version + 1, updated_at = :updatedAt WHERE id = :id AND project_id = :projectId").run({ id: existing.id, projectId: values.projectId, status: nextStatus, confidence: nextConfidence, updatedAt: timestamp });
        }
      } else if (!existing?.id) {
        db.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, :entityType, :role, :status, :resolver, :confidence, 1, :candidateGroupId, :fingerprint, :analysisRunId, :createdAt, :updatedAt)").run({ id: linkId, projectId: values.projectId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, entityId, entityType: candidate.entityType, role, status: candidate.confidence === 1 ? "confirmed" : "candidate", resolver: candidate.resolver, confidence: candidate.confidence ?? null, candidateGroupId: candidate.candidateGroupId, fingerprint: linkFingerprint, analysisRunId: values.analysisRunId, createdAt: timestamp, updatedAt: timestamp });
      }
      db.prepare("INSERT OR IGNORE INTO scene_entity_link_mentions (project_id, link_id, mention_id, created_at) VALUES (:projectId, :linkId, :mentionId, :createdAt)").run({ projectId: values.projectId, linkId, mentionId, createdAt: timestamp });
      links.push(linkId);
    }

    if (values.requestId) writeEvent(db, { projectId: values.projectId, eventType: "scene_links.changed", aggregateType: "scene", aggregateId: values.sceneId, aggregateVersion: null, requestId: values.requestId, payload: { sceneRevisionId: values.sceneRevisionId, linkIds: links }, actorId: values.actorId });
    if (values.completeRun) {
      const completedAt = now();
      const completed = db.prepare("UPDATE analysis_runs SET status = 'succeeded', lease_token = NULL, lease_expires_at = NULL, completed_at = :completedAt, updated_at = :updatedAt WHERE id = :analysisRunId AND project_id = :projectId AND status = 'running' AND lease_token = :leaseToken AND lease_expires_at IS NOT NULL AND lease_expires_at > :now").run({ analysisRunId: values.analysisRunId, projectId: values.projectId, leaseToken: values.completeRun.leaseToken, completedAt, updatedAt: completedAt, now: completedAt });
      if (completed.changes === 0) throw new SceneAnalysisStaleError("The analysis lease was fenced before projection completed");
      writeEvent(db, { projectId: values.projectId, eventType: "analysis.completed", aggregateType: "analysis_run", aggregateId: values.analysisRunId, aggregateVersion: null, requestId: values.completeRun.requestId, actorId: values.completeRun.actorId, payload: { sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, mentionCount: values.completeRun.mentionCount } });
    }
    return { mentions: listEntityMentions(values.projectId, { sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId }, db), links: listSceneEntityLinks(values.projectId, values.sceneId, { sceneRevisionId: values.sceneRevisionId }, db) };
  });
}

export function reviewSceneEntityLink(linkId: string, input: ReviewSceneEntityLinkInput, projectId: string, database?: DatabaseSync) {
  const values = reviewSceneEntityLinkInputSchema.parse(input);
  const db = resolveDatabase(database);
  /* Read only to establish the tenant for an unscoped repository call. All
   * identity, idempotency, revision, and CAS checks repeat inside the write
   * transaction so a concurrent revision change cannot slip between them. */
  const hinted = getLinkWithDatabase(linkId, projectId, db);
  if (!hinted) throw new StoryBibleNotFoundError("Scene entity link not found");
  const scopedProjectId = projectId;
  const decision = values.status ?? (values.decision === "confirm" ? "confirmed" : "rejected");

  return withTransaction(db, () => {
    const duplicate = db.prepare("SELECT resource_id, response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = 'scene-link.review' AND request_id = :requestId").get({ projectId: scopedProjectId, requestId: values.requestId }) as { resource_id?: string; response_json?: string } | undefined;
    if (duplicate) {
      if (!duplicate.resource_id || !duplicate.response_json) throw new StoryBibleDataIntegrityError("Stored scene-link idempotency mapping is incomplete");
      const stored = parseJson(duplicate.response_json);
      if (stored.linkId !== linkId || stored.decision !== decision || stored.expectedVersion !== values.expectedVersion || stored.expectedSceneRevisionId !== values.expectedSceneRevisionId) {
        throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different scene-link review");
      }
      const replay = getLinkWithDatabase(linkId, scopedProjectId, db);
      if (!replay) throw new StoryBibleNotFoundError("Scene entity link not found");
      return replay;
    }
    const current = getLinkWithDatabase(linkId, scopedProjectId, db);
    if (!current) throw new StoryBibleNotFoundError("Scene entity link not found");
    if (current.version !== values.expectedVersion) throw new SceneEntityLinkConflictError(current);
    if (current.sceneRevisionId !== values.expectedSceneRevisionId) throw new SceneEntityLinkConflictError(current, "The link belongs to an older scene revision.");
    if (current.status === decision) throw new SceneEntityLinkConflictError(current, `The link is already ${decision}.`);
    const currentRevision = db.prepare("SELECT sr.id AS scene_revision_id FROM scenes s JOIN script_documents d ON d.id = s.document_id JOIN scene_revisions sr ON sr.document_revision_id = d.current_revision_id AND sr.scene_id = s.id WHERE s.id = :sceneId AND s.project_id = :projectId").get({ sceneId: current.sceneId, projectId: scopedProjectId }) as { scene_revision_id?: string } | undefined;
    if (!currentRevision || currentRevision.scene_revision_id !== current.sceneRevisionId) throw new SceneEntityLinkConflictError(current, "The scene has a newer revision. Review the latest analysis.");
    if (decision === "confirmed") {
      const entity = db.prepare("SELECT entity_type, status, merged_into_entity_id FROM entities WHERE id = :entityId AND project_id = :projectId").get({ entityId: current.entityId, projectId: scopedProjectId }) as { entity_type?: string; status?: string; merged_into_entity_id?: string | null } | undefined;
      if (!entity || entity.entity_type !== current.entityType || !["active", "draft"].includes(entity.status ?? "") || entity.merged_into_entity_id !== null) {
        throw new SceneEntityLinkConflictError(current, "The linked entity is archived or merged and cannot be confirmed.");
      }
    }
    const timestamp = now();
    const result = db.prepare("UPDATE scene_entity_links SET status = :status, version = version + 1, updated_at = :updatedAt WHERE id = :linkId AND project_id = :projectId AND version = :expectedVersion AND scene_revision_id = :sceneRevisionId").run({ linkId, projectId: scopedProjectId, status: decision, updatedAt: timestamp, expectedVersion: values.expectedVersion, sceneRevisionId: values.expectedSceneRevisionId });
    if (result.changes === 0) {
      const latest = getLinkWithDatabase(linkId, scopedProjectId, db);
      if (latest) throw new SceneEntityLinkConflictError(latest);
      throw new StoryBibleNotFoundError("Scene entity link not found");
    }
    if (decision === "confirmed") {
      db.prepare("UPDATE scene_entity_links SET status = 'rejected', version = version + 1, updated_at = :updatedAt WHERE project_id = :projectId AND scene_revision_id = :sceneRevisionId AND candidate_group_id = (SELECT candidate_group_id FROM scene_entity_links WHERE id = :linkId) AND id <> :linkId AND status = 'candidate'").run({ projectId: scopedProjectId, sceneRevisionId: values.expectedSceneRevisionId, linkId, updatedAt: timestamp });
      db.prepare("UPDATE entity_mentions SET status = 'rejected', updated_at = :updatedAt WHERE project_id = :projectId AND status NOT IN ('stale', 'rejected') AND id IN (SELECT mention_id FROM scene_entity_link_mentions WHERE project_id = :projectId AND link_id IN (SELECT id FROM scene_entity_links WHERE project_id = :projectId AND scene_revision_id = :sceneRevisionId AND candidate_group_id = (SELECT candidate_group_id FROM scene_entity_links WHERE id = :linkId) AND id <> :linkId))").run({ projectId: scopedProjectId, sceneRevisionId: values.expectedSceneRevisionId, linkId, updatedAt: timestamp });
    }
    db.prepare("UPDATE entity_mentions SET status = :status, updated_at = :updatedAt WHERE project_id = :projectId AND status <> 'stale' AND id IN (SELECT mention_id FROM scene_entity_link_mentions WHERE project_id = :projectId AND link_id = :linkId)").run({ projectId: scopedProjectId, linkId, status: decision === "rejected" ? "rejected" : "active", updatedAt: timestamp });
    const link = getLinkWithDatabase(linkId, scopedProjectId, db);
    if (!link) throw new StoryBibleDataIntegrityError("Reviewed scene entity link disappeared");
    db.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, 'scene-link.review', :requestId, 'scene_entity_link', :resourceId, :responseJson, :createdAt)").run({ id: randomUUID(), projectId: scopedProjectId, requestId: values.requestId, resourceId: linkId, responseJson: JSON.stringify({ linkId, decision, expectedVersion: values.expectedVersion, expectedSceneRevisionId: values.expectedSceneRevisionId }), createdAt: timestamp });
    writeEvent(db, { projectId: scopedProjectId, eventType: decision === "confirmed" ? "scene_link.confirmed" : "scene_link.rejected", aggregateType: "scene_entity_link", aggregateId: link.id, aggregateVersion: link.version, requestId: values.requestId, actorId: values.actorId, payload: { sceneId: link.sceneId, sceneRevisionId: link.sceneRevisionId, status: decision } });
    return link;
  });
}

export const reviewSceneLink = reviewSceneEntityLink;

export function createSceneLinkRepository(database: DatabaseSync = getDatabase()) {
  return {
    listEntityMentions: (projectId: string, options?: { sceneId?: string; sceneRevisionId?: string; status?: EntityMention["status"] }) => listEntityMentions(projectId, options, database),
    listMentions: (projectId: string, options?: { sceneId?: string; sceneRevisionId?: string; status?: EntityMention["status"] }) => listEntityMentions(projectId, options, database),
    listSceneEntityLinks: (projectId: string, sceneId: string, options?: { sceneRevisionId?: string; status?: SceneEntityLink["status"] }) => listSceneEntityLinks(projectId, sceneId, options, database),
    listSceneLinks: (projectId: string, sceneId: string, options?: { sceneRevisionId?: string; status?: SceneEntityLink["status"] }) => listSceneEntityLinks(projectId, sceneId, options, database),
    getSceneEntityLink: (linkId: string, projectId: string) => getSceneEntityLink(linkId, projectId, database),
    reviewSceneEntityLink: (linkId: string, input: ReviewSceneEntityLinkInput, projectId: string) => reviewSceneEntityLink(linkId, input, projectId, database),
    projectAnalysisCandidates: (values: Parameters<typeof projectAnalysisCandidates>[0]) => projectAnalysisCandidates(values, database),
  };
}
