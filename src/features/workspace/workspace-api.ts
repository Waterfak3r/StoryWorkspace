import { z } from "zod";
import {
  aiAcceptResponseSchema,
  aiGenerateResponseSchema,
  type AiAcceptInput,
  type AiAcceptResponse,
  type AiGenerateInput,
  type AiGenerateResponse,
} from "@/domain/ai";
import {
  chapterSchema,
  chapterVersionSchema,
  type Chapter,
  type ChapterVersion,
  type CreateChapterInput,
  type RestoreChapterInput,
  type UpdateChapterInput,
} from "@/domain/narrative";
import {
  adaptationSchema,
  type Adaptation,
  type CreateAiAdaptationInput,
  type CreateManualAdaptationInput,
  type UpdateAdaptationInput,
} from "@/domain/adaptation";
import type {
  BibleEntry,
  CreateBibleEntryInput,
  CreateOutlineNodeInput,
  OutlineNode,
  OutlineOrderInput,
  UpdateBibleEntryInput,
  UpdateOutlineNodeInput,
} from "@/domain/narrative";

export type WorkspaceFieldErrors = Record<string, string[]>;

export type WorkspaceErrorPayload = {
  code: string;
  message: string;
  fieldErrors?: WorkspaceFieldErrors;
  retryable?: boolean;
  details?: unknown;
  currentChapter?: unknown;
  currentAdaptation?: unknown;
  consumedBy?: "chapter" | "adaptation";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function detailsWithCurrentChapter(details: unknown, currentChapter: unknown) {
  if (details === undefined) {
    return { currentChapter };
  }
  if (isRecord(details)) {
    return { ...details, currentChapter };
  }
  return { value: details, currentChapter };
}

function detailsWithCurrentAdaptation(details: unknown, currentAdaptation: unknown) {
  if (details === undefined) {
    return { currentAdaptation };
  }
  if (isRecord(details)) {
    return { ...details, currentAdaptation };
  }
  return { value: details, currentAdaptation };
}

function rawCurrentChapter(payload: WorkspaceErrorPayload) {
  if (payload.currentChapter !== undefined) {
    return payload.currentChapter;
  }
  if (isRecord(payload.details) && "currentChapter" in payload.details) {
    return payload.details.currentChapter;
  }
  return undefined;
}

function rawCurrentAdaptation(payload: WorkspaceErrorPayload) {
  if (payload.currentAdaptation !== undefined) {
    return payload.currentAdaptation;
  }
  if (isRecord(payload.details) && "currentAdaptation" in payload.details) {
    return payload.details.currentAdaptation;
  }
  return undefined;
}

export class WorkspaceApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: WorkspaceFieldErrors;
  readonly retryable: boolean;
  readonly details: unknown;
  readonly currentChapter: Chapter | null;
  readonly currentAdaptation: Adaptation | null;
  readonly consumedBy: "chapter" | "adaptation" | null;

  constructor(status: number, payload: WorkspaceErrorPayload) {
    super(payload.message);
    this.name = "WorkspaceApiError";
    this.status = status;
    this.code = payload.code;
    this.fieldErrors = payload.fieldErrors ?? {};
    this.retryable = payload.retryable ?? false;
    const rawChapter = rawCurrentChapter(payload);
    const parsedChapter = chapterSchema.safeParse(rawChapter);
    this.currentChapter = parsedChapter.success ? parsedChapter.data : null;
    const rawAdaptation = rawCurrentAdaptation(payload);
    const parsedAdaptation = adaptationSchema.safeParse(rawAdaptation);
    this.currentAdaptation = parsedAdaptation.success ? parsedAdaptation.data : null;
    this.consumedBy = payload.consumedBy === "chapter" || payload.consumedBy === "adaptation" ? payload.consumedBy : null;
    const withChapter = payload.currentChapter !== undefined
      ? detailsWithCurrentChapter(payload.details, payload.currentChapter)
      : payload.details;
    this.details = payload.currentAdaptation !== undefined
      ? detailsWithCurrentAdaptation(withChapter, payload.currentAdaptation)
      : withChapter;
  }
}

type DataEnvelope<T> = { data: T };

export type ChapterRestoreResult = {
  chapter: Chapter;
  backupVersion: ChapterVersion;
  restoredVersion: ChapterVersion;
};

const chapterRestoreResultSchema = z.object({
  chapter: chapterSchema,
  backupVersion: chapterVersionSchema,
  restoredVersion: chapterVersionSchema,
}).strict();

function invalidDataError(resource: string) {
  return new WorkspaceApiError(200, {
    code: "INTERNAL_ERROR",
    message: `The workspace returned an invalid ${resource}. Try again in a moment.`,
    retryable: true,
  });
}

function parseChapter(value: unknown) {
  const parsed = chapterSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("chapter response");
  }
  return parsed.data;
}

function parseChapterEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("chapter response");
  }
  return parseChapter(value.chapter);
}

function parseChapterList(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("chapter list response");
  }
  const parsed = z.array(chapterSchema).safeParse(value.chapters);
  if (!parsed.success) {
    throw invalidDataError("chapter list response");
  }
  return parsed.data;
}

function parseChapterVersion(value: unknown) {
  const parsed = chapterVersionSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("chapter version response");
  }
  return parsed.data;
}

function parseChapterVersionEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("chapter version response");
  }
  return parseChapterVersion(value.version);
}

function parseChapterVersionList(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("chapter version list response");
  }
  const parsed = z.array(chapterVersionSchema).safeParse(value.versions);
  if (!parsed.success) {
    throw invalidDataError("chapter version list response");
  }
  return parsed.data;
}

function parseChapterRestoreResult(value: unknown): ChapterRestoreResult {
  const parsed = chapterRestoreResultSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("chapter restore response");
  }
  return parsed.data;
}

function parseAdaptation(value: unknown) {
  const parsed = adaptationSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("adaptation response");
  }
  return parsed.data;
}

function parseAdaptationEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("adaptation response");
  }
  return parseAdaptation(value.adaptation);
}

function parseAdaptationList(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("adaptation list response");
  }
  const parsed = z.array(adaptationSchema).safeParse(value.adaptations);
  if (!parsed.success) {
    throw invalidDataError("adaptation list response");
  }
  return parsed.data;
}

function parseDeleted(value: unknown) {
  if (!isRecord(value) || typeof value.deleted !== "boolean") {
    throw invalidDataError("delete response");
  }
  return { deleted: value.deleted };
}

function parseAiGenerateResponse(value: unknown): AiGenerateResponse {
  const parsed = aiGenerateResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("AI generation response");
  }
  return parsed.data;
}

function parseAiAcceptResponse(value: unknown): AiAcceptResponse {
  const parsed = aiAcceptResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("AI acceptance response");
  }
  return parsed.data;
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestData<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers,
      },
    });
  } catch (error) {
    if (init?.signal?.aborted || (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")) {
      throw new WorkspaceApiError(0, {
        code: "AI_CANCELLED",
        message: "AI generation was cancelled.",
        retryable: false,
      });
    }
    throw new WorkspaceApiError(0, {
      code: "NETWORK_ERROR",
      message: "The workspace could not be reached. Try again in a moment.",
      retryable: true,
      details: error instanceof Error ? { cause: error.message } : undefined,
    });
  }

  const payload = await readPayload(response);
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error as WorkspaceErrorPayload : {
      code: "INTERNAL_ERROR",
      message: "The workspace could not be reached. Try again in a moment.",
      retryable: true,
    } satisfies WorkspaceErrorPayload;
    throw new WorkspaceApiError(response.status, errorPayload);
  }

  if (!isRecord(payload) || !("data" in payload)) {
    throw new WorkspaceApiError(response.status, {
      code: "INTERNAL_ERROR",
      message: "The workspace returned an invalid response. Try again in a moment.",
      retryable: true,
    });
  }

  return (payload as DataEnvelope<T>).data;
}

function jsonBody(value: unknown): RequestInit {
  return {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

export async function createBibleEntry(projectId: string, input: CreateBibleEntryInput) {
  const result = await requestData<{ entry: BibleEntry }>(`/api/projects/${encodeURIComponent(projectId)}/bible`, {
    method: "POST",
    ...jsonBody(input),
  });
  return result.entry;
}

export async function updateBibleEntry(entryId: string, input: UpdateBibleEntryInput) {
  const result = await requestData<{ entry: BibleEntry }>(`/api/bible/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
  return result.entry;
}

export async function deleteBibleEntry(entryId: string) {
  return requestData<{ deleted: boolean }>(`/api/bible/${encodeURIComponent(entryId)}`, { method: "DELETE" });
}

export async function createOutlineNode(projectId: string, input: CreateOutlineNodeInput) {
  const result = await requestData<{ node: OutlineNode }>(`/api/projects/${encodeURIComponent(projectId)}/outline`, {
    method: "POST",
    ...jsonBody(input),
  });
  return result.node;
}

export async function updateOutlineNode(nodeId: string, input: UpdateOutlineNodeInput) {
  const result = await requestData<{ node: OutlineNode }>(`/api/outline/${encodeURIComponent(nodeId)}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
  return result.node;
}

export async function deleteOutlineNode(nodeId: string) {
  return requestData<{ deleted: boolean }>(`/api/outline/${encodeURIComponent(nodeId)}`, { method: "DELETE" });
}

export async function reorderOutlineNodes(projectId: string, input: OutlineOrderInput) {
  const result = await requestData<{ nodes: OutlineNode[] }>(`/api/projects/${encodeURIComponent(projectId)}/outline/order`, {
    method: "PATCH",
    ...jsonBody(input),
  });
  return result.nodes;
}

export async function listChapters(projectId: string): Promise<Chapter[]> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/chapters`);
  return parseChapterList(result);
}

export async function createChapter(projectId: string, input: CreateChapterInput): Promise<Chapter> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/chapters`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseChapterEnvelope(result);
}

export async function getChapter(chapterId: string): Promise<Chapter> {
  const result = await requestData<unknown>(`/api/chapters/${encodeURIComponent(chapterId)}`);
  return parseChapterEnvelope(result);
}

export async function updateChapter(chapterId: string, input: UpdateChapterInput): Promise<Chapter> {
  const result = await requestData<unknown>(`/api/chapters/${encodeURIComponent(chapterId)}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
  return parseChapterEnvelope(result);
}

export async function deleteChapter(chapterId: string): Promise<{ deleted: boolean }> {
  const result = await requestData<unknown>(`/api/chapters/${encodeURIComponent(chapterId)}`, { method: "DELETE" });
  return parseDeleted(result);
}

export async function listChapterVersions(chapterId: string): Promise<ChapterVersion[]> {
  const result = await requestData<unknown>(`/api/chapters/${encodeURIComponent(chapterId)}/versions`);
  return parseChapterVersionList(result);
}

export async function createManualChapterVersion(chapterId: string): Promise<ChapterVersion> {
  const result = await requestData<unknown>(`/api/chapters/${encodeURIComponent(chapterId)}/versions`, {
    method: "POST",
    ...jsonBody({}),
  });
  return parseChapterVersionEnvelope(result);
}

export async function restoreChapterVersion(chapterId: string, input: RestoreChapterInput): Promise<ChapterRestoreResult> {
  const result = await requestData<unknown>(`/api/chapters/${encodeURIComponent(chapterId)}/restore`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseChapterRestoreResult(result);
}

export async function generateAiDraft(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateResponse> {
  const result = await requestData<unknown>("/api/ai/generate", {
    method: "POST",
    ...jsonBody(input),
    signal,
  });
  return parseAiGenerateResponse(result);
}

export async function acceptAiDraft(chapterId: string, input: AiAcceptInput): Promise<AiAcceptResponse> {
  const result = await requestData<unknown>(`/api/chapters/${encodeURIComponent(chapterId)}/ai-accept`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseAiAcceptResponse(result);
}

export async function listAdaptations(projectId: string): Promise<Adaptation[]> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/adaptations`);
  return parseAdaptationList(result);
}

export async function getAdaptation(adaptationId: string): Promise<Adaptation> {
  const result = await requestData<unknown>(`/api/adaptations/${encodeURIComponent(adaptationId)}`);
  return parseAdaptationEnvelope(result);
}

export async function createManualAdaptation(projectId: string, input: CreateManualAdaptationInput): Promise<Adaptation> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/adaptations`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseAdaptationEnvelope(result);
}

export async function createAiAdaptation(projectId: string, input: CreateAiAdaptationInput): Promise<Adaptation> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/adaptations`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseAdaptationEnvelope(result);
}

export async function updateAdaptation(adaptationId: string, input: UpdateAdaptationInput): Promise<Adaptation> {
  const result = await requestData<unknown>(`/api/adaptations/${encodeURIComponent(adaptationId)}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
  return parseAdaptationEnvelope(result);
}

export async function deleteAdaptation(adaptationId: string): Promise<{ deleted: boolean }> {
  const result = await requestData<unknown>(`/api/adaptations/${encodeURIComponent(adaptationId)}`, { method: "DELETE" });
  return parseDeleted(result);
}

export type ProjectMarkdownDownload = {
  blob: Blob;
  filename: string;
};

export function safeDownloadFilename(value: string | null) {
  const fallback = "story-workspace-export.md";
  if (!value || /[\r\n]/.test(value)) {
    return fallback;
  }

  const readParameter = (name: string) => {
    const match = new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`, "i").exec(value);
    if (!match) {
      return null;
    }
    const raw = match[1].trim();
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      return raw.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    return raw;
  };

  const extended = readParameter("filename\\*");
  const basic = readParameter("filename");
  const candidates = [
    extended ? (() => {
      const encoded = /^UTF-8''(.+)$/i.exec(extended)?.[1];
      if (!encoded) {
        return null;
      }
      try {
        return decodeURIComponent(encoded);
      } catch {
        return null;
      }
    })() : null,
    basic,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    let decoded = candidate
      .replace(/[\0-\x1F\x7F]/g, "_")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .replace(/[. ]+$/g, "");
    if (!decoded || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(decoded)) {
      continue;
    }
    decoded = decoded.slice(0, 180).replace(/[. ]+$/g, "");
    if (decoded) {
      return decoded;
    }
  }
  return fallback;
}

export async function downloadProjectMarkdown(projectId: string): Promise<ProjectMarkdownDownload> {
  let response: Response;
  try {
    response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export`, {
      headers: { accept: "text/markdown" },
    });
  } catch (error) {
    throw new WorkspaceApiError(0, {
      code: "NETWORK_ERROR",
      message: "The workspace could not be reached. Try again in a moment.",
      retryable: true,
      details: error instanceof Error ? { cause: error.message } : undefined,
    });
  }
  if (!response.ok) {
    const payload = await readPayload(response);
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error as WorkspaceErrorPayload : {
      code: "INTERNAL_ERROR",
      message: "The workspace could not be reached. Try again in a moment.",
      retryable: true,
    } satisfies WorkspaceErrorPayload;
    throw new WorkspaceApiError(response.status, errorPayload);
  }
  return {
    blob: await response.blob(),
    filename: safeDownloadFilename(response.headers.get("content-disposition")),
  };
}
