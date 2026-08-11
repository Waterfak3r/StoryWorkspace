import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChapter, createNarrativeRepository } from "./narrative";
import { createDatabase } from "./connection";
import { bootstrapDatabase } from "./schema";
import { AdaptationEditConflictError, AiGenerationAlreadyConsumedError, ChapterEditConflictError, NarrativeDataIntegrityError, NarrativeNotFoundError, NarrativeValidationError } from "./narrative-errors";

const databaseHandles: Array<{ database: DatabaseSync; directory: string }> = [];

function isolatedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "story-narrative-"));
  const database = createDatabase(join(directory, "story.db"));
  databaseHandles.push({ database, directory });
  return database;
}

function insertProject(database: DatabaseSync, id = randomUUID()) {
  const timestamp = new Date().toISOString();
  database.prepare(
    "INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :updatedAt)",
  ).run({ id, title: `Project ${id.slice(0, 8)}`, createdAt: timestamp, updatedAt: timestamp });
  return id;
}

afterEach(() => {
  while (databaseHandles.length > 0) {
    const handle = databaseHandles.pop();
    if (!handle) {
      continue;
    }
    handle.database.close();
    rmSync(handle.directory, { recursive: true, force: true });
  }
});

describe("narrative database schema", () => {
  it("migrates a v1 database without losing projects", () => {
    const directory = mkdtempSync(join(tmpdir(), "story-narrative-migration-"));
    const database = new DatabaseSync(join(directory, "legacy.db"));
    const projectId = randomUUID();
    const timestamp = new Date().toISOString();

    database.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        premise TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at)
      VALUES ('${projectId}', 'Legacy project', '', '', 'active', '${timestamp}', '${timestamp}');
      PRAGMA user_version = 1;
    `);

    bootstrapDatabase(database);

    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(4);
    expect((database.prepare("SELECT title FROM projects WHERE id = :id").get({ id: projectId }) as { title: string }).title).toBe("Legacy project");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chapters'").get() as { name: string }).name).toBe("chapters");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_generations'").get() as { name: string }).name).toBe("ai_generations");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'adaptations'").get() as { name: string }).name).toBe("adaptations");

    expect(() => bootstrapDatabase(database)).not.toThrow();
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(4);

    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("migrates a v3 database to v4 without replacing existing records", () => {
    const directory = mkdtempSync(join(tmpdir(), "story-narrative-v3-migration-"));
    const database = new DatabaseSync(join(directory, "legacy.db"));
    bootstrapDatabase(database);
    const projectId = insertProject(database);
    database.exec("DROP TABLE adaptations; PRAGMA user_version = 3;");

    bootstrapDatabase(database);

    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(4);
    expect((database.prepare("SELECT title FROM projects WHERE id = :id").get({ id: projectId }) as { title: string }).title).toContain("Project");
    expect((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'adaptations'").get() as { name: string }).name).toBe("adaptations");
    expect(() => bootstrapDatabase(database)).not.toThrow();

    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails atomically when a malformed adaptations table already exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "story-narrative-v4-conflict-"));
    const database = new DatabaseSync(join(directory, "legacy.db"));
    bootstrapDatabase(database);
    database.exec("DROP TABLE adaptations; CREATE TABLE adaptations (id TEXT PRIMARY KEY NOT NULL); PRAGMA user_version = 3;");

    expect(() => bootstrapDatabase(database)).toThrow();
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(3);
    expect((database.prepare("PRAGMA table_info(adaptations)").all() as unknown[]).length).toBe(1);

    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("rolls back a failed v2 migration without changing the v1 project data", () => {
    const directory = mkdtempSync(join(tmpdir(), "story-narrative-migration-failure-"));
    const database = new DatabaseSync(join(directory, "legacy.db"));
    const projectId = randomUUID();
    const timestamp = new Date().toISOString();

    database.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        premise TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at)
      VALUES ('${projectId}', 'Legacy project', '', '', 'active', '${timestamp}', '${timestamp}');
      CREATE TABLE bible_entries (id TEXT PRIMARY KEY NOT NULL);
      PRAGMA user_version = 1;
    `);

    expect(() => bootstrapDatabase(database)).toThrow();
    expect((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
    expect((database.prepare("SELECT title FROM projects WHERE id = :id").get({ id: projectId }) as { title: string }).title).toBe("Legacy project");
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outline_nodes'").get()).toBeUndefined();

    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("narrative repository", () => {
  it("supports project-owned bible, outline, and chapter CRUD with deterministic ordering", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);

    const laterEntry = repository.createBibleEntry(projectId, {
      category: "character",
      title: "Later",
      body: "second",
      position: 1,
    });
    const firstEntry = repository.createBibleEntry(projectId, {
      category: "world",
      title: "First",
      body: "  markdown\n",
      position: 0,
    });
    expect(repository.listBibleEntries(projectId).map((entry) => entry.id)).toEqual([firstEntry.id, laterEntry.id]);
    expect(repository.getBibleEntry(firstEntry.id)?.body).toBe("  markdown\n");
    expect(repository.updateBibleEntry(firstEntry.id, { title: "Updated" })?.title).toBe("Updated");
    expect(repository.deleteBibleEntry(laterEntry.id)).toBe(true);

    const root = repository.createOutlineNode(projectId, { kind: "story", title: "Story" });
    const scene = repository.createOutlineNode(projectId, { parentId: root.id, kind: "scene", title: "Scene" });
    const chapter = repository.createChapter(projectId, { outlineNodeId: scene.id, title: "Chapter one", body: "Draft" });

    expect(repository.listOutlineNodes(projectId).map((node) => node.id)).toEqual([root.id, scene.id]);
    expect(repository.listChapters(projectId)).toEqual([chapter]);
    expect(repository.updateOutlineNode(scene.id, { summary: "A scene" })?.summary).toBe("A scene");
    expect(repository.updateChapter(chapter.id, { baseUpdatedAt: chapter.updatedAt, body: "Revised" })?.body).toBe("Revised");
  });

  it("rejects cross-project references and outline cycles", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectA = insertProject(database);
    const projectB = insertProject(database);
    const foreignParent = repository.createOutlineNode(projectB, { kind: "act", title: "Foreign" });
    const root = repository.createOutlineNode(projectA, { kind: "story", title: "Root" });
    const child = repository.createOutlineNode(projectA, { parentId: root.id, kind: "act", title: "Child" });

    expect(() => repository.createOutlineNode(projectA, { parentId: foreignParent.id, kind: "scene", title: "Invalid" })).toThrow(NarrativeValidationError);
    expect(() => repository.updateOutlineNode(root.id, { parentId: child.id })).toThrow(NarrativeValidationError);
    expect(() => repository.createChapter(projectA, { outlineNodeId: foreignParent.id, title: "Invalid" })).toThrow(NarrativeValidationError);
  });

  it("normalizes outline reorder positions and rejects duplicate or foreign IDs", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectA = insertProject(database);
    const projectB = insertProject(database);
    const first = repository.createOutlineNode(projectA, { kind: "act", title: "First" });
    const second = repository.createOutlineNode(projectA, { kind: "act", title: "Second" });
    const foreign = repository.createOutlineNode(projectB, { kind: "act", title: "Foreign" });

    expect(() => repository.reorderOutlineNodes(projectA, { orderedIds: [first.id, first.id] })).toThrow(NarrativeValidationError);
    expect(() => repository.reorderOutlineNodes(projectA, { orderedIds: [foreign.id] })).toThrow(NarrativeValidationError);
    expect(() => repository.reorderOutlineNodes(projectA, { orderedIds: [first.id] })).toThrow(NarrativeValidationError);

    const nodes = repository.reorderOutlineNodes(projectA, { orderedIds: [second.id, first.id] });
    expect(nodes.map((node) => [node.id, node.position])).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
  });

  it("sets linked chapter outline references to null without deleting prose", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);
    const outline = repository.createOutlineNode(projectId, { kind: "chapter", title: "Chapter node" });
    const chapter = repository.createChapter(projectId, { outlineNodeId: outline.id, title: "Prose", body: "Keep me" });

    expect(repository.deleteOutlineNode(outline.id)).toBe(true);
    expect(repository.getChapter(chapter.id)).toMatchObject({ id: chapter.id, outlineNodeId: null, body: "Keep me" });
  });

  it("rejects deleting an outline node with children", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);
    const root = repository.createOutlineNode(projectId, { kind: "story", title: "Root" });
    repository.createOutlineNode(projectId, { parentId: root.id, kind: "act", title: "Child" });

    expect(() => repository.deleteOutlineNode(root.id)).toThrow(NarrativeValidationError);
    expect(repository.getOutlineNode(root.id)).not.toBeNull();
  });

  it("uses strictly increasing chapter revision tokens and rejects stale updates", () => {
    const database = isolatedDatabase();
    const projectId = insertProject(database);
    const chapter = createChapter(projectId, { title: "Revision", body: "A" }, database);
    const first = createNarrativeRepository(database).updateChapter(chapter.id, { baseUpdatedAt: chapter.updatedAt, body: "B" });
    const second = createNarrativeRepository(database).updateChapter(chapter.id, { baseUpdatedAt: first!.updatedAt, body: "C" });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Date.parse(first!.updatedAt)).toBeGreaterThan(Date.parse(chapter.updatedAt));
    expect(Date.parse(second!.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt));
    expect(() => createNarrativeRepository(database).updateChapter(chapter.id, { baseUpdatedAt: first!.updatedAt, body: "stale" })).toThrow(ChapterEditConflictError);
  });

  it("snapshots the current body and restores it with a retained backup", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);
    const chapter = repository.createChapter(projectId, { title: "History", body: "Original" });
    const originalVersion = repository.createChapterVersion(chapter.id, {});
    if (!originalVersion) {
      throw new Error("Expected a manual chapter snapshot");
    }
    const changed = repository.updateChapter(chapter.id, { baseUpdatedAt: chapter.updatedAt, body: "Changed" });
    if (!changed) {
      throw new Error("Expected the chapter update to succeed");
    }

    const restored = repository.restoreChapterVersion(chapter.id, originalVersion.id, changed.updatedAt);
    if (!restored) {
      throw new Error("Expected the chapter restore to succeed");
    }
    expect(restored.chapter.body).toBe("Original");
    expect(restored.restoredVersion.id).toBe(originalVersion.id);
    expect(restored.backupVersion).toMatchObject({ source: "restore_backup", body: "Changed" });
    expect(repository.listChapterVersions(chapter.id).map((version) => version.source)).toContain("restore_backup");
    expect(() => repository.restoreChapterVersion(chapter.id, originalVersion.id, changed.updatedAt)).toThrow(ChapterEditConflictError);
  });

  it("round-trips AI version provenance through the internal repository", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);
    const chapter = repository.createChapter(projectId, { title: "AI history", body: "Draft" });
    const contextReferenceId = randomUUID();
    const version = repository.createChapterVersion(chapter.id, {
      source: "ai",
      aiAction: "rewrite",
      instruction: "Make the scene quieter",
      contextReferenceIds: [contextReferenceId],
    });

    expect(version).toMatchObject({
      source: "ai",
      aiAction: "rewrite",
      instruction: "Make the scene quieter",
      contextReferenceIds: [contextReferenceId],
    });
    expect(repository.getChapterVersion(chapter.id, version!.id)).toMatchObject({
      source: "ai",
      aiAction: "rewrite",
      instruction: "Make the scene quieter",
      contextReferenceIds: [contextReferenceId],
    });
  });

  it("fails loudly when stored context reference JSON is malformed", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);
    const chapter = repository.createChapter(projectId, { title: "Corrupt history", body: "Draft" });
    const version = repository.createChapterVersion(chapter.id, {});
    if (!version) {
      throw new Error("Expected a chapter version");
    }
    database.prepare("UPDATE chapter_versions SET context_reference_ids = :value WHERE id = :id").run({ id: version.id, value: "{not-json" });

    expect(() => repository.getChapterVersion(chapter.id, version.id)).toThrow(NarrativeDataIntegrityError);
    expect(() => repository.listChapterVersions(chapter.id)).toThrow(/context reference IDs/);
  });

  it("supports adaptation CRUD ordering and timestamp CAS", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);
    const later = repository.createAdaptation(projectId, { origin: "manual", format: "screenplay_scene", title: "Later", body: "Later body", position: 4 });
    const first = repository.createAdaptation(projectId, { origin: "manual", format: "screenplay_scene", title: "First", body: "  INT. ROOM\n", position: 1 });

    expect(repository.listAdaptations(projectId).map((adaptation) => adaptation.id)).toEqual([first.id, later.id]);
    expect(repository.getAdaptation(first.id)?.body).toBe("  INT. ROOM\n");
    const updated = repository.updateAdaptation(first.id, { baseUpdatedAt: first.updatedAt, body: "Updated" });
    expect(updated?.body).toBe("Updated");
    expect(() => repository.updateAdaptation(first.id, { baseUpdatedAt: first.updatedAt, body: "Stale" })).toThrow(AdaptationEditConflictError);

    expect(repository.deleteAdaptation(later.id)).toBe(true);
    expect(repository.deleteAdaptation(first.id)).toBe(true);
    expect(repository.listAdaptations(projectId)).toEqual([]);
  });

  it("persists trusted adapt provenance and enforces exactly-once consumption", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);
    const chapter = repository.createChapter(projectId, { title: "Target", body: "Draft" });
    const generation = repository.createAiGeneration({
      projectId,
      targetChapterId: chapter.id,
      action: "adapt",
      instruction: "Make a scene",
      contextReferenceIds: [],
      generatedMarkdown: "INT. STATION - DAY\n\nAction",
    });

    const adaptation = repository.createAdaptation(projectId, {
      origin: "ai",
      format: "screenplay_scene",
      title: "Reviewed scene",
      generationId: generation.id,
    });
    expect(adaptation).toMatchObject({ body: generation.generatedMarkdown, sourceGenerationId: generation.id });
    expect(() => repository.createAdaptation(projectId, {
      origin: "ai",
      format: "screenplay_scene",
      title: "Duplicate",
      generationId: generation.id,
    })).toThrow(AiGenerationAlreadyConsumedError);
    try {
      repository.createAdaptation(projectId, {
        origin: "ai",
        format: "screenplay_scene",
        title: "Duplicate details",
        generationId: generation.id,
      });
    } catch (error) {
      expect(error).toMatchObject({ consumedBy: "adaptation", currentAdaptation: { id: adaptation.id } });
    }
    expect(() => repository.acceptAiGeneration(chapter.id, {
      generationId: generation.id,
      body: "Should not be accepted",
      baseUpdatedAt: chapter.updatedAt,
    })).toThrow(AiGenerationAlreadyConsumedError);
    expect(repository.getAiGeneration(generation.id)?.acceptedVersionId).toBeNull();

    expect(repository.deleteAdaptation(adaptation.id)).toBe(true);
    const reusable = repository.createAdaptation(projectId, {
      origin: "ai",
      format: "screenplay_scene",
      title: "Reusable",
      generationId: generation.id,
    });
    expect(reusable.sourceGenerationId).toBe(generation.id);

    const chapterConsumedGeneration = repository.createAiGeneration({
      projectId,
      targetChapterId: chapter.id,
      action: "adapt",
      instruction: "Accept into chapter",
      contextReferenceIds: [],
      generatedMarkdown: "Chapter adaptation",
    });
    const accepted = repository.acceptAiGeneration(chapter.id, {
      generationId: chapterConsumedGeneration.id,
      body: "Accepted chapter body",
      baseUpdatedAt: chapter.updatedAt,
    });
    expect(accepted.generation.acceptedVersionId).toBe(accepted.version.id);
    expect(() => repository.createAdaptation(projectId, {
      origin: "ai",
      format: "screenplay_scene",
      title: "Already chapter accepted",
      generationId: chapterConsumedGeneration.id,
    })).toThrow(AiGenerationAlreadyConsumedError);
    try {
      repository.createAdaptation(projectId, {
        origin: "ai",
        format: "screenplay_scene",
        title: "Already chapter accepted details",
        generationId: chapterConsumedGeneration.id,
      });
    } catch (error) {
      expect(error).toMatchObject({ consumedBy: "chapter", currentAdaptation: null });
    }
  });

  it("rejects cross-project and non-adapt generations and rolls back failed AI creation", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectA = insertProject(database);
    const projectB = insertProject(database);
    const chapterA = repository.createChapter(projectA, { title: "A", body: "A" });
    const chapterB = repository.createChapter(projectB, { title: "B", body: "B" });
    const foreignGeneration = repository.createAiGeneration({ projectId: projectB, targetChapterId: chapterB.id, action: "adapt", instruction: "Adapt", contextReferenceIds: [], generatedMarkdown: "Foreign" });
    const wrongAction = repository.createAiGeneration({ projectId: projectA, targetChapterId: chapterA.id, action: "brainstorm", instruction: "Brainstorm", contextReferenceIds: [], generatedMarkdown: "Not an adaptation" });

    expect(() => repository.createAdaptation(projectA, { origin: "ai", format: "screenplay_scene", title: "Foreign", generationId: foreignGeneration.id })).toThrow(NarrativeNotFoundError);
    expect(() => repository.createAdaptation(projectA, { origin: "ai", format: "screenplay_scene", title: "Wrong action", generationId: wrongAction.id })).toThrow(NarrativeValidationError);

    database.exec("CREATE TRIGGER adaptation_insert_failure BEFORE INSERT ON adaptations BEGIN SELECT RAISE(ABORT, 'forced adaptation failure'); END;");
    expect(() => repository.createAdaptation(projectA, { origin: "ai", format: "screenplay_scene", title: "Rollback", generationId: repository.createAiGeneration({ projectId: projectA, targetChapterId: chapterA.id, action: "adapt", instruction: "Rollback", contextReferenceIds: [], generatedMarkdown: "Rollback body" }).id })).toThrow();
    database.exec("DROP TRIGGER adaptation_insert_failure;");
    expect(repository.listAdaptations(projectA)).toEqual([]);

    const rollbackGeneration = database.prepare("SELECT id, accepted_version_id FROM ai_generations WHERE project_id = :projectId AND instruction = 'Rollback'").get({ projectId: projectA }) as { id: string; accepted_version_id: string | null };
    expect(rollbackGeneration.accepted_version_id).toBeNull();
  });

  it("cascades adaptations with their project while leaving standalone generation policy explicit", () => {
    const database = isolatedDatabase();
    const repository = createNarrativeRepository(database);
    const projectId = insertProject(database);
    const adaptation = repository.createAdaptation(projectId, { origin: "manual", format: "screenplay_scene", title: "Owned", body: "Body" });
    database.prepare("DELETE FROM projects WHERE id = :id").run({ id: projectId });
    expect(repository.getAdaptation(adaptation.id)).toBeNull();
  });
});
