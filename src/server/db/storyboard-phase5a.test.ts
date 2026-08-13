import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./connection";
import { bootstrapDatabase, CURRENT_SCHEMA_VERSION } from "./schema";
import { createDocument, createDocumentRevision, getDocumentRevision } from "./document";
import { createEntity } from "./story-bible";
import { buildContextSnapshot } from "./context-builder";
import { approveStoryboard, createStoryboard, getStoryboard, listStoryboards } from "./storyboard";
import { StoryBibleConflictError, StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";

type Handle = { database: DatabaseSync; directory: string };
const handles: Handle[] = [];

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "story-phase5a-"));
  const database = createDatabase(join(directory, "story.db"));
  handles.push({ database, directory });
  return database;
}

function insertProject(database: DatabaseSync, title = "Phase 5A") {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database.prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :createdAt)").run({ id, title, createdAt });
  return id;
}

function confirmLink(database: DatabaseSync, values: { projectId: string; sceneId: string; sceneRevisionId: string; entityId: string; entityType: "character" | "location" | "prop" }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const role = values.entityType === "character" ? "appears" : values.entityType === "location" ? "located_at" : "used";
  database.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, :entityType, :role, 'confirmed', 'user', 1, 1, :candidateGroupId, :fingerprint, NULL, :createdAt, :createdAt)").run({ id, ...values, role, candidateGroupId: randomUUID(), fingerprint: `phase5a:${id}`, createdAt });
}

function fixture(database: DatabaseSync) {
  const projectId = insertProject(database);
  const character = createEntity(projectId, { type: "character", canonicalName: "Lin" }, database);
  const location = createEntity(projectId, { type: "location", canonicalName: "Hall" }, database);
  const prop = createEntity(projectId, { type: "prop", canonicalName: "Key" }, database);
  const document = createDocument(projectId, { title: "Script", requestId: "phase5a-document", scenes: [{ title: "Entry", content: "Lin enters the hall holding a key." }] }, database);
  const revision = getDocumentRevision(document.currentRevisionId as string, projectId, database);
  if (!revision) throw new Error("document revision missing");
  const scene = revision.sceneRevisions[0];
  for (const entity of [character, location, prop] as const) {
    confirmLink(database, { projectId, sceneId: scene.sceneId, sceneRevisionId: scene.id, entityId: entity.id, entityType: entity.type as "character" | "location" | "prop" });
  }
  const snapshot = buildContextSnapshot(projectId, { sceneId: scene.sceneId, sceneRevisionId: scene.id, purpose: "storyboard", policyId: "storyboard-default-v1", requestId: "phase5a-context" }, database).snapshot;
  return { projectId, character, location, prop, document, scene, snapshot };
}

function shot(values: ReturnType<typeof fixture>, ordinal = 1) {
  return {
    ordinal,
    narrativePurpose: "Establish the guarded entrance",
    subjects: [{ entityId: values.character.id, action: "watches the door", expression: "alert", framingRole: "primary" as const }],
    locationEntityId: values.location.id,
    propEntityIds: [values.prop.id],
    framing: "medium shot",
    cameraMotion: "slow push-in",
    lens: "50mm",
    durationSeconds: 6,
    dialogueLineIds: [],
    continuityConstraints: ["keep the key in the right hand"],
    negativeConstraints: ["no wardrobe change"],
  };
}

afterEach(() => {
  vi.useRealTimers();
  while (handles.length > 0) {
    const handle = handles.pop();
    if (!handle) continue;
    handle.database.close();
    rmSync(handle.directory, { recursive: true, force: true });
  }
});

describe("Phase 5A Storyboard and ShotSpec", () => {
  it("creates ordered immutable shots and replays request and semantic duplicates", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const input = { contextSnapshotId: values.snapshot.id, title: "Door watch", shots: [shot(values, 2), { ...shot(values, 1), narrativePurpose: "Reveal the key" }], requestId: "board-one", actorId: "author" };
    const first = createStoryboard(values.projectId, values.scene.sceneId, input, database);
    expect(first.idempotent).toBe(false);
    expect(first.storyboard).toMatchObject({ status: "draft", version: 1, sceneRevisionId: values.scene.id, contextSnapshotId: values.snapshot.id, createdBy: "author" });
    expect(first.storyboard.shots.map((entry) => entry.spec.ordinal)).toEqual([1, 2]);
    expect(first.storyboard.shots.every((entry) => /^[a-f0-9]{64}$/.test(entry.specHash))).toBe(true);
    expect(createStoryboard(values.projectId, values.scene.sceneId, input, database)).toMatchObject({ idempotent: true, storyboard: { id: first.storyboard.id } });
    expect(createStoryboard(values.projectId, values.scene.sceneId, { ...input, requestId: "board-semantic" }, database)).toMatchObject({ idempotent: true, storyboard: { id: first.storyboard.id } });
    expect(() => createStoryboard(values.projectId, values.scene.sceneId, { ...input, title: "Changed", requestId: "board-one" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    expect(() => createStoryboard(values.projectId, values.scene.sceneId, { ...input, actorId: "another-author", requestId: "board-one" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    expect(listStoryboards(values.projectId, values.scene.sceneId, { status: "draft" }, database)).toHaveLength(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE project_id = :projectId AND event_type = 'storyboard.created'").get({ projectId: values.projectId })).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE project_id = :projectId AND event_type = 'storyboard.created'").get({ projectId: values.projectId })).toMatchObject({ count: 1 });
  });

  it("approves with CAS and atomically creates replacement history", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T08:00:00.000Z"));
    const database = isolatedDatabase();
    const values = fixture(database);
    const created = createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: values.snapshot.id, title: "First", shots: [shot(values)], requestId: "create-first" }, database).storyboard;
    const approved = approveStoryboard(values.projectId, created.id, { expectedVersion: 1, requestId: "approve-first" }, database);
    expect(approved).toMatchObject({ idempotent: false, storyboard: { status: "approved", version: 2 } });
    expect(approved.storyboard.updatedAt).toBe("2026-08-13T08:00:00.001Z");
    expect(approveStoryboard(values.projectId, created.id, { expectedVersion: 1, requestId: "approve-first" }, database)).toMatchObject({ idempotent: true, storyboard: { id: created.id } });
    expect(() => approveStoryboard(values.projectId, created.id, { expectedVersion: 1, requestId: "approve-first", actorId: "another-author" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    expect(() => approveStoryboard(values.projectId, created.id, { expectedVersion: 2, requestId: "approve-again" }, database)).toThrow(StoryBibleValidationError);

    const replacement = createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: values.snapshot.id, title: "Second", shots: [{ ...shot(values), narrativePurpose: "Revised purpose" }], supersedesStoryboardId: created.id, expectedSupersededVersion: 2, requestId: "replace-first" }, database).storyboard;
    expect(replacement).toMatchObject({ status: "draft", version: 1, supersedesStoryboardId: created.id });
    expect(getStoryboard(created.id, values.projectId, database)).toMatchObject({ status: "superseded", version: 3, title: "First", updatedAt: "2026-08-13T08:00:00.002Z" });
    expect(() => createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: values.snapshot.id, title: "Stale replacement", shots: [shot(values)], supersedesStoryboardId: created.id, expectedSupersededVersion: 2, requestId: "replace-stale" }, database)).toThrow(StoryBibleConflictError);
    const recreated = createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: values.snapshot.id, title: "First", shots: [shot(values)], requestId: "recreate-superseded" }, database);
    expect(recreated).toMatchObject({ idempotent: false, storyboard: { status: "draft" } });
    expect(recreated.storyboard.id).not.toBe(created.id);
    expect(database.prepare("SELECT COUNT(*) AS count FROM storyboards WHERE project_id = :projectId").get({ projectId: values.projectId })).toMatchObject({ count: 3 });
  });

  it("rejects foreign, wrong-purpose, missing, and type-mismatched Snapshot entities", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const otherProjectId = insertProject(database, "Other");
    expect(() => createStoryboard(otherProjectId, values.scene.sceneId, { contextSnapshotId: values.snapshot.id, title: "Foreign", shots: [shot(values)], requestId: "foreign" }, database)).toThrow(StoryBibleNotFoundError);
    const video = buildContextSnapshot(values.projectId, { sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, purpose: "video", policyId: "video-default-v1", requestId: "video-context" }, database).snapshot;
    expect(() => createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: video.id, title: "Wrong purpose", shots: [shot(values)], requestId: "wrong-purpose" }, database)).toThrow(StoryBibleValidationError);
    const absent = createEntity(values.projectId, { type: "character", canonicalName: "Absent" }, database);
    expect(() => createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: values.snapshot.id, title: "Absent", shots: [{ ...shot(values), subjects: [{ entityId: absent.id, action: "appears", framingRole: "primary" }] }], requestId: "absent" }, database)).toThrow(StoryBibleValidationError);
    expect(() => createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: values.snapshot.id, title: "Wrong type", shots: [{ ...shot(values), subjects: [{ entityId: values.location.id, action: "moves", framingRole: "primary" }] }], requestId: "wrong-type" }, database)).toThrow(StoryBibleValidationError);
  });

  it("preserves frozen inputs after later Scene revisions and enforces SQL immutability guards", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    createDocumentRevision(values.document.id, { baseVersion: values.document.version, requestId: "later-revision", scenes: [{ id: values.scene.sceneId, title: "Entry changed", content: "The scene changes later." }] }, database);
    const board = createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: values.snapshot.id, title: "Frozen", shots: [shot(values)], requestId: "frozen-board" }, database).storyboard;
    expect(board.sceneRevisionId).toBe(values.scene.id);
    expect(() => database.prepare("UPDATE storyboards SET title = 'mutated' WHERE id = :id").run({ id: board.id })).toThrow();
    expect(() => database.prepare("UPDATE storyboards SET sealed = 0 WHERE id = :id").run({ id: board.id })).toThrow();
    expect(() => database.prepare("UPDATE shot_specs SET spec_json = '{}' WHERE storyboard_id = :id").run({ id: board.id })).toThrow();
    expect(() => database.prepare("DELETE FROM shot_specs WHERE storyboard_id = :id").run({ id: board.id })).toThrow();
    expect(() => database.prepare("INSERT INTO shot_specs (id, project_id, storyboard_id, scene_id, ordinal, spec_json, spec_hash, created_at) VALUES (:id, :projectId, :storyboardId, :sceneId, 2, :specJson, :specHash, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, storyboardId: board.id, sceneId: values.scene.sceneId, specJson: JSON.stringify({ ...shot(values, 2) }), specHash: "c".repeat(64), createdAt: new Date().toISOString() })).toThrow();
    expect(() => database.prepare("INSERT INTO storyboards (id, project_id, scene_id, scene_revision_id, context_snapshot_id, title, status, version, sealed, supersedes_storyboard_id, content_hash, created_by, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :contextSnapshotId, 'Forged', 'approved', 1, 1, NULL, :contentHash, 'sql', :createdAt, :createdAt)").run({ id: randomUUID(), projectId: values.projectId, sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, contextSnapshotId: values.snapshot.id, contentHash: "a".repeat(64), createdAt: new Date().toISOString() })).toThrow();
  });

  it("upgrades an existing v14 file additively", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    database.exec("DROP TABLE shot_specs; DROP TABLE storyboards; PRAGMA user_version = 14;");
    bootstrapDatabase(database);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'storyboards'").get()).toMatchObject({ name: "storyboards" });
    expect(database.prepare("SELECT name FROM pragma_table_info('storyboards') WHERE name = 'sealed'").get()).toMatchObject({ name: "sealed" });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'storyboards_seal_guard'").get()).toMatchObject({ name: "storyboards_seal_guard" });
    expect(database.prepare("SELECT title FROM projects WHERE id = :projectId").get({ projectId })).toMatchObject({ title: "Phase 5A" });
  });
});
