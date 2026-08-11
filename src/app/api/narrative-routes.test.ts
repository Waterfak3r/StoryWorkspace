import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let databaseDirectory = "";

vi.mock("@/server/ai/provider", () => {
  class MockAiProviderError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;

    constructor(code: string, message: string, status: number, retryable: boolean) {
      super(message);
      this.code = code;
      this.status = status;
      this.retryable = retryable;
    }
  }

  return {
    AiProviderError: MockAiProviderError,
    generateAiMarkdown: vi.fn().mockResolvedValue("Generated AI draft"),
  };
});

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("narrative API routes", () => {
  beforeEach(() => {
    databaseDirectory = mkdtempSync(join(tmpdir(), "story-narrative-api-"));
    process.env.STORY_WORKSPACE_DB_PATH = join(databaseDirectory, "story.db");
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/server/db/connection");
    closeDatabase();
    delete process.env.STORY_WORKSPACE_DB_PATH;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
    rmSync(databaseDirectory, { recursive: true, force: true });
  });

  it("returns a stable 404 envelope for a missing workspace", async () => {
    const { GET } = await import("./projects/[projectId]/workspace/route");
    const projectId = randomUUID();
    const response = await GET(
      new Request(`http://localhost/api/projects/${projectId}/workspace`),
      routeContext({ projectId }),
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toMatchObject({ code: "NOT_FOUND", retryable: false });
  });

  it("rejects forged AI provenance and reports stale chapter edits as conflicts", async () => {
    const { createProject } = await import("@/server/db/projects");
    const project = createProject({ title: "Route coverage" });
    const { POST: createChapterRoute } = await import("./projects/[projectId]/chapters/route");
    const chapterResponse = await createChapterRoute(
      jsonRequest("http://localhost/api/chapters", "POST", { title: "Chapter", body: "Original" }),
      routeContext({ projectId: project.id }),
    );
    const chapterPayload = await chapterResponse.json();
    const chapter = chapterPayload.data.chapter as { id: string; updatedAt: string };

    const { POST: createVersionRoute } = await import("./chapters/[chapterId]/versions/route");
    const forgedResponse = await createVersionRoute(
      jsonRequest("http://localhost/api/chapters/version", "POST", { source: "ai", aiAction: "rewrite" }),
      routeContext({ chapterId: chapter.id }),
    );
    expect(forgedResponse.status).toBe(400);
    expect((await forgedResponse.json()).error.code).toBe("VALIDATION_ERROR");

    const malformedResponse = await createVersionRoute(
      new Request("http://localhost/api/chapters/version", { method: "POST", body: "{not-json" }),
      routeContext({ chapterId: chapter.id }),
    );
    expect(malformedResponse.status).toBe(400);

    const { PATCH } = await import("./chapters/[chapterId]/route");
    const currentResponse = await PATCH(
      jsonRequest("http://localhost/api/chapters/chapter", "PATCH", { baseUpdatedAt: chapter.updatedAt, body: "Current" }),
      routeContext({ chapterId: chapter.id }),
    );
    expect(currentResponse.status).toBe(200);
    const current = (await currentResponse.json()).data.chapter as { updatedAt: string };

    const staleResponse = await PATCH(
      jsonRequest("http://localhost/api/chapters/chapter", "PATCH", { baseUpdatedAt: chapter.updatedAt, body: "Stale" }),
      routeContext({ chapterId: chapter.id }),
    );
    const stalePayload = await staleResponse.json();
    expect(staleResponse.status).toBe(409);
    expect(stalePayload.error).toMatchObject({ code: "EDIT_CONFLICT", retryable: false });
    expect(stalePayload.error.currentChapter.updatedAt).toBe(current.updatedAt);
  });

  it("rejects deleting an outline parent with children while preserving leaf chapter prose", async () => {
    const { createProject } = await import("@/server/db/projects");
    const project = createProject({ title: "Outline deletion" });
    const { POST: createOutlineRoute } = await import("./projects/[projectId]/outline/route");
    const parentResponse = await createOutlineRoute(
      jsonRequest("http://localhost/api/projects/outline", "POST", { kind: "story", title: "Parent" }),
      routeContext({ projectId: project.id }),
    );
    const parent = (await parentResponse.json()).data.node as { id: string };
    const childResponse = await createOutlineRoute(
      jsonRequest("http://localhost/api/projects/outline", "POST", { parentId: parent.id, kind: "act", title: "Child" }),
      routeContext({ projectId: project.id }),
    );
    const child = (await childResponse.json()).data.node as { id: string };

    const { DELETE } = await import("./outline/[nodeId]/route");
    const parentDeleteResponse = await DELETE(
      new Request(`http://localhost/api/outline/${parent.id}`, { method: "DELETE" }),
      routeContext({ nodeId: parent.id }),
    );
    expect(parentDeleteResponse.status).toBe(400);
    expect((await parentDeleteResponse.json()).error.code).toBe("VALIDATION_ERROR");

    const { POST: createChapterRoute } = await import("./projects/[projectId]/chapters/route");
    const chapterResponse = await createChapterRoute(
      jsonRequest("http://localhost/api/projects/chapters", "POST", { outlineNodeId: child.id, title: "Prose", body: "Keep this" }),
      routeContext({ projectId: project.id }),
    );
    const chapter = (await chapterResponse.json()).data.chapter as { id: string };
    const leafDeleteResponse = await DELETE(
      new Request(`http://localhost/api/outline/${child.id}`, { method: "DELETE" }),
      routeContext({ nodeId: child.id }),
    );
    expect(leafDeleteResponse.status).toBe(200);

    const { GET: getChapterRoute } = await import("./chapters/[chapterId]/route");
    const chapterReadResponse = await getChapterRoute(
      new Request(`http://localhost/api/chapters/${chapter.id}`),
      routeContext({ chapterId: chapter.id }),
    );
    expect((await chapterReadResponse.json()).data.chapter).toMatchObject({ body: "Keep this", outlineNodeId: null });
  });

  it("requires a complete outline reorder set and normalizes positions", async () => {
    const { createProject } = await import("@/server/db/projects");
    const project = createProject({ title: "Outline ordering" });
    const foreignProject = createProject({ title: "Foreign outline" });
    const { POST: createOutlineRoute } = await import("./projects/[projectId]/outline/route");
    const createNode = async (projectId: string, title: string) => {
      const response = await createOutlineRoute(
        jsonRequest("http://localhost/api/projects/outline", "POST", { kind: "act", title }),
        routeContext({ projectId }),
      );
      return (await response.json()).data.node as { id: string };
    };
    const first = await createNode(project.id, "First");
    const second = await createNode(project.id, "Second");
    const foreign = await createNode(foreignProject.id, "Foreign");
    const { PATCH } = await import("./projects/[projectId]/outline/order/route");
    const reorder = (orderedIds: string[]) => PATCH(
      jsonRequest("http://localhost/api/projects/outline/order", "PATCH", { orderedIds }),
      routeContext({ projectId: project.id }),
    );

    const duplicateResponse = await reorder([first.id, first.id]);
    expect(duplicateResponse.status).toBe(400);
    expect((await duplicateResponse.json()).error.code).toBe("VALIDATION_ERROR");

    const foreignResponse = await reorder([first.id, foreign.id]);
    expect(foreignResponse.status).toBe(400);
    expect((await foreignResponse.json()).error.code).toBe("VALIDATION_ERROR");

    const incompleteResponse = await reorder([first.id]);
    expect(incompleteResponse.status).toBe(400);
    expect((await incompleteResponse.json()).error.code).toBe("VALIDATION_ERROR");

    const successResponse = await reorder([second.id, first.id]);
    expect(successResponse.status).toBe(200);
    expect((await successResponse.json()).data.nodes.map((node: { id: string; position: number }) => [node.id, node.position])).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
  });

  it("restores a version, rejects stale bases, and returns 404 for unknown versions", async () => {
    const { createProject } = await import("@/server/db/projects");
    const project = createProject({ title: "Restore routes" });
    const { POST: createChapterRoute } = await import("./projects/[projectId]/chapters/route");
    const chapterResponse = await createChapterRoute(
      jsonRequest("http://localhost/api/projects/chapters", "POST", { title: "Chapter", body: "Original" }),
      routeContext({ projectId: project.id }),
    );
    const chapter = (await chapterResponse.json()).data.chapter as { id: string; updatedAt: string };
    const { POST: createVersionRoute } = await import("./chapters/[chapterId]/versions/route");
    const versionResponse = await createVersionRoute(
      jsonRequest("http://localhost/api/chapters/versions", "POST", {}),
      routeContext({ chapterId: chapter.id }),
    );
    const version = (await versionResponse.json()).data.version as { id: string };
    const { PATCH: patchChapterRoute } = await import("./chapters/[chapterId]/route");
    const changedResponse = await patchChapterRoute(
      jsonRequest("http://localhost/api/chapters/chapter", "PATCH", { baseUpdatedAt: chapter.updatedAt, body: "Changed" }),
      routeContext({ chapterId: chapter.id }),
    );
    const changed = (await changedResponse.json()).data.chapter as { updatedAt: string };
    const { POST: restoreRoute } = await import("./chapters/[chapterId]/restore/route");

    const restoredResponse = await restoreRoute(
      jsonRequest("http://localhost/api/chapters/restore", "POST", { versionId: version.id, baseUpdatedAt: changed.updatedAt }),
      routeContext({ chapterId: chapter.id }),
    );
    expect(restoredResponse.status).toBe(200);
    const restoredPayload = await restoredResponse.json();
    expect(restoredPayload.data.chapter.body).toBe("Original");
    expect(restoredPayload.data.backupVersion).toMatchObject({ source: "restore_backup", body: "Changed" });

    const staleResponse = await restoreRoute(
      jsonRequest("http://localhost/api/chapters/restore", "POST", { versionId: version.id, baseUpdatedAt: changed.updatedAt }),
      routeContext({ chapterId: chapter.id }),
    );
    expect(staleResponse.status).toBe(409);
    expect((await staleResponse.json()).error.code).toBe("EDIT_CONFLICT");

    const missingVersionResponse = await restoreRoute(
      jsonRequest("http://localhost/api/chapters/restore", "POST", { versionId: randomUUID(), baseUpdatedAt: restoredPayload.data.chapter.updatedAt }),
      routeContext({ chapterId: chapter.id }),
    );
    expect(missingVersionResponse.status).toBe(404);
    expect((await missingVersionResponse.json()).error.code).toBe("NOT_FOUND");
  });

  it("generates a persisted reviewable draft and accepts it exactly once", async () => {
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "test-model";
    const { createProject } = await import("@/server/db/projects");
    const project = createProject({ title: "AI route" });
    const { POST: createBibleRoute } = await import("./projects/[projectId]/bible/route");
    const bibleResponse = await createBibleRoute(
      jsonRequest("http://localhost/api/projects/bible", "POST", { category: "world", title: "Setting", body: "A quiet town" }),
      routeContext({ projectId: project.id }),
    );
    const bible = (await bibleResponse.json()).data.entry as { id: string };
    const { POST: createChapterRoute } = await import("./projects/[projectId]/chapters/route");
    const chapterResponse = await createChapterRoute(
      jsonRequest("http://localhost/api/projects/chapters", "POST", { title: "Chapter", body: "Before" }),
      routeContext({ projectId: project.id }),
    );
    const chapter = (await chapterResponse.json()).data.chapter as { id: string; updatedAt: string };
    const { POST: generateRoute } = await import("./ai/generate/route");
    const generatedResponse = await generateRoute(jsonRequest("http://localhost/api/ai/generate", "POST", {
      projectId: project.id,
      targetChapterId: chapter.id,
      action: "brainstorm",
      instruction: "Find a turn",
      context: { bibleEntryIds: [bible.id], outlineNodeIds: [], chapterIds: [] },
    }));
    expect(generatedResponse.status).toBe(201);
    const generated = (await generatedResponse.json()).data;
    expect(generated.generation.generatedMarkdown).toBe("Generated AI draft");
    expect(generated.references).toEqual([{ id: bible.id, group: "bible", title: "Setting", subtype: "world" }]);

    const { POST: acceptRoute } = await import("./chapters/[chapterId]/ai-accept/route");
    const acceptedResponse = await acceptRoute(
      jsonRequest("http://localhost/api/chapters/accept/ai", "POST", {
        generationId: generated.generation.id,
        body: "Accepted prose",
        baseUpdatedAt: chapter.updatedAt,
      }),
      routeContext({ chapterId: chapter.id }),
    );
    expect(acceptedResponse.status).toBe(200);
    const accepted = (await acceptedResponse.json()).data;
    expect(accepted.version).toMatchObject({ source: "ai", aiAction: "brainstorm", instruction: "Find a turn" });
    expect(accepted.generation.acceptedVersionId).toBe(accepted.version.id);

    const duplicateResponse = await acceptRoute(
      jsonRequest("http://localhost/api/chapters/accept/ai", "POST", {
        generationId: generated.generation.id,
        body: "Second acceptance",
        baseUpdatedAt: accepted.chapter.updatedAt,
      }),
      routeContext({ chapterId: chapter.id }),
    );
    expect(duplicateResponse.status).toBe(409);
    expect((await duplicateResponse.json()).error.code).toBe("AI_GENERATION_ALREADY_ACCEPTED");
  });
});
