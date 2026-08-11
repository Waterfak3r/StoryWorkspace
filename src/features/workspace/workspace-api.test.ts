import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAcceptResponse, AiGenerateResponse } from "@/domain/ai";
import type { Adaptation } from "@/domain/adaptation";
import type { Chapter, ChapterVersion, CreateChapterInput, RestoreChapterInput, UpdateChapterInput } from "@/domain/narrative";
import type { DocumentRevision, ScriptDocument } from "@/domain/document";
import type { AnalysisRun } from "@/domain/analysis";
import type { Inference, ModelRun } from "@/domain/inference";
import type { AcceptEditedPatchInput, AcceptPatchInput, Patch, PatchApplication, ProposeFactPatchInput, RejectPatchInput } from "@/domain/canon-patch";
import type { SceneEntityLink } from "@/domain/scene-link";
import type { Entity, EntityAlias, EvidenceSource, Fact } from "@/domain/story-bible";
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
  createDocumentRevision,
  createEntity,
  createEntityAlias,
  createScriptDocument,
  enqueueAnalysis,
  executeAnalysis,
  acceptEditedPatch,
  acceptPatch,
  getScenePatchReview,
  getDocumentRevision,
  getSceneEntityReview,
  getScriptDocument,
  listEntities,
  listPatches,
  listScriptDocuments,
  proposeFactPatch,
  rejectPatch,
  parseScenePatchReview,
  reviewSceneEntityLink,
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

const documentId = "77777777-7777-4777-8777-777777777777";
const revisionId = "88888888-8888-4888-8888-888888888888";
const sceneId = "99999999-9999-4999-8999-999999999999";
const sceneRevisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const entityId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const aliasId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const runId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const linkId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const mentionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const inferenceId = "12121212-1212-4121-8121-121212121212";
const patchId = "23232323-2323-4232-8232-232323232323";
const patchEvidenceId = "34343434-3434-4434-8434-343434343434";
const patchModelRunId = "45454545-4545-4454-8454-454545454545";
const patchApplicationId = "56565656-5656-4565-8565-565656565656";
const patchFactId = "67676767-6767-4676-8676-676767676767";
const hash = "a".repeat(64);

const scriptDocument: ScriptDocument = {
  id: documentId,
  projectId,
  title: "Pilot",
  kind: "screenplay",
  status: "active",
  version: 1,
  currentRevisionId: revisionId,
  createdAt,
  updatedAt,
};

const documentRevision: DocumentRevision = {
  id: revisionId,
  projectId,
  documentId,
  revisionNumber: 1,
  baseVersion: 0,
  contentHash: hash,
  createdBy: "local-user",
  requestId: "revision-request",
  createdAt,
  sceneRevisions: [{
    id: sceneRevisionId,
    projectId,
    documentId,
    sceneId,
    documentRevisionId: revisionId,
    narrativeRank: 0,
    title: "Opening",
    content: "Lin Mo enters.",
    contentHash: hash,
    status: "active",
    createdAt,
  }],
};

const entity: Entity = {
  id: entityId,
  projectId,
  type: "character",
  canonicalName: "Lin Mo",
  status: "draft",
  mergedIntoEntityId: null,
  attributes: {},
  schemaVersion: 1,
  version: 1,
  createdAt,
  updatedAt,
};

const entityAlias: EntityAlias = {
  id: aliasId,
  projectId,
  entityId,
  alias: "Lin",
  normalizedAlias: "lin",
  locale: null,
  status: "active",
  createdAt,
};

const analysisRun: AnalysisRun = {
  id: runId,
  projectId,
  documentId,
  sceneId,
  sceneRevisionId,
  contentHash: hash,
  analyzerVersion: "deterministic-v1",
  idempotencyKey: "analysis-request",
  status: "succeeded",
  leaseToken: null,
  leaseExpiresAt: null,
  attempt: 1,
  errorCode: null,
  errorMessage: null,
  startedAt: createdAt,
  completedAt: updatedAt,
  createdAt,
  updatedAt,
};

const sceneLink: SceneEntityLink = {
  id: linkId,
  projectId,
  sceneId,
  sceneRevisionId,
  entityId,
  entityType: "character",
  role: "appears",
  status: "candidate",
  resolver: "exact_alias",
  confidence: 0.9,
  version: 1,
  candidateGroupId: "13131313-1313-4131-8131-131313131313",
  fingerprint: "fingerprint",
  analysisRunId: runId,
  mentionIds: [mentionId],
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

  it("scopes script document and revision reads by project and sends revision concurrency", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { documents: [scriptDocument] } }),
      jsonResponse({ data: { document: scriptDocument } }, 201),
      jsonResponse({ data: { document: scriptDocument } }),
      jsonResponse({ data: { revision: documentRevision } }),
      jsonResponse({ data: { revision: documentRevision } }, 201),
    );
    await expect(listScriptDocuments(projectId)).resolves.toEqual([scriptDocument]);
    await expect(createScriptDocument(projectId, { title: "Pilot", kind: "screenplay", requestId: "create-1", scenes: [] })).resolves.toEqual(scriptDocument);
    await expect(getScriptDocument(projectId, documentId)).resolves.toEqual(scriptDocument);
    await expect(getDocumentRevision(projectId, documentId, revisionId)).resolves.toEqual(documentRevision);
    await expect(createDocumentRevision(projectId, documentId, {
      baseVersion: 1,
      expectedVersion: 1,
      requestId: "revision-1",
      scenes: [{ id: sceneId, title: "Opening", content: "Lin Mo enters.", narrativeRank: 0 }],
    })).resolves.toEqual(documentRevision);
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/documents/${documentId}?projectId=${projectId}`, expect.objectContaining({ headers: { "content-type": "application/json" } }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, `/api/documents/${documentId}/revisions/${revisionId}?projectId=${projectId}`, expect.objectContaining({ headers: { "content-type": "application/json" } }));
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/documents/${documentId}/revisions`, "POST", {
      baseVersion: 1,
      expectedVersion: 1,
      requestId: "revision-1",
      scenes: [{ id: sceneId, title: "Opening", content: "Lin Mo enters.", narrativeRank: 0 }],
    });
  });

  it("uses project-scoped entity, analysis, review, and link routes", async () => {
    const fetchMock = mockFetch(
      jsonResponse({ data: { entities: [entity] } }),
      jsonResponse({ data: { entity } }, 201),
      jsonResponse({ data: { alias: entityAlias } }, 201),
      jsonResponse({ data: { run: analysisRun } }, 201),
      jsonResponse({ data: { run: analysisRun } }),
      jsonResponse({ data: { review: { runs: [analysisRun], mentions: [], links: [] } } }),
      jsonResponse({ data: { link: { ...sceneLink, status: "confirmed", version: 2 } } }),
    );
    await expect(listEntities(projectId)).resolves.toEqual([entity]);
    await expect(createEntity(projectId, { type: "character", canonicalName: "Lin Mo", requestId: "entity-1" })).resolves.toEqual(entity);
    await expect(createEntityAlias(projectId, entityId, { alias: "Lin", requestId: "alias-1" })).resolves.toEqual(entityAlias);
    await expect(enqueueAnalysis(projectId, { documentId, sceneId, sceneRevisionId, contentHash: hash, requestId: "analysis-1" })).resolves.toEqual(analysisRun);
    await expect(executeAnalysis(projectId, runId, { requestId: "execute-1" })).resolves.toEqual(analysisRun);
    await expect(getSceneEntityReview(projectId, sceneId, sceneRevisionId)).resolves.toMatchObject({ analysisRun, mentions: [], links: [] });
    await expect(reviewSceneEntityLink(projectId, sceneId, linkId, {
      status: "confirmed",
      expectedVersion: 1,
      expectedSceneRevisionId: sceneRevisionId,
      requestId: "review-1",
    })).resolves.toMatchObject({ id: linkId, status: "confirmed", version: 2 });
    expect(fetchMock).toHaveBeenNthCalledWith(5, `/api/projects/${projectId}/analysis/runs/${runId}/execute`, expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(6, `/api/projects/${projectId}/scenes/${sceneId}/entity-review?projectId=${projectId}&sceneRevisionId=${sceneRevisionId}`, expect.objectContaining({ headers: { "content-type": "application/json" } }));
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/scenes/${sceneId}/entity-links/${linkId}`, "PATCH", {
      status: "confirmed",
      expectedVersion: 1,
      expectedSceneRevisionId: sceneRevisionId,
      requestId: "review-1",
    });
  });

  it("parses the Phase 2 scene patch read model and rejects malformed provenance", () => {
    const source: EvidenceSource = {
      id: patchEvidenceId,
      projectId,
      kind: "text_span",
      documentId,
      sceneId,
      revisionId: sceneRevisionId,
      sceneRevisionId,
      anchorStart: "0",
      anchorEnd: "12",
      quotedText: "silver earring",
      createdByUserId: null,
      modelRunId: patchModelRunId,
      createdAt,
    };
    const modelRun: ModelRun = {
      id: patchModelRunId,
      projectId,
      kind: "fact_extractor",
      model: "deterministic-fixture",
      modelVersion: "fact-fixture-v1",
      sourceRevisionId: sceneRevisionId,
      inputHash: hash,
      status: "succeeded",
      outputHash: hash,
      errorCode: null,
      errorMessage: null,
      createdAt,
      completedAt: updatedAt,
    };
    const inference: Inference = {
      id: inferenceId,
      projectId,
      subjectEntityId: entityId,
      predicate: "appearance.distinctive_features",
      value: ["silver earring"],
      valueType: "json",
      scope: "base",
      sceneId: null,
      validFromSceneId: null,
      validToSceneId: null,
      confidence: 0.98,
      rationale: "Explicit text evidence",
      modelRunId: patchModelRunId,
      status: "active",
      version: 1,
      createdAt,
    };
    const patch: Patch = {
      id: patchId,
      projectId,
      operation: "add_fact",
      targetEntityId: entityId,
      targetFactId: null,
      baseVersion: 1,
      payload: { subjectEntityId: entityId, predicate: inference.predicate, value: inference.value, valueType: "json", scope: "base", sceneId: null, validFromSceneId: null, validToSceneId: null, before: null },
      truthClass: "canon",
      evidenceSourceIds: [patchEvidenceId],
      confidence: 0.98,
      conflictKind: "none",
      conflictingFactIds: [],
      conflictMessage: null,
      sourceRevisionId: sceneRevisionId,
      inferenceId,
      modelRunId: patchModelRunId,
      status: "pending",
      proposedBy: "model",
      version: 1,
      createdAt,
      resolvedAt: null,
      resolvedByUserId: null,
    };
    const application: PatchApplication = {
      id: patchApplicationId,
      projectId,
      patchId,
      operation: "add_fact",
      resultingFactId: patchFactId,
      appliedPayload: patch.payload,
      requestId: "patch-accept-1",
      createdAt: updatedAt,
    };
    const fact: Fact = {
      id: patchFactId,
      projectId,
      subjectEntityId: entityId,
      predicate: "appearance.distinctive_features",
      value: ["silver earring"],
      valueType: "json",
      truthClass: "canon",
      scope: "base",
      sceneId: null,
      validFromSceneId: null,
      validToSceneId: null,
      sourceId: patchEvidenceId,
      promotedFromInferenceId: inferenceId,
      status: "active",
      supersedesFactId: null,
      version: 1,
      createdAt,
    };

    expect(parseScenePatchReview({ review: { pendingPatches: [patch], inferences: [inference], modelRuns: [modelRun], evidence: [source], applications: [application], facts: [fact] } })).toEqual({
      patches: [patch],
      inferences: [inference],
      modelRuns: [modelRun],
      evidenceSources: [source],
      applications: [application],
      facts: [fact],
    });
    expect(() => parseScenePatchReview({ review: { pendingPatches: [{ ...patch, version: 0 }] } })).toThrowError(/invalid scene patch review/i);
  });

  it("uses the canonical Phase 2 patch routes with revision and concurrency inputs", async () => {
    const patch: Patch = {
      id: patchId,
      projectId,
      operation: "add_fact",
      targetEntityId: entityId,
      targetFactId: null,
      baseVersion: 1,
      payload: { subjectEntityId: entityId, predicate: "appearance.distinctive_features", value: ["silver earring"], valueType: "json", scope: "base", sceneId: null, validFromSceneId: null, validToSceneId: null },
      truthClass: "canon",
      evidenceSourceIds: [patchEvidenceId],
      confidence: 0.98,
      conflictKind: "none",
      conflictingFactIds: [],
      conflictMessage: null,
      sourceRevisionId: sceneRevisionId,
      inferenceId: inferenceId,
      modelRunId: patchModelRunId,
      status: "pending",
      proposedBy: "model",
      version: 1,
      createdAt,
      resolvedAt: null,
      resolvedByUserId: null,
    };
    const proposalInput: ProposeFactPatchInput = {
      documentId,
      sceneId,
      sceneRevisionId,
      operation: "add_fact",
      subjectEntityId: entityId,
      predicate: "appearance.distinctive_features",
      value: ["silver earring"],
      valueType: "json",
      scope: "base",
      evidence: [{ anchorStart: 0, anchorEnd: 14, quotedText: "silver earring" }],
      confidence: 0.98,
      requestId: "patch-propose-1",
    };
    const acceptInput: AcceptPatchInput = { expectedVersion: 1, requestId: "patch-accept-1" };
    const editedInput: AcceptEditedPatchInput = { expectedVersion: 1, requestId: "patch-edit-1", payload: { ...patch.payload, value: ["silver earring", "left ear"] } };
    const rejectInput: RejectPatchInput = { expectedVersion: 1, requestId: "patch-reject-1", reason: "Not stable enough" };
    const fetchMock = mockFetch(
      jsonResponse({ data: { patches: [patch], inferences: [], modelRuns: [], evidenceSources: [] } }),
      jsonResponse({ data: { patches: [patch] } }),
      jsonResponse({ data: { patch, inference: null, modelRun: null, idempotent: false } }, 201),
      jsonResponse({ data: { patch: { ...patch, status: "accepted", version: 2 }, fact: null, application: null, idempotent: false } }),
      jsonResponse({ data: { patch: { ...patch, status: "accepted", version: 2 }, fact: null, application: null, idempotent: false } }),
      jsonResponse({ data: { patch: { ...patch, status: "rejected", version: 2 }, idempotent: false } }),
    );

    await expect(getScenePatchReview(projectId, sceneId, sceneRevisionId)).resolves.toMatchObject({ patches: [patch] });
    await expect(listPatches(projectId, { status: "pending", sceneRevisionId })).resolves.toEqual([patch]);
    await expect(proposeFactPatch(projectId, sceneId, proposalInput)).resolves.toMatchObject({ patch, idempotent: false });
    await expect(acceptPatch(projectId, patchId, acceptInput)).resolves.toMatchObject({ patch: { status: "accepted", version: 2 } });
    await expect(acceptEditedPatch(projectId, patchId, editedInput)).resolves.toMatchObject({ patch: { status: "accepted", version: 2 } });
    await expect(rejectPatch(projectId, patchId, rejectInput)).resolves.toMatchObject({ patch: { status: "rejected", version: 2 } });

    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/projects/${projectId}/scenes/${sceneId}/patch-review?sceneRevisionId=${sceneRevisionId}`, expect.objectContaining({ headers: { "content-type": "application/json" } }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/projects/${projectId}/patches?status=pending&sceneRevisionId=${sceneRevisionId}`, expect.objectContaining({ headers: { "content-type": "application/json" } }));
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/scenes/${sceneId}/fact-patches`, "POST", proposalInput);
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/patches/${patchId}/accept`, "POST", acceptInput);
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/patches/${patchId}/accept-edited`, "POST", editedInput);
    expectJsonRequest(fetchMock, `/api/projects/${projectId}/patches/${patchId}/reject`, "POST", rejectInput);
  });

  it("preserves the latest Patch in a 409 conflict without weakening the error payload", async () => {
    const currentPatch: Patch = {
      id: patchId,
      projectId,
      operation: "add_fact",
      targetEntityId: entityId,
      targetFactId: null,
      baseVersion: 2,
      payload: { subjectEntityId: entityId, predicate: "appearance.hair", value: "red hair", valueType: "string", scope: "base", sceneId: null, validFromSceneId: null, validToSceneId: null },
      truthClass: "canon",
      evidenceSourceIds: [patchEvidenceId],
      confidence: 0.8,
      conflictKind: "hard",
      conflictingFactIds: ["56565656-5656-4565-8565-565656565656"],
      conflictMessage: "Canon changed on the server.",
      sourceRevisionId: sceneRevisionId,
      inferenceId: inferenceId,
      modelRunId: patchModelRunId,
      status: "pending",
      proposedBy: "user",
      version: 2,
      createdAt,
      resolvedAt: null,
      resolvedByUserId: null,
    };
    mockFetch(jsonResponse({ error: { code: "PATCH_CONFLICT", message: "The Patch changed on the server.", patch: currentPatch, retryable: false } }, 409));
    const rejection = listPatches(projectId);
    await expect(rejection).rejects.toMatchObject({ status: 409, code: "PATCH_CONFLICT", currentPatch });
    await expect(rejection).rejects.toMatchObject({ details: { currentPatch } });
  });
});
