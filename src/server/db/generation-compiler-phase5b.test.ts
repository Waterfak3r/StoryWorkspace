import { afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "./connection";
import { bootstrapDatabase, CURRENT_SCHEMA_VERSION } from "./schema";
import { createDocument, getDocumentRevision } from "./document";
import { createEntity } from "./story-bible";
import { buildContextSnapshot } from "./context-builder";
import { canonicalContextJson } from "@/domain/context-builder";
import { approveStoryboard, createStoryboard } from "./storyboard";
import { createReferenceAsset } from "./reference-assets";
import { compileShot, getCompiledGenerationRequest } from "./generation-compiler";
import { StoryBibleIdempotencyConflictError, StoryBibleNotFoundError, StoryBibleValidationError } from "./story-bible-errors";

type Handle = { database: DatabaseSync; directory: string };
const handles: Handle[] = [];

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "story-phase5b-"));
  const database = createDatabase(join(directory, "story.db"));
  handles.push({ database, directory });
  return database;
}

function insertProject(database: DatabaseSync, title = "Phase 5B") {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  database.prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :createdAt)").run({ id, title, createdAt });
  return id;
}

function confirmLink(database: DatabaseSync, values: { projectId: string; sceneId: string; sceneRevisionId: string; entityId: string; entityType: "character" | "location" | "prop" }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const role = values.entityType === "character" ? "appears" : values.entityType === "location" ? "located_at" : "used";
  database.prepare("INSERT INTO scene_entity_links (id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, status, resolver, confidence, version, candidate_group_id, fingerprint, analysis_run_id, created_at, updated_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, :entityId, :entityType, :role, 'confirmed', 'user', 1, 1, :candidateGroupId, :fingerprint, NULL, :createdAt, :createdAt)").run({ id, ...values, role, candidateGroupId: randomUUID(), fingerprint: `phase5b:${id}`, createdAt });
}

function fixture(database: DatabaseSync, sceneText = "Lin enters the hall holding a key.", approveBoard = true) {
  const projectId = insertProject(database);
  const character = createEntity(projectId, { type: "character", canonicalName: "Lin" }, database);
  const secondary = createEntity(projectId, { type: "character", canonicalName: "Bo" }, database);
  const location = createEntity(projectId, { type: "location", canonicalName: "Hall" }, database);
  const prop = createEntity(projectId, { type: "prop", canonicalName: "Key" }, database);
  const document = createDocument(projectId, { title: "Script", requestId: "phase5b-document", scenes: [{ title: "Entry", content: sceneText }] }, database);
  const revision = getDocumentRevision(document.currentRevisionId as string, projectId, database);
  if (!revision) throw new Error("document revision missing");
  const scene = revision.sceneRevisions[0];
  for (const entity of [character, secondary, location, prop] as const) confirmLink(database, { projectId, sceneId: scene.sceneId, sceneRevisionId: scene.id, entityId: entity.id, entityType: entity.type as "character" | "location" | "prop" });
  const snapshot = buildContextSnapshot(projectId, { sceneId: scene.sceneId, sceneRevisionId: scene.id, purpose: "storyboard", policyId: "storyboard-default-v1", requestId: "phase5b-context" }, database).snapshot;
  const shot = {
    ordinal: 1,
    narrativePurpose: "Guarded entrance",
    subjects: [
      { entityId: character.id, action: "watches the door", expression: "alert", framingRole: "primary" as const },
      { entityId: secondary.id, action: "waits behind Lin", expression: null, framingRole: "secondary" as const },
    ],
    locationEntityId: location.id,
    propEntityIds: [prop.id],
    framing: "medium shot",
    cameraMotion: "slow push-in",
    lens: "50mm",
    durationSeconds: 6,
    dialogueLineIds: [],
    continuityConstraints: ["keep the key in the right hand"],
    negativeConstraints: ["no wardrobe change"],
  };
  const board = createStoryboard(projectId, scene.sceneId, { contextSnapshotId: snapshot.id, title: "Door watch", shots: [shot], requestId: "phase5b-board" }, database).storyboard;
  const approved = approveBoard ? approveStoryboard(projectId, board.id, { expectedVersion: 1, requestId: "phase5b-approve" }, database).storyboard : board;
  const assets = {
    character: createReferenceAsset(projectId, { entityId: character.id, label: "Lin identity", requestId: "phase5b-asset-character" }, database).referenceAsset,
    location: createReferenceAsset(projectId, { entityId: location.id, label: "Hall reference", requestId: "phase5b-asset-location" }, database).referenceAsset,
    prop: createReferenceAsset(projectId, { entityId: prop.id, label: "Key reference", requestId: "phase5b-asset-prop" }, database).referenceAsset,
  };
  return { projectId, character, secondary, location, prop, scene, snapshot, board: approved, shotId: approved.shots[0].id, assets };
}

afterEach(() => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (!handle) continue;
    handle.database.close();
    rmSync(handle.directory, { recursive: true, force: true });
  }
});

describe("Phase 5B reference assets and compiler", () => {
  it("migrates v15 files additively and creates approved immutable metadata", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    database.exec("DROP TRIGGER compiled_generation_requests_delete_guard; DROP TRIGGER compiled_generation_requests_immutable_guard; DROP TRIGGER compiled_generation_requests_project_guard; DROP TRIGGER reference_assets_delete_guard; DROP TRIGGER reference_assets_immutable_guard; DROP TRIGGER reference_assets_project_guard; DROP INDEX idx_compiled_generation_requests_project_hash; DROP INDEX idx_compiled_generation_requests_project_shot; DROP TABLE compiled_generation_requests; DROP INDEX idx_reference_assets_project_entity; DROP TABLE reference_assets; PRAGMA user_version = 15;");
    bootstrapDatabase(database);
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reference_assets'").get()).toMatchObject({ name: "reference_assets" });
    expect(database.prepare("SELECT title FROM projects WHERE id = :projectId").get({ projectId })).toMatchObject({ title: "Phase 5B" });
  });

  it("ranks references, falls back parameters, persists a deterministic preview, and replays semantically", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const first = compileShot(values.projectId, values.shotId, { referenceAssetIds: [values.assets.prop.id, values.assets.character.id, values.assets.location.id], parameters: { durationSeconds: 5, aspectRatio: "4:3" }, requestId: "compile-first" }, database);
    expect(first.idempotent).toBe(false);
    expect(first.compiledRequest.assetInputs.map((asset) => asset.assetId)).toEqual([values.assets.character.id, values.assets.location.id]);
    expect(first.compiledRequest.assetInputs.map((asset) => asset.purpose)).toEqual(["character", "location"]);
    expect(first.compiledRequest.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("at most 2"),
      expect.stringContaining("Duration 5s"),
      expect.stringContaining("Aspect ratio 4:3"),
    ]));
    expect(first.preview.endpoint).toBe("fake://video/generate");
    expect(first.preview.body.referenceAssetIds).toEqual([values.assets.character.id, values.assets.location.id]);
    expect(first.compiledRequest.promptSegments.map((part) => part.role)).toContain("character");
    expect(first.compiledRequest.promptSegments.map((part) => part.text).join("\n").length).toBeLessThanOrEqual(4_000);
    const durationFive = compileShot(values.projectId, values.shotId, { parameters: { durationSeconds: 5 }, requestId: "compile-duration-five" }, database);
    const durationSix = compileShot(values.projectId, values.shotId, { parameters: { durationSeconds: 6 }, requestId: "compile-duration-six" }, database);
    expect(durationFive.compiledRequest.id).not.toBe(durationSix.compiledRequest.id);
    expect(durationFive.compiledRequest.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Duration 5s")]));
    expect(durationSix.compiledRequest.warnings).not.toEqual(expect.arrayContaining([expect.stringContaining("Duration 5s")]));
    const replay = compileShot(values.projectId, values.shotId, { referenceAssetIds: [values.assets.location.id, values.assets.prop.id, values.assets.character.id], parameters: { durationSeconds: 5, aspectRatio: "4:3" }, requestId: "compile-semantic" }, database);
    expect(replay.idempotent).toBe(true);
    expect(replay.compiledRequest.id).toBe(first.compiledRequest.id);
    expect(replay.compiledRequest.compiledHash).toBe(first.compiledRequest.compiledHash);
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE project_id = :projectId AND event_type = 'shot.compiled'").get({ projectId: values.projectId })).toMatchObject({ count: 3 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE project_id = :projectId AND event_type = 'shot.compiled'").get({ projectId: values.projectId })).toMatchObject({ count: 3 });

    const forgedId = randomUUID();
    const forgedCompiled = JSON.parse(JSON.stringify(first.compiledRequest)) as Record<string, unknown> & { assetInputs: Array<Record<string, unknown>> };
    forgedCompiled.id = forgedId;
    forgedCompiled.inputHash = "a".repeat(64);
    forgedCompiled.compiledHash = "b".repeat(64);
    forgedCompiled.createdAt = new Date().toISOString();
    forgedCompiled.assetInputs = [...first.compiledRequest.assetInputs, { assetId: values.assets.prop.id, entityId: values.prop.id, purpose: "prop", weight: 0.8 }];
    const forgedPrepared = JSON.parse(JSON.stringify(first.preview)) as { body: { referenceAssetIds: string[] } };
    forgedPrepared.body.referenceAssetIds = [...forgedPrepared.body.referenceAssetIds, values.assets.prop.id];
    expect(() => database.prepare("INSERT INTO compiled_generation_requests (id, project_id, scene_id, shot_spec_id, context_snapshot_id, provider, model, capability_profile_id, capability_profile_version, compiler_version, compiled_json, prepared_json, input_hash, compiled_hash, created_at) VALUES (:id, :projectId, :sceneId, :shotSpecId, :contextSnapshotId, :provider, :model, :capabilityProfileId, :capabilityProfileVersion, :compilerVersion, :compiledJson, :preparedJson, :inputHash, :compiledHash, :createdAt)").run({ id: forgedId, projectId: values.projectId, sceneId: values.scene.sceneId, shotSpecId: values.shotId, contextSnapshotId: values.snapshot.id, provider: "fake-video", model: "fake-video-model-v1", capabilityProfileId: "fake-video-v1", capabilityProfileVersion: "1", compilerVersion: "fake-video-compiler-v1", compiledJson: JSON.stringify(forgedCompiled), preparedJson: JSON.stringify(forgedPrepared), inputHash: "a".repeat(64), compiledHash: "b".repeat(64), createdAt: forgedCompiled.createdAt as string })).toThrow();
  });

  it("replays identical reference metadata and rejects request-id collisions", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const first = createReferenceAsset(values.projectId, { entityId: values.character.id, label: "Lin identity", requestId: "asset-replay" }, database);
    expect(first.idempotent).toBe(true);
    expect(first.referenceAsset.id).toBe(values.assets.character.id);
    expect(createReferenceAsset(values.projectId, { entityId: values.character.id, label: "Lin identity", requestId: "asset-semantic" }, database)).toMatchObject({ idempotent: true, referenceAsset: { id: values.assets.character.id } });
    expect(() => createReferenceAsset(values.projectId, { entityId: values.character.id, label: "Different metadata", requestId: "asset-replay" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE project_id = :projectId AND event_type = 'reference_asset.created'").get({ projectId: values.projectId })).toMatchObject({ count: 3 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE project_id = :projectId AND event_type = 'reference_asset.created'").get({ projectId: values.projectId })).toMatchObject({ count: 3 });
  });

  it("supports text-only input and rejects blocking, unrelated, foreign, and colliding requests", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const textOnly = compileShot(values.projectId, values.shotId, { requestId: "compile-text-only" }, database);
    expect(textOnly.compiledRequest.assetInputs).toEqual([]);
    expect(textOnly.compiledRequest.warnings).toContain("No approved reference assets selected; compiling text-only input.");
    const otherProject = insertProject(database, "Other");
    const foreignEntity = createEntity(otherProject, { type: "character", canonicalName: "Foreign" }, database);
    const foreignAsset = createReferenceAsset(otherProject, { entityId: foreignEntity.id, label: "foreign", requestId: "foreign-asset" }, database).referenceAsset;
    expect(() => compileShot(values.projectId, values.shotId, { referenceAssetIds: [foreignAsset.id], requestId: "foreign-compile" }, database)).toThrow(StoryBibleNotFoundError);
    const unrelatedEntity = createEntity(values.projectId, { type: "character", canonicalName: "Unrelated" }, database);
    const unrelatedAsset = createReferenceAsset(values.projectId, { entityId: unrelatedEntity.id, label: "unrelated", requestId: "unrelated-asset" }, database).referenceAsset;
    expect(() => compileShot(values.projectId, values.shotId, { referenceAssetIds: [unrelatedAsset.id], requestId: "unrelated-compile" }, database)).toThrow(StoryBibleValidationError);
    expect(() => compileShot(values.projectId, values.shotId, { requestId: "compile-text-only" , actorId: "changed" }, database)).toThrow(StoryBibleIdempotencyConflictError);
    expect(() => database.prepare("UPDATE compiled_generation_requests SET compiled_hash = :hash WHERE project_id = :projectId").run({ hash: "f".repeat(64), projectId: values.projectId })).toThrow();
    const got = getCompiledGenerationRequest(textOnly.compiledRequest.id, values.projectId, database);
    expect(got?.preview.requestHash).toBe(textOnly.preview.requestHash);

    const forgedId = randomUUID();
    const forgedCompiled = { ...textOnly.compiledRequest, id: forgedId, inputHash: "1".repeat(64), compiledHash: "2".repeat(64), createdAt: new Date().toISOString() };
    const forgedPreview = { ...textOnly.preview, requestHash: "3".repeat(64) };
    database.prepare("INSERT INTO compiled_generation_requests (id, project_id, scene_id, shot_spec_id, context_snapshot_id, provider, model, capability_profile_id, capability_profile_version, compiler_version, compiled_json, prepared_json, input_hash, compiled_hash, created_at) VALUES (:id, :projectId, :sceneId, :shotSpecId, :contextSnapshotId, :provider, :model, :capabilityProfileId, :capabilityProfileVersion, :compilerVersion, :compiledJson, :preparedJson, :inputHash, :compiledHash, :createdAt)").run({ id: forgedId, projectId: values.projectId, sceneId: values.scene.sceneId, shotSpecId: values.shotId, contextSnapshotId: values.snapshot.id, provider: forgedCompiled.provider, model: forgedCompiled.model, capabilityProfileId: forgedCompiled.capabilityProfileId, capabilityProfileVersion: forgedCompiled.capabilityProfileVersion, compilerVersion: forgedCompiled.compilerVersion, compiledJson: JSON.stringify(forgedCompiled), preparedJson: JSON.stringify(forgedPreview), inputHash: forgedCompiled.inputHash, compiledHash: forgedCompiled.compiledHash, createdAt: forgedCompiled.createdAt });
    expect(() => getCompiledGenerationRequest(forgedId, values.projectId, database)).toThrow(/hash mismatch/i);
  });

  it("requires an approved sealed board and an active scene", () => {
    const draftDatabase = isolatedDatabase();
    const draft = fixture(draftDatabase, "Lin enters the hall holding a key.", false);
    expect(() => compileShot(draft.projectId, draft.shotId, { requestId: "compile-draft" }, draftDatabase)).toThrow(StoryBibleValidationError);

    const deletedDatabase = isolatedDatabase();
    const deleted = fixture(deletedDatabase);
    deletedDatabase.prepare("UPDATE scenes SET status = 'deleted', deleted_at = :deletedAt WHERE id = :sceneId AND project_id = :projectId").run({ deletedAt: new Date().toISOString(), sceneId: deleted.scene.sceneId, projectId: deleted.projectId });
    expect(() => compileShot(deleted.projectId, deleted.shotId, { requestId: "compile-deleted" }, deletedDatabase)).toThrow(StoryBibleValidationError);
  });

  it("blocks compilation when the frozen Context Snapshot reports a blocking issue", () => {
    const database = isolatedDatabase();
    const values = fixture(database);
    const blockingId = randomUUID();
    const blockingContent = {
      ...values.snapshot.content,
      missing: [...values.snapshot.content.missing, { code: "test.blocking", severity: "blocking" as const, message: "blocking test issue" }],
      hasBlockingIssues: true,
    };
    const contentJson = canonicalContextJson(blockingContent);
    const contentHash = createHash("sha256").update(contentJson).digest("hex");
    database.prepare("INSERT INTO context_snapshots (id, project_id, scene_id, scene_revision_id, purpose, policy_id, policy_version, input_hash, content_json, content_hash, is_latest, created_at) VALUES (:id, :projectId, :sceneId, :sceneRevisionId, 'storyboard', 'storyboard-default-v1', '1', :inputHash, :contentJson, :contentHash, 0, :createdAt)").run({ id: blockingId, projectId: values.projectId, sceneId: values.scene.sceneId, sceneRevisionId: values.scene.id, inputHash: "e".repeat(64), contentJson, contentHash, createdAt: new Date().toISOString() });
    const blockingBoard = createStoryboard(values.projectId, values.scene.sceneId, { contextSnapshotId: blockingId, title: "Blocked board", shots: [values.board.shots[0].spec], requestId: "blocked-board" }, database).storyboard;
    const approved = approveStoryboard(values.projectId, blockingBoard.id, { expectedVersion: 1, requestId: "blocked-approve" }, database).storyboard;
    expect(approved.status).toBe("approved");
    expect(() => compileShot(values.projectId, approved.shots[0].id, { requestId: "blocked-compile" }, database)).toThrow(StoryBibleValidationError);
  });

  it("keeps Shot intent ahead of long raw Scene evidence and records clipping", () => {
    const database = isolatedDatabase();
    const values = fixture(database, `${"Raw scene evidence ".repeat(700)}Lin enters the hall holding a key.`);
    const result = compileShot(values.projectId, values.shotId, { requestId: "compile-long-scene" }, database);
    const prompt = result.preview.body.prompt;
    expect(prompt).toContain("Shot intent: Guarded entrance.");
    expect(prompt).toContain("watches the door");
    expect(result.compiledRequest.warnings).toContain("Prompt budget clipped scene context.");
    expect(result.compiledRequest.omittedContext).toContain(`prompt:scene:${values.scene.id}`);
    expect(prompt.length).toBeLessThanOrEqual(4_000);
  });
});
