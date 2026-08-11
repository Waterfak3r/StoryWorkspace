import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAcceptResponse, AiGenerateResponse } from "@/domain/ai";
import type { Adaptation } from "@/domain/adaptation";
import type { Chapter, ChapterVersion, CreateChapterInput, RestoreChapterInput, UpdateChapterInput } from "@/domain/narrative";
import {
  WorkspaceApiError,
  createChapter,
  createManualChapterVersion,
  deleteChapter,
  acceptAiDraft,
  generateAiDraft,
  getChapter,
  listChapterVersions,
  listChapters,
  listAdaptations,
  getAdaptation,
  createManualAdaptation,
  createAiAdaptation,
  updateAdaptation,
  deleteAdaptation,
  downloadProjectMarkdown,
  restoreChapterVersion,
  safeDownloadFilename,
  updateChapter,
} from "./workspace-api";

const projectId = "11111111-1111-4111-8111-111111111111";
const chapterId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const backupVersionId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-01-01T00:00:00.000Z";
const updatedAt = "2026-01-01T00:00:01.000Z";

const chapter: Chapter = {
  id: chapterId,
  projectId,
  outlineNodeId: null,
  title: "First chapter",
  summary: "A beginning",
  body: "The first page.",
  position: 0,
  status: "draft",
  createdAt,
  updatedAt,
};

const version: ChapterVersion = {
  id: versionId,
  chapterId,
  body: "The first page.",
  source: "manual",
  aiAction: null,
  instruction: null,
  contextReferenceIds: [],
  createdAt,
};

const aiGeneration: AiGenerateResponse["generation"] = {
  id: "55555555-5555-4555-8555-555555555555",
  projectId,
  targetChapterId: chapterId,
  action: "brainstorm",
  instruction: "Find a turn",
  contextReferenceIds: [],
  generatedMarkdown: "A possible turn.",
  createdAt,
  acceptedVersionId: null,
};

const aiResponse: AiGenerateResponse = {
  generation: aiGeneration,
  references: [],
};

const adaptation: Adaptation = {
  id: "66666666-6666-4666-8666-666666666666",
  projectId,
  format: "screenplay_scene",
  title: "Scene",
  body: "INT. ROOM",
  position: 0,
  sourceGenerationId: null,
  createdAt,
  updatedAt,
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function expectJsonRequest(fetchMock: ReturnType<typeof vi.fn>, url: string, method: string, body?: unknown) {
  expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

describe("chapter workspace API", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists chapters and validates the canonical records", async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { chapters: [chapter] } }));

    await expect(listChapters(projectId)).resolves.toEqual([chapter]);
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${projectId}/chapters`, expect.objectContaining({
      headers: { "content-type": "application/json" },
    }));
  });

  it("creates a chapter with the documented input", async () => {
    const input: CreateChapterInput = { title: "New chapter", summary: "", body: "", outlineNodeId: null };
    const fetchMock = mockFetch(jsonResponse({ data: { chapter } }, 201));

    await expect(createChapter(projectId, input)).resolves.toEqual(chapter);
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/chapters`, "POST", input);
  });

  it("gets and updates a chapter with the full optimistic-concurrency input", async () => {
    const input: UpdateChapterInput = { baseUpdatedAt: updatedAt, body: "Updated page." };
    const fetchMock = mockFetch(
      jsonResponse({ data: { chapter } }),
      jsonResponse({ data: { chapter: { ...chapter, body: input.body } } }),
    );

    await expect(getChapter(chapterId)).resolves.toEqual(chapter);
    await expect(updateChapter(chapterId, input)).resolves.toMatchObject({ body: input.body });
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/chapters/${chapterId}`, expect.objectContaining({
      headers: { "content-type": "application/json" },
    }));
    expectJsonRequest(fetchMock, `/api/chapters/${chapterId}`, "PATCH", input);
  });

  it("deletes a chapter and preserves the typed deleted result", async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { deleted: true } }));

    await expect(deleteChapter(chapterId)).resolves.toEqual({ deleted: true });
    expectJsonRequest(fetchMock, `/api/chapters/${chapterId}`, "DELETE");
  });

  it("lists chapter versions", async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { versions: [version] } }));

    await expect(listChapterVersions(chapterId)).resolves.toEqual([version]);
    expect(fetchMock).toHaveBeenCalledWith(`/api/chapters/${chapterId}/versions`, expect.objectContaining({
      headers: { "content-type": "application/json" },
    }));
  });

  it("creates a manual version with an empty JSON object", async () => {
    const fetchMock = mockFetch(jsonResponse({ data: { version } }, 201));

    await expect(createManualChapterVersion(chapterId)).resolves.toEqual(version);
    expectJsonRequest(fetchMock, `/api/chapters/${chapterId}/versions`, "POST", {});
  });

  it("restores a chapter version and validates every returned record", async () => {
    const input: RestoreChapterInput = { versionId, baseUpdatedAt: updatedAt };
    const restored = {
      chapter: { ...chapter, body: "Restored page.", updatedAt: "2026-01-01T00:00:02.000Z" },
      backupVersion: { ...version, id: backupVersionId, source: "restore_backup" as const, body: chapter.body },
      restoredVersion: version,
    };
    const fetchMock = mockFetch(jsonResponse({ data: restored }));

    await expect(restoreChapterVersion(chapterId, input)).resolves.toEqual(restored);
    expectJsonRequest(fetchMock, `/api/chapters/${chapterId}/restore`, "POST", input);
  });

  it("maps network failures to a retryable workspace error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChapter(chapterId)).rejects.toMatchObject({
      name: "WorkspaceApiError",
      status: 0,
      code: "NETWORK_ERROR",
      retryable: true,
      currentChapter: null,
    });
  });

  it("types a valid conflict chapter while retaining envelope details", async () => {
    const fetchMock = mockFetch(jsonResponse({
      error: {
        code: "EDIT_CONFLICT",
        message: "The chapter changed on the server.",
        retryable: false,
        currentChapter: chapter,
        details: { requestId: "req-1" },
      },
    }, 409));

    const rejection = getChapter(chapterId);
    await expect(rejection).rejects.toBeInstanceOf(WorkspaceApiError);
    await expect(rejection).rejects.toMatchObject({
      status: 409,
      code: "EDIT_CONFLICT",
      currentChapter: chapter,
      details: { requestId: "req-1", currentChapter: chapter },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an invalid conflict chapter raw but exposes null typed currentChapter", async () => {
    const rawCurrentChapter = { id: "not-a-chapter", body: "untrusted" };
    mockFetch(jsonResponse({
      error: {
        code: "EDIT_CONFLICT",
        message: "Conflict",
        retryable: false,
        currentChapter: rawCurrentChapter,
      },
    }, 409));

    let error: unknown;
    try {
      await getChapter(chapterId);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WorkspaceApiError);
    expect(error).toMatchObject({ currentChapter: null, details: { currentChapter: rawCurrentChapter } });
  });

  it("turns an invalid successful chapter payload into a retryable API error", async () => {
    mockFetch(jsonResponse({ data: { chapter: { ...chapter, updatedAt: "not-a-timestamp" } } }));

    let error: unknown;
    try {
      await getChapter(chapterId);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WorkspaceApiError);
    expect(error).toMatchObject({ status: 200, code: "INTERNAL_ERROR", retryable: true });
    expect((error as Error).name).not.toBe("ZodError");
  });

  it("generates and accepts typed AI drafts with the documented envelopes", async () => {
    const accepted: AiAcceptResponse = {
      chapter: { ...chapter, body: "Accepted", updatedAt: "2026-01-01T00:00:02.000Z" },
      version: { ...version, id: backupVersionId, source: "ai", body: "Accepted", aiAction: "brainstorm", instruction: "Find a turn" },
      generation: { ...aiGeneration, acceptedVersionId: backupVersionId },
    };
    const fetchMock = mockFetch(jsonResponse({ data: aiResponse }, 201), jsonResponse({ data: accepted }));
    const signal = new AbortController().signal;
    await expect(generateAiDraft({
      projectId,
      targetChapterId: chapterId,
      action: "brainstorm",
      instruction: "Find a turn",
      context: { bibleEntryIds: [], outlineNodeIds: [], chapterIds: [] },
    }, signal)).resolves.toEqual(aiResponse);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/ai/generate", expect.objectContaining({ method: "POST", signal }));
    expectJsonRequest(fetchMock, "/api/ai/generate", "POST", {
      projectId,
      targetChapterId: chapterId,
      action: "brainstorm",
      instruction: "Find a turn",
      context: { bibleEntryIds: [], outlineNodeIds: [], chapterIds: [] },
    });

    await expect(acceptAiDraft(chapterId, {
      generationId: aiGeneration.id,
      body: "Accepted",
      baseUpdatedAt: chapter.updatedAt,
    })).resolves.toEqual(accepted);
    expectJsonRequest(fetchMock, `/api/chapters/${chapterId}/ai-accept`, "POST", {
      generationId: aiGeneration.id,
      body: "Accepted",
      baseUpdatedAt: chapter.updatedAt,
    });
  });

  it("converts invalid AI success payloads to a safe retryable error", async () => {
    mockFetch(jsonResponse({ data: { generation: { id: "bad" }, references: [] } }, 201));
    await expect(generateAiDraft({
      projectId,
      targetChapterId: chapterId,
      action: "brainstorm",
      instruction: "Find a turn",
      context: { bibleEntryIds: [], outlineNodeIds: [], chapterIds: [] },
    })).rejects.toMatchObject({ code: "INTERNAL_ERROR", retryable: true });
  });

  it("lists, reads, creates, updates, and deletes typed adaptations", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { adaptations: [adaptation] } }),
      jsonResponse({ data: { adaptation } }),
      jsonResponse({ data: { adaptation } }, 201),
      jsonResponse({ data: { adaptation } }, 201),
      jsonResponse({ data: { adaptation: { ...adaptation, body: "Changed" } } }),
      jsonResponse({ data: { deleted: true } }),
    );
    await expect(listAdaptations(projectId)).resolves.toEqual([adaptation]);
    await expect(getAdaptation(adaptation.id)).resolves.toEqual(adaptation);
    await expect(createManualAdaptation(projectId, { origin: "manual", format: "screenplay_scene", title: "Scene", body: "INT. ROOM" })).resolves.toEqual(adaptation);
    await expect(createAiAdaptation(projectId, { origin: "ai", format: "screenplay_scene", title: "Scene", generationId: aiGeneration.id })).resolves.toEqual(adaptation);
    await expect(updateAdaptation(adaptation.id, { baseUpdatedAt: updatedAt, body: "Changed" })).resolves.toMatchObject({ body: "Changed" });
    await expect(deleteAdaptation(adaptation.id)).resolves.toEqual({ deleted: true });
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/adaptations`, "POST", { origin: "manual", format: "screenplay_scene", title: "Scene", body: "INT. ROOM" });
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/adaptations`, "POST", { origin: "ai", format: "screenplay_scene", title: "Scene", generationId: aiGeneration.id });
    expectJsonRequest(fetchMock, `/api/adaptations/${adaptation.id}`, "PATCH", { baseUpdatedAt: updatedAt, body: "Changed" });
  });

  it("types adaptation conflicts and preserves untrusted current records in details", async () => {
    const fetchMock = mockFetch(jsonResponse({
      error: {
        code: "AI_GENERATION_ALREADY_CONSUMED",
        message: "Used",
        retryable: false,
        consumedBy: "adaptation",
        currentAdaptation: adaptation,
      },
    }, 409));
    await expect(createAiAdaptation(projectId, { origin: "ai", format: "screenplay_scene", title: "Scene", generationId: aiGeneration.id })).rejects.toMatchObject({
      code: "AI_GENERATION_ALREADY_CONSUMED",
      consumedBy: "adaptation",
      currentAdaptation: adaptation,
      details: { currentAdaptation: adaptation },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const raw = { id: "bad", title: "untrusted" };
    mockFetch(jsonResponse({ error: { code: "AI_GENERATION_ALREADY_CONSUMED", message: "Used", retryable: false, consumedBy: "adaptation", currentAdaptation: raw } }, 409));
    await expect(createAiAdaptation(projectId, { origin: "ai", format: "screenplay_scene", title: "Scene", generationId: aiGeneration.id })).rejects.toMatchObject({ currentAdaptation: null, details: { currentAdaptation: raw } });
  });

  it("downloads raw Markdown without assuming a JSON success envelope", async () => {
    const body = "# Story\n";
    const response = new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": "attachment; filename=story-workspace-export.md" } });
    const fetchMock = mockFetch(response);
    const result = await downloadProjectMarkdown(projectId);
    expect(await result.blob.text()).toBe(body);
    expect(result.filename).toBe("story-workspace-export.md");
    expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${projectId}/export`, { headers: { accept: "text/markdown" } });
  });

  it("sanitizes RFC 5987 and Windows-hostile download names", () => {
    expect(safeDownloadFilename("attachment; filename*=UTF-8''%2E%2E%2Fdraft%3A%20scene%20%20.md%20")).toBe(".._draft_ scene  .md");
    expect(safeDownloadFilename('attachment; filename="CON.txt"')).toBe("story-workspace-export.md");
    expect(safeDownloadFilename('attachment; filename="draft<final>|?.md...  "')).toBe("draft_final___.md");
    expect(safeDownloadFilename("attachment; filename*=UTF-8''bad%ZZ; filename=backup.md")).toBe("backup.md");
    expect(safeDownloadFilename("attachment; filename=\"draft.md\"\r\nX-Injected: yes")).toBe("story-workspace-export.md");
    expect(safeDownloadFilename("attachment; filename=\"   ...   \"")).toBe("story-workspace-export.md");
  });
});
