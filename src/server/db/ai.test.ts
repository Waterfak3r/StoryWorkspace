import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "./connection";
import { createAiGeneration, acceptAiGeneration, createChapter, createNarrativeRepository, getAiGeneration, listChapterVersions } from "./narrative";
import { AiGenerationAlreadyAcceptedError, ChapterEditConflictError, NarrativeNotFoundError } from "./narrative-errors";

const handles: Array<{ database: DatabaseSync; directory: string }> = [];

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "story-ai-"));
  const database = createDatabase(join(directory, "story.db"));
  handles.push({ database, directory });
  const projectId = randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO projects (id, title, premise, genre, status, created_at, updated_at) VALUES (:id, :title, '', '', 'active', :createdAt, :updatedAt)")
    .run({ id: projectId, title: "AI project", createdAt: timestamp, updatedAt: timestamp });
  const repository = createNarrativeRepository(database);
  const chapter = createChapter(projectId, { title: "Chapter", body: "Before" }, database)!;
  return { database, projectId, chapter, repository };
}

function generation(projectId: string, chapterId: string, database: DatabaseSync) {
  return createAiGeneration({
    projectId,
    targetChapterId: chapterId,
    action: "rewrite",
    instruction: "Tighten the scene",
    contextReferenceIds: [],
    generatedMarkdown: "After",
  }, database);
}

afterEach(() => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (!handle) continue;
    handle.database.close();
    rmSync(handle.directory, { recursive: true, force: true });
  }
});

describe("AI generation persistence", () => {
  it("accepts once and preserves exact AI provenance and generation link", () => {
    const { database, projectId, chapter } = setup();
    const record = generation(projectId, chapter.id, database);
    const accepted = acceptAiGeneration(chapter.id, {
      generationId: record.id,
      body: "After with provenance",
      baseUpdatedAt: chapter.updatedAt,
    }, database);

    expect(accepted.chapter.body).toBe("After with provenance");
    expect(accepted.version).toMatchObject({
      chapterId: chapter.id,
      body: "After with provenance",
      source: "ai",
      aiAction: "rewrite",
      instruction: "Tighten the scene",
      contextReferenceIds: [],
    });
    expect(accepted.generation.acceptedVersionId).toBe(accepted.version.id);
    expect(getAiGeneration(record.id, database)?.acceptedVersionId).toBe(accepted.version.id);
  });

  it("rejects duplicate acceptance without creating another version", () => {
    const { database, projectId, chapter } = setup();
    const record = generation(projectId, chapter.id, database);
    const accepted = acceptAiGeneration(chapter.id, { generationId: record.id, body: "After", baseUpdatedAt: chapter.updatedAt }, database);
    expect(() => acceptAiGeneration(chapter.id, { generationId: record.id, body: "Again", baseUpdatedAt: accepted.chapter.updatedAt }, database)).toThrow(AiGenerationAlreadyAcceptedError);
    expect(listChapterVersions(chapter.id, database)).toHaveLength(1);
  });

  it("rejects stale acceptance and leaves chapter, version, and generation untouched", () => {
    const { database, projectId, chapter } = setup();
    const record = generation(projectId, chapter.id, database);
    const repository = createNarrativeRepository(database);
    const current = repository.updateChapter(chapter.id, { baseUpdatedAt: chapter.updatedAt, body: "External" })!;

    expect(() => acceptAiGeneration(chapter.id, { generationId: record.id, body: "AI", baseUpdatedAt: chapter.updatedAt }, database)).toThrow(ChapterEditConflictError);
    expect(repository.getChapter(chapter.id)?.body).toBe("External");
    expect(listChapterVersions(chapter.id, database)).toHaveLength(0);
    expect(getAiGeneration(record.id, database)?.acceptedVersionId).toBeNull();
    expect(current.updatedAt).not.toBe(chapter.updatedAt);
  });

  it("hides a generation belonging to another chapter and rolls back an insert failure", () => {
    const first = setup();
    const secondChapter = first.repository.createChapter(first.projectId, { title: "Second", body: "Second" });
    const record = generation(first.projectId, first.chapter.id, first.database);
    expect(() => acceptAiGeneration(secondChapter.id, { generationId: record.id, body: "No", baseUpdatedAt: secondChapter.updatedAt }, first.database)).toThrow(NarrativeNotFoundError);

    first.database.exec("CREATE TRIGGER fail_ai_version BEFORE INSERT ON chapter_versions WHEN NEW.source = 'ai' BEGIN SELECT RAISE(ABORT, 'forced AI failure'); END");
    expect(() => acceptAiGeneration(first.chapter.id, { generationId: record.id, body: "No commit", baseUpdatedAt: first.chapter.updatedAt }, first.database)).toThrow(/forced AI failure/);
    expect(first.repository.getChapter(first.chapter.id)?.body).toBe("Before");
    expect(listChapterVersions(first.chapter.id, first.database)).toHaveLength(0);
    expect(getAiGeneration(record.id, first.database)?.acceptedVersionId).toBeNull();
  });
});
