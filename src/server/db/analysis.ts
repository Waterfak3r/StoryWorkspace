import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  analysisRunSchema,
  DETERMINISTIC_ANALYZER_VERSION,
  enqueueAnalysisInputSchema,
  executeAnalysisInputSchema,
  mentionFingerprint,
  normalizeAnalysisText,
  type AnalysisEntityType,
  type AnalysisRun,
  type EnqueueAnalysisInput,
  type ExecuteAnalysisInput,
} from "@/domain/analysis";
import type { Entity, EntityAlias } from "@/domain/story-bible";
import { listAliasesByProject, listEntities } from "./story-bible";
import { getDatabase } from "./connection";
import { getDocumentForProject, getSceneRevision } from "./document";
import {
  SceneAnalysisStaleError,
  StoryBibleDataIntegrityError,
  StoryBibleIdempotencyConflictError,
  StoryBibleNotFoundError,
  StoryBibleValidationError,
} from "./story-bible-errors";
import { projectAnalysisCandidates, type AnalysisProjectionCandidate } from "./scene-link";

type SqliteParameters = Record<string, string | number | null>;

type AnalysisRunRow = {
  id: string;
  project_id: string;
  document_id: string;
  scene_id: string;
  scene_revision_id: string;
  content_hash: string;
  analyzer_version: string;
  idempotency_key: string;
  status: AnalysisRun["status"];
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DeterministicMention = {
  entityType: AnalysisEntityType;
  surface: string;
  normalizedSurface: string;
  anchorStart: number;
  anchorEnd: number;
  candidateGroupId: string;
  fingerprint: string;
  candidateEntityIds: string[];
  candidateEntityId?: string;
  explicitStub: boolean;
  resolver: "exact_alias" | "explicit_stub";
  status: "candidate" | "confirmed";
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

function stableUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export const deterministicUuid = stableUuid;

function entityIsResolvable(entity: Entity) {
  return entity.mergedIntoEntityId === null && entity.status !== "archived" && entity.status !== "merged" && (entity.type === "character" || entity.type === "location" || entity.type === "prop");
}

function escapedRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function containsLatinWord(value: string) {
  return /[A-Za-z0-9_]/u.test(value);
}

function findTermOccurrences(text: string, term: string) {
  const normalizedTerm = normalizeAnalysisText(term);
  if (!normalizedTerm) return [] as Array<{ start: number; end: number; surface: string }>;
  const pattern = escapedRegex(normalizedTerm).replace(/ /gu, "\\s+");
  const source = containsLatinWord(normalizedTerm) ? `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])` : pattern;
  const expression = new RegExp(source, "giu");
  /* Match on normalized text, but retain a UTF-16 offset map back to the
   * immutable source revision. NFKC can expand or contract compatibility
   * glyphs, so normalized match indices cannot be sliced directly. */
  let normalizedText = "";
  const offsetStarts: number[] = [];
  const offsetEnds: number[] = [];
  for (let sourceIndex = 0; sourceIndex < text.length;) {
    const codePoint = text.codePointAt(sourceIndex);
    if (codePoint === undefined) break;
    const sourceEnd = sourceIndex + (codePoint > 0xffff ? 2 : 1);
    const normalizedChunk = String.fromCodePoint(codePoint).normalize("NFKC").toLocaleLowerCase();
    normalizedText += normalizedChunk;
    for (let offset = 0; offset < normalizedChunk.length; offset += 1) {
      offsetStarts.push(sourceIndex);
      offsetEnds.push(sourceEnd);
    }
    sourceIndex = sourceEnd;
  }
  const matches: Array<{ start: number; end: number; surface: string }> = [];
  for (const match of normalizedText.matchAll(expression)) {
    const normalizedStart = match.index ?? 0;
    const normalizedEnd = normalizedStart + match[0].length;
    const start = offsetStarts[normalizedStart];
    const end = offsetEnds[normalizedEnd - 1];
    if (start === undefined || end === undefined) continue;
    matches.push({ start, end, surface: text.slice(start, end) });
  }
  return matches;
}

function overlaps(left: { start: number; end: number }, right: { start: number; end: number }) {
  return left.start < right.end && right.start < left.end;
}

/**
 * Resolve only exact canonical names and active aliases. The returned result
 * is pure and contains no database write or model call.
 */
export function analyzeSceneText(input: {
  sceneRevisionId: string;
  content: string;
  entities: Entity[];
  aliases?: EntityAlias[];
}): DeterministicMention[] {
  const entities = input.entities.filter(entityIsResolvable);
  const aliases = (input.aliases ?? []).filter((alias) => alias.status === "active");
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  /*
   * Candidate grouping is intentionally independent of entity type. A name
   * shared by a character and a location is still ambiguous: callers must
   * review it instead of silently confirming one typed interpretation.
   */
  const terms = new Map<string, { normalized: string; entityIds: string[] }>();
  for (const entity of entities) {
    const normalized = normalizeAnalysisText(entity.canonicalName);
    if (!normalized) continue;
    const key = normalized;
    const item = terms.get(key) ?? { normalized, entityIds: [] };
    if (!item.entityIds.includes(entity.id)) item.entityIds.push(entity.id);
    terms.set(key, item);
  }
  for (const alias of aliases) {
    const entity = byId.get(alias.entityId);
    if (!entity || !entityIsResolvable(entity)) continue;
    const normalized = normalizeAnalysisText(alias.normalizedAlias || alias.alias);
    if (!normalized) continue;
    const key = normalized;
    const item = terms.get(key) ?? { normalized, entityIds: [] };
    if (!item.entityIds.includes(entity.id)) item.entityIds.push(entity.id);
    terms.set(key, item);
  }

  const raw: Array<DeterministicMention & { range: { start: number; end: number } }> = [];
  const stubExpression = /\[\[(character|location|prop):([^\]\r\n]+)\]\]/giu;
  const stubRanges: Array<{ start: number; end: number }> = [];
  for (const match of input.content.matchAll(stubExpression)) {
    const tokenStart = match.index ?? 0;
    const tokenEnd = tokenStart + match[0].length;
    const entityType = match[1].toLocaleLowerCase() as AnalysisEntityType;
    const rawSurface = match[2];
    const surface = rawSurface.trim();
    const leadingWhitespace = rawSurface.length - rawSurface.trimStart().length;
    const start = tokenStart + 3 + match[1].length + leadingWhitespace;
    const end = start + surface.length;
    const normalizedSurface = normalizeAnalysisText(surface);
    const candidateGroupId = stableUuid(`${input.sceneRevisionId}:stub:${entityType}:${tokenStart}:${tokenEnd}:${normalizedSurface}`);
    const baseFingerprint = mentionFingerprint({ sceneRevisionId: input.sceneRevisionId, entityType, normalizedSurface, anchorStart: start, anchorEnd: end });
    stubRanges.push({ start: tokenStart, end: tokenEnd });
    raw.push({ entityType, surface, normalizedSurface, anchorStart: start, anchorEnd: end, candidateGroupId, fingerprint: `${baseFingerprint}:stub`, candidateEntityIds: [], explicitStub: true, resolver: "explicit_stub", status: "candidate", range: { start, end } });
  }

  for (const term of terms.values()) {
    for (const occurrence of findTermOccurrences(input.content, term.normalized)) {
      if (stubRanges.some((range) => overlaps(occurrence, range))) continue;
      const candidateGroupId = stableUuid(`${input.sceneRevisionId}:mention:${occurrence.start}:${occurrence.end}:${term.normalized}`);
      for (const entityId of term.entityIds) {
        const entity = byId.get(entityId);
        if (!entity) continue;
        const entityType = entity.type as AnalysisEntityType;
        const baseFingerprint = mentionFingerprint({ sceneRevisionId: input.sceneRevisionId, entityType, normalizedSurface: term.normalized, anchorStart: occurrence.start, anchorEnd: occurrence.end });
        raw.push({ entityType, surface: occurrence.surface, normalizedSurface: term.normalized, anchorStart: occurrence.start, anchorEnd: occurrence.end, candidateGroupId, fingerprint: `${baseFingerprint}:${entityId}`, candidateEntityIds: term.entityIds.slice(), candidateEntityId: entityId, explicitStub: false, resolver: "exact_alias", status: term.entityIds.length === 1 ? "confirmed" : "candidate", range: { start: occurrence.start, end: occurrence.end } });
      }
    }
  }

  /* Prefer the longest exact match when aliases overlap at the same offset. */
  const selected: typeof raw = [];
  for (const candidate of raw.sort((left, right) => left.range.start - right.range.start || (right.range.end - right.range.start) - (left.range.end - left.range.start) || left.entityType.localeCompare(right.entityType))) {
    const sameRange = selected.some((existing) => existing.range.start === candidate.range.start && existing.range.end === candidate.range.end);
    if (sameRange) {
      if (!selected.some((existing) => existing.range.start === candidate.range.start && existing.range.end === candidate.range.end && existing.fingerprint === candidate.fingerprint)) selected.push(candidate);
      continue;
    }
    if (selected.some((existing) => overlaps(existing.range, candidate.range) && (existing.range.start !== candidate.range.start || existing.range.end >= candidate.range.end))) continue;
    selected.push(candidate);
  }
  return selected.map((mention) => {
    const result = { ...mention };
    delete (result as { range?: { start: number; end: number } }).range;
    return result;
  });
}

export const analyzeScene = analyzeSceneText;
export const resolveSceneEntities = analyzeSceneText;

function toAnalysisRun(row: AnalysisRunRow): AnalysisRun {
  return analysisRunSchema.parse({
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    sceneId: row.scene_id,
    sceneRevisionId: row.scene_revision_id,
    contentHash: row.content_hash,
    analyzerVersion: row.analyzer_version,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    attempt: row.attempt,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function selectRun(database: DatabaseSync, runId: string, projectId: string) {
  return database.prepare("SELECT id, project_id, document_id, scene_id, scene_revision_id, content_hash, analyzer_version, idempotency_key, status, lease_token, lease_expires_at, attempt, error_code, error_message, started_at, completed_at, created_at, updated_at FROM analysis_runs WHERE id = :runId AND project_id = :projectId").get({ runId, projectId }) as unknown as AnalysisRunRow | undefined;
}

function getRunWithDatabase(runId: string, projectId: string, database: DatabaseSync) {
  const row = selectRun(database, runId, projectId);
  return row ? toAnalysisRun(row) : null;
}

function getProject(database: DatabaseSync, projectId: string) {
  const row = database.prepare("SELECT id FROM projects WHERE id = :projectId").get({ projectId }) as { id?: string } | undefined;
  if (!row) throw new StoryBibleNotFoundError("Project not found");
}

function writeEvent(database: DatabaseSync, values: { projectId: string; eventType: string; aggregateType: string; aggregateId: string; aggregateVersion?: number | null; requestId: string; payload?: Record<string, unknown>; actorId?: string }) {
  const createdAt = now();
  const payloadJson = JSON.stringify(values.payload ?? {});
  database.prepare("INSERT OR IGNORE INTO audit_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, actor_id, request_id, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :actorId, :requestId, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, actorId: values.actorId ?? "local-user", requestId: values.requestId, createdAt });
  database.prepare("INSERT OR IGNORE INTO outbox_events (id, project_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload_json, request_id, status, attempts, available_at, published_at, created_at) VALUES (:id, :projectId, :eventType, :aggregateType, :aggregateId, :aggregateVersion, :payloadJson, :requestId, 'pending', 0, :availableAt, NULL, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, eventType: values.eventType, aggregateType: values.aggregateType, aggregateId: values.aggregateId, aggregateVersion: values.aggregateVersion ?? null, payloadJson, requestId: values.requestId, availableAt: createdAt, createdAt });
}

export function getAnalysisRun(runId: string, projectId: string, database?: DatabaseSync) {
  return getRunWithDatabase(runId, projectId, resolveDatabase(database));
}

export const getAnalysis = getAnalysisRun;

export function listAnalysisRuns(projectId: string, options: { sceneId?: string; sceneRevisionId?: string; status?: AnalysisRun["status"] } = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const conditions = ["project_id = :projectId"];
  const parameters: SqliteParameters = { projectId };
  if (options.sceneId) { conditions.push("scene_id = :sceneId"); parameters.sceneId = options.sceneId; }
  if (options.sceneRevisionId) { conditions.push("scene_revision_id = :sceneRevisionId"); parameters.sceneRevisionId = options.sceneRevisionId; }
  if (options.status) { conditions.push("status = :status"); parameters.status = options.status; }
  const rows = db.prepare(`SELECT id, project_id, document_id, scene_id, scene_revision_id, content_hash, analyzer_version, idempotency_key, status, lease_token, lease_expires_at, attempt, error_code, error_message, started_at, completed_at, created_at, updated_at FROM analysis_runs WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC`).all(parameters) as unknown as AnalysisRunRow[];
  return rows.map(toAnalysisRun);
}

export const listAnalysis = listAnalysisRuns;

type AnalysisEnqueueFingerprint = {
  sceneRevisionId: string;
  analyzerVersion: string;
  contentHash: string;
};

function analysisEnqueueFingerprint(values: AnalysisEnqueueFingerprint) {
  /* Property order is fixed so this value can be compared byte-for-byte. */
  return JSON.stringify({
    sceneRevisionId: values.sceneRevisionId,
    analyzerVersion: values.analyzerVersion,
    contentHash: values.contentHash,
  });
}

function writeAnalysisEnqueueIdempotency(database: DatabaseSync, values: {
  projectId: string;
  requestId: string;
  run: AnalysisRun;
  createdAt: string;
}) {
  const inputFingerprint = analysisEnqueueFingerprint({
    sceneRevisionId: values.run.sceneRevisionId,
    analyzerVersion: values.run.analyzerVersion,
    contentHash: values.run.contentHash,
  });
  database.prepare("INSERT INTO idempotency_keys (id, project_id, operation, request_id, resource_type, resource_id, response_json, created_at) VALUES (:id, :projectId, 'analysis.enqueue', :requestId, 'analysis_run', :resourceId, :responseJson, :createdAt)").run({
    id: randomUUID(),
    projectId: values.projectId,
    requestId: values.requestId,
    resourceId: values.run.id,
    responseJson: JSON.stringify({ runId: values.run.id, inputFingerprint: JSON.parse(inputFingerprint) as AnalysisEnqueueFingerprint }),
    createdAt: values.createdAt,
  });
}

function findAnalysisEnqueueIdempotency(database: DatabaseSync, projectId: string, requestId: string, expected: AnalysisEnqueueFingerprint) {
  const row = database.prepare("SELECT resource_id, response_json FROM idempotency_keys WHERE project_id = :projectId AND operation = 'analysis.enqueue' AND request_id = :requestId").get({ projectId, requestId }) as { resource_id?: string; response_json?: string } | undefined;
  if (!row) return null;
  if (!row.resource_id || !row.response_json) throw new StoryBibleDataIntegrityError("Stored analysis enqueue idempotency mapping is incomplete");
  let parsed: { runId?: unknown; inputFingerprint?: unknown };
  try {
    parsed = JSON.parse(row.response_json) as { runId?: unknown; inputFingerprint?: unknown };
  } catch {
    throw new StoryBibleDataIntegrityError("Stored analysis enqueue idempotency response is invalid");
  }
  const fingerprint = parsed.inputFingerprint;
  if (typeof fingerprint !== "object" || fingerprint === null || analysisEnqueueFingerprint(fingerprint as AnalysisEnqueueFingerprint) !== analysisEnqueueFingerprint(expected)) {
    throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different analysis input");
  }
  if (typeof parsed.runId === "string" && parsed.runId !== row.resource_id) {
    throw new StoryBibleDataIntegrityError("Stored analysis enqueue resource does not match its response");
  }
  const run = getRunWithDatabase(row.resource_id, projectId, database);
  if (!run) throw new StoryBibleDataIntegrityError("Stored analysis enqueue run no longer exists");
  if (analysisEnqueueFingerprint({ sceneRevisionId: run.sceneRevisionId, analyzerVersion: run.analyzerVersion, contentHash: run.contentHash }) !== analysisEnqueueFingerprint(expected)) {
    throw new StoryBibleIdempotencyConflictError("This request ID was already used for a different analysis input");
  }
  return run;
}

export function enqueueAnalysisRun(projectId: string, input: EnqueueAnalysisInput, database?: DatabaseSync) {
  const values = enqueueAnalysisInputSchema.parse(input);
  const db = resolveDatabase(database);
  getProject(db, projectId);
  const document = getDocumentForProject(projectId, values.documentId, db);
  const sceneRevision = getSceneRevision(values.sceneRevisionId, projectId, db);
  if (!sceneRevision || sceneRevision.documentId !== document.id || sceneRevision.sceneId !== values.sceneId) throw new StoryBibleNotFoundError("Scene revision not found");
  if (values.contentHash !== undefined && values.contentHash !== sceneRevision.contentHash) throw new StoryBibleValidationError("contentHash must match the scene revision", ["contentHash"]);
  const idempotencyKey = values.idempotencyKey ?? values.requestId ?? `${values.sceneRevisionId}:${sceneRevision.contentHash}:${values.analyzerVersion ?? DETERMINISTIC_ANALYZER_VERSION}`;
  const analyzerVersion = values.analyzerVersion ?? DETERMINISTIC_ANALYZER_VERSION;

  return withTransaction(db, () => {
    const timestamp = now();
    const currentRevision = db.prepare("SELECT sr.id AS current_scene_revision_id, sr.content_hash, sr.status FROM script_documents d JOIN scene_revisions sr ON sr.document_revision_id = d.current_revision_id AND sr.scene_id = :sceneId WHERE d.id = :documentId AND d.project_id = :projectId").get({ documentId: document.id, projectId, sceneId: values.sceneId }) as { current_scene_revision_id?: string; content_hash?: string; status?: "active" | "deleted" } | undefined;
    if (!currentRevision || currentRevision.current_scene_revision_id !== values.sceneRevisionId) throw new SceneAnalysisStaleError("Only the current scene revision can be enqueued");
    if (currentRevision.status === "deleted") throw new StoryBibleValidationError("Deleted scene revisions cannot be analyzed", ["sceneRevisionId"]);
    const currentContentHash = currentRevision.content_hash;
    if (!currentContentHash || currentContentHash !== sceneRevision.contentHash) throw new StoryBibleValidationError("contentHash must match the scene revision", ["contentHash"]);
    const expectedFingerprint = { sceneRevisionId: values.sceneRevisionId, analyzerVersion, contentHash: currentContentHash };
    const mapped = findAnalysisEnqueueIdempotency(db, projectId, idempotencyKey, expectedFingerprint);
    if (mapped) return { run: mapped, idempotent: true };
    const duplicate = db.prepare("SELECT id, scene_revision_id, analyzer_version, content_hash FROM analysis_runs WHERE project_id = :projectId AND idempotency_key = :idempotencyKey").get({ projectId, idempotencyKey }) as { id?: string; scene_revision_id?: string; analyzer_version?: string; content_hash?: string } | undefined;
    if (duplicate?.id) {
      if (duplicate.scene_revision_id !== values.sceneRevisionId || duplicate.analyzer_version !== analyzerVersion || duplicate.content_hash !== currentContentHash) throw new StoryBibleIdempotencyConflictError();
      const run = getRunWithDatabase(duplicate.id, projectId, db);
      if (!run) throw new StoryBibleDataIntegrityError("Analysis run idempotency target could not be read");
      writeAnalysisEnqueueIdempotency(db, { projectId, requestId: idempotencyKey, run, createdAt: timestamp });
      return { run, idempotent: true };
    }
    const semanticDuplicate = db.prepare("SELECT id FROM analysis_runs WHERE project_id = :projectId AND scene_revision_id = :sceneRevisionId AND analyzer_version = :analyzerVersion AND content_hash = :contentHash ORDER BY created_at ASC, id ASC LIMIT 1").get({ projectId, sceneRevisionId: values.sceneRevisionId, analyzerVersion, contentHash: currentContentHash }) as { id?: string } | undefined;
    if (semanticDuplicate?.id) {
      const run = getRunWithDatabase(semanticDuplicate.id, projectId, db);
      if (!run) throw new StoryBibleDataIntegrityError("Semantic analysis run could not be read");
      writeAnalysisEnqueueIdempotency(db, { projectId, requestId: idempotencyKey, run, createdAt: timestamp });
      return { run, idempotent: true };
    }
    /* A new revision supersedes queued/running work and old projections. */
    db.prepare("UPDATE analysis_runs SET status = 'stale', lease_token = NULL, lease_expires_at = NULL, completed_at = :completedAt, updated_at = :updatedAt WHERE project_id = :projectId AND scene_id = :sceneId AND scene_revision_id <> :sceneRevisionId AND status <> 'stale'").run({ projectId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, completedAt: timestamp, updatedAt: timestamp });
    db.prepare("UPDATE entity_mentions SET status = 'stale', updated_at = :updatedAt WHERE project_id = :projectId AND scene_id = :sceneId AND scene_revision_id <> :sceneRevisionId AND status NOT IN ('rejected', 'stale')").run({ projectId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, updatedAt: timestamp });
    db.prepare("UPDATE scene_entity_links SET status = 'stale', version = version + 1, updated_at = :updatedAt WHERE project_id = :projectId AND scene_id = :sceneId AND scene_revision_id <> :sceneRevisionId AND status NOT IN ('rejected', 'stale')").run({ projectId, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, updatedAt: timestamp });
    const id = randomUUID();
    db.prepare("INSERT INTO analysis_runs (id, project_id, document_id, scene_id, scene_revision_id, content_hash, analyzer_version, idempotency_key, status, lease_token, lease_expires_at, attempt, error_code, error_message, started_at, completed_at, created_at, updated_at) VALUES (:id, :projectId, :documentId, :sceneId, :sceneRevisionId, :contentHash, :analyzerVersion, :idempotencyKey, 'queued', NULL, NULL, 0, NULL, NULL, NULL, NULL, :createdAt, :updatedAt)").run({ id, projectId, documentId: document.id, sceneId: values.sceneId, sceneRevisionId: values.sceneRevisionId, contentHash: currentContentHash, analyzerVersion, idempotencyKey, createdAt: timestamp, updatedAt: timestamp });
    const run = getRunWithDatabase(id, projectId, db);
    if (!run) throw new StoryBibleDataIntegrityError("Analysis run could not be read after enqueue");
    writeAnalysisEnqueueIdempotency(db, { projectId, requestId: idempotencyKey, run, createdAt: timestamp });
    writeEvent(db, { projectId, eventType: "analysis.requested", aggregateType: "analysis_run", aggregateId: id, aggregateVersion: run.attempt, requestId: idempotencyKey, actorId: values.actorId, payload: { sceneId: run.sceneId, sceneRevisionId: run.sceneRevisionId, contentHash: run.contentHash, analyzerVersion: run.analyzerVersion } });
    return { run, idempotent: false };
  });
}

export function enqueueAnalysis(projectId: string, input: EnqueueAnalysisInput, database?: DatabaseSync) {
  return enqueueAnalysisRun(projectId, input, database).run;
}

export const enqueueSceneAnalysis = enqueueAnalysis;

function markRunStatus(database: DatabaseSync, projectId: string, runId: string, values: { status: AnalysisRun["status"]; leaseToken?: string | null; expectedLeaseToken?: string; errorCode?: string | null; errorMessage?: string | null; completedAt?: string | null }) {
  const timestamp = now();
  const where = values.expectedLeaseToken ? "WHERE id = :runId AND status = 'running' AND lease_token = :expectedLeaseToken AND lease_expires_at IS NOT NULL AND lease_expires_at > :now" : "WHERE id = :runId";
  const scopedWhere = where.replace("WHERE id = :runId", "WHERE id = :runId AND project_id = :projectId");
  const result = database.prepare(`UPDATE analysis_runs SET status = :status, lease_token = :leaseToken, lease_expires_at = NULL, error_code = :errorCode, error_message = :errorMessage, completed_at = :completedAt, updated_at = :updatedAt ${scopedWhere}`).run({ runId, projectId, status: values.status, leaseToken: values.leaseToken ?? null, expectedLeaseToken: values.expectedLeaseToken ?? null, errorCode: values.errorCode ?? null, errorMessage: values.errorMessage ?? null, completedAt: values.completedAt ?? null, updatedAt: timestamp, now: timestamp });
  if (values.expectedLeaseToken && result.changes === 0) return null;
  return getRunWithDatabase(runId, projectId, database);
}

/** Claim and execute one run synchronously; callers invoke this command explicitly. */
export function executeAnalysisRun(projectId: string, runId: string, input: ExecuteAnalysisInput = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const existing = getRunWithDatabase(runId, projectId, db);
  if (!existing || existing.projectId !== projectId) throw new StoryBibleNotFoundError("Analysis run not found");
  if (existing.status === "succeeded" || existing.status === "stale") return existing;
  const parsedInput = executeAnalysisInputSchema.parse(input);
  const timestamp = now();
  const leaseSeconds = parsedInput.leaseSeconds ?? 30;
  const leaseToken = parsedInput.leaseToken ?? randomUUID();
  const leaseExpiresAt = new Date(Date.parse(timestamp) + leaseSeconds * 1000).toISOString();
  const expired = existing.leaseExpiresAt ? Date.parse(existing.leaseExpiresAt) <= Date.now() : true;
  if (existing.status === "running" && !expired && existing.leaseToken !== parsedInput.leaseToken) return existing;
  const claimed = db.prepare("UPDATE analysis_runs SET status = 'running', lease_token = :leaseToken, lease_expires_at = :leaseExpiresAt, attempt = attempt + 1, started_at = COALESCE(started_at, :startedAt), error_code = NULL, error_message = NULL, updated_at = :updatedAt WHERE project_id = :projectId AND ((id = :runId AND status IN ('queued', 'failed')) OR (id = :runId AND status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= :now))").run({ projectId, runId: existing.id, leaseToken, leaseExpiresAt, startedAt: timestamp, updatedAt: timestamp, now: timestamp });
  if (claimed.changes === 0) return getRunWithDatabase(existing.id, projectId, db) as AnalysisRun;
  const running = getRunWithDatabase(existing.id, projectId, db) as AnalysisRun;

  try {
    const sceneRevision = getSceneRevision(running.sceneRevisionId, running.projectId, db);
    if (!sceneRevision || sceneRevision.documentId !== running.documentId || sceneRevision.sceneId !== running.sceneId || sceneRevision.contentHash !== running.contentHash) {
      return (markRunStatus(db, running.projectId, running.id, { status: "stale", leaseToken: null, expectedLeaseToken: leaseToken, completedAt: now() }) ?? getRunWithDatabase(running.id, running.projectId, db)) as AnalysisRun;
    }
    const current = db.prepare("SELECT d.current_revision_id, sr.id AS current_scene_revision_id FROM script_documents d JOIN scene_revisions sr ON sr.document_revision_id = d.current_revision_id AND sr.scene_id = :sceneId WHERE d.id = :documentId AND d.project_id = :projectId").get({ documentId: running.documentId, projectId: running.projectId, sceneId: running.sceneId }) as { current_scene_revision_id?: string } | undefined;
    if (!current || current.current_scene_revision_id !== running.sceneRevisionId) return (markRunStatus(db, running.projectId, running.id, { status: "stale", leaseToken: null, expectedLeaseToken: leaseToken, completedAt: now() }) ?? getRunWithDatabase(running.id, running.projectId, db)) as AnalysisRun;
    const entities = listEntities(running.projectId, db);
    const aliases = listAliasesByProject(running.projectId, db);
    const mentions = analyzeSceneText({ sceneRevisionId: running.sceneRevisionId, content: sceneRevision.content, entities, aliases });
    const candidates: AnalysisProjectionCandidate[] = [];
    for (const mention of mentions) {
      if (mention.explicitStub) {
        candidates.push({ entityType: mention.entityType, surface: mention.surface, normalizedSurface: mention.normalizedSurface, anchorStart: mention.anchorStart, anchorEnd: mention.anchorEnd, candidateGroupId: mention.candidateGroupId, fingerprint: mention.fingerprint, resolver: "explicit_stub", confidence: null, stubName: mention.surface });
        continue;
      }
      if (mention.candidateEntityId) {
        candidates.push({ entityId: mention.candidateEntityId, entityType: mention.entityType, surface: mention.surface, normalizedSurface: mention.normalizedSurface, anchorStart: mention.anchorStart, anchorEnd: mention.anchorEnd, candidateGroupId: mention.candidateGroupId, fingerprint: mention.fingerprint, resolver: "exact_alias", confidence: mention.status === "confirmed" ? 1 : null });
      }
    }
    projectAnalysisCandidates({ projectId: running.projectId, documentId: running.documentId, sceneId: running.sceneId, sceneRevisionId: running.sceneRevisionId, analysisRunId: running.id, leaseToken, candidates, actorId: "local-user", requestId: `analysis:${running.id}`, completeRun: { leaseToken, requestId: `analysis-completed:${running.id}`, mentionCount: mentions.length } }, db);
    const completed = getRunWithDatabase(running.id, running.projectId, db);
    if (!completed || completed.status !== "succeeded") return (completed ?? running);
    return completed;
  } catch (error) {
    if (error instanceof SceneAnalysisStaleError) return (markRunStatus(db, running.projectId, running.id, { status: "stale", leaseToken: null, expectedLeaseToken: leaseToken, completedAt: now() }) ?? getRunWithDatabase(running.id, running.projectId, db)) as AnalysisRun;
    const message = error instanceof Error ? error.message : "Deterministic analysis failed";
    return (markRunStatus(db, running.projectId, running.id, { status: "failed", leaseToken: null, expectedLeaseToken: leaseToken, errorCode: "ANALYSIS_FAILED", errorMessage: message }) ?? getRunWithDatabase(running.id, running.projectId, db)) as AnalysisRun;
  }
}

export function executeAnalysis(projectId: string, runId: string, input: ExecuteAnalysisInput = {}, database?: DatabaseSync) {
  return executeAnalysisRun(projectId, runId, input, database);
}

export const executeSceneAnalysis = executeAnalysis;

export function retryAnalysisRun(projectId: string, runId: string, input: ExecuteAnalysisInput = {}, database?: DatabaseSync) {
  const db = resolveDatabase(database);
  const run = getAnalysisRun(runId, projectId, db);
  if (!run) throw new StoryBibleNotFoundError("Analysis run not found");
  if (run.status === "succeeded") return run;
  if (run.status === "stale") throw new StoryBibleValidationError("Stale analysis runs cannot be retried; enqueue the current scene revision", ["runId"]);
  return executeAnalysisRun(projectId, runId, input, db);
}

export function createAnalysisRepository(database: DatabaseSync = getDatabase()) {
  return {
    getAnalysisRun: (runId: string, projectId: string) => getAnalysisRun(runId, projectId, database),
    listAnalysisRuns: (projectId: string, options?: { sceneId?: string; sceneRevisionId?: string; status?: AnalysisRun["status"] }) => listAnalysisRuns(projectId, options, database),
    enqueueAnalysis: (projectId: string, input: EnqueueAnalysisInput) => enqueueAnalysis(projectId, input, database),
    enqueueAnalysisRun: (projectId: string, input: EnqueueAnalysisInput) => enqueueAnalysisRun(projectId, input, database),
    executeAnalysisRun: (projectId: string, runId: string, input?: ExecuteAnalysisInput) => executeAnalysisRun(projectId, runId, input ?? {}, database),
    executeAnalysis: (projectId: string, runId: string, input?: ExecuteAnalysisInput) => executeAnalysisRun(projectId, runId, input ?? {}, database),
    retryAnalysisRun: (projectId: string, runId: string, input?: ExecuteAnalysisInput) => retryAnalysisRun(projectId, runId, input ?? {}, database),
  };
}
