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
import {
  documentRevisionSchema,
  scriptDocumentSchema,
  type CreateDocumentRevisionInput,
  type CreateScriptDocumentInput,
  type DocumentRevision,
  type SceneRevision,
  type ScriptDocument,
} from "@/domain/document";
import {
  analysisRunSchema,
  entityMentionSchema,
  type AnalysisRun,
  type EnqueueAnalysisInput,
  type ExecuteAnalysisInput,
  type EntityMention,
} from "@/domain/analysis";
import {
  inferenceSchema,
  modelRunSchema,
  type Inference,
  type ModelRun,
} from "@/domain/inference";
import {
  type AcceptEditedPatchInput,
  type AcceptPatchInput,
  patchApplicationSchema,
  type PatchApplication,
  type ProposeFactPatchInput,
  patchSchema,
  type RejectPatchInput,
  type Patch,
} from "@/domain/canon-patch";
import {
  sceneEntityLinkSchema,
  type ReviewSceneEntityLinkInput,
  type SceneEntityLink,
} from "@/domain/scene-link";
import {
  entityAliasSchema,
  entitySchema,
  evidenceSourceSchema,
  entityStateSchema,
  sceneStatePredicateSchema,
  type SceneStatePredicate,
  type EntityState,
  type CreateEntityAliasInput,
  type CreateEntityInput,
  type Entity,
  type EntityAlias,
  type EvidenceSource,
  factSchema,
  type Fact,
} from "@/domain/story-bible";
import {
  continuityGroupSchema,
  resolvedStateResponseSchema,
  statePatchPayloadSchema,
  type ContinuityGroup,
  type CreateContinuityGroupInput,
  type ProposeStatePatchInput,
  type ResolvedStateResponse,
  type StatePatchPayload,
} from "@/domain/scene-state";
import {
  buildContextInputSchema,
  contextContentSchema,
  contextSnapshotSchema as domainContextSnapshotSchema,
  type BuildContextInput,
  type ContextContent,
  type ContextPolicyId,
  type ContextPurpose,
  type ContextSnapshot,
} from "@/domain/context-builder";
import {
  approveStoryboardInputSchema,
  createStoryboardInputSchema,
  storyboardSchema,
  type ApproveStoryboardInput,
  type CreateStoryboardInput,
  type Storyboard,
  type StoryboardStatus,
} from "@/domain/storyboard";

export type { ContinuityGroup, ContinuityGroupKind, CreateContinuityGroupInput, ProposeStatePatchInput, StatePatchPayload } from "@/domain/scene-state";
export type { BuildContextInput, ContextContent, ContextEntity, ContextPolicyId, ContextPurpose, ContextSnapshot } from "@/domain/context-builder";

export type WorkspaceFieldErrors = Record<string, string[]>;

export type WorkspaceErrorPayload = {
  code: string;
  message: string;
  fieldErrors?: WorkspaceFieldErrors;
  retryable?: boolean;
  details?: unknown;
  currentChapter?: unknown;
  currentAdaptation?: unknown;
  currentPatch?: unknown;
  currentStoryboard?: unknown;
  patch?: unknown;
  consumedBy?: "chapter" | "adaptation";
};

/**
 * The review query is intentionally a read model rather than a new domain
 * aggregate. The API has used both `run` and `analysisRun` while Phase 1 was
 * being wired, so the parser accepts either without weakening validation of
 * the records inside the read model.
 */
export type SceneEntityReview = {
  analysisRun: AnalysisRun | null;
  mentions: EntityMention[];
  links: SceneEntityLink[];
  entities: Entity[];
  aliases: EntityAlias[];
  evidenceSources: EvidenceSource[];
};

/** Phase 2 read model for a single immutable SceneRevision. */
export type ScenePatchReview = {
  patches: WorkspacePatch[];
  inferences: Inference[];
  modelRuns: ModelRun[];
  evidenceSources: EvidenceSource[];
  applications: WorkspacePatchApplication[];
  facts: Fact[];
  states: EntityState[];
};

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const strictContinuityGroupSchema = continuityGroupSchema.strict();

export type WorkspaceSceneRevision = SceneRevision & {
  continuityGroupId: string;
};

export type WorkspaceDocumentRevision = Omit<DocumentRevision, "sceneRevisions"> & {
  sceneRevisions: WorkspaceSceneRevision[];
};

export type WorkspaceRevisionSceneInput = NonNullable<CreateDocumentRevisionInput["scenes"]>[number] & {
  continuityGroupId?: string;
};

export type CreateWorkspaceDocumentRevisionInput = Omit<CreateDocumentRevisionInput, "scenes"> & {
  scenes: WorkspaceRevisionSceneInput[];
};

export type StatePredicate = SceneStatePredicate;
export const statePredicateSchema = sceneStatePredicateSchema;

export type StatePatch = Omit<Patch, "operation" | "payload" | "targetEntityId" | "targetFactId" | "baseVersion"> & {
  operation: "add_state";
  targetEntityId: string;
  targetFactId: null;
  baseVersion: number;
  payload: StatePatchPayload;
};

export type WorkspacePatch = Patch | StatePatch;

export type StatePatchApplication = Omit<PatchApplication, "operation" | "resultingFactId" | "resultingStateId"> & {
  operation: "add_state";
  resultingFactId: null;
  resultingStateId: string;
};

export type WorkspacePatchApplication = PatchApplication | StatePatchApplication;

export type StatePatchProposalInput = ProposeStatePatchInput;

export type ResolvedStateTier = "explicit" | "carried" | "base" | "missing" | "conflict";

export type ResolvedState = ResolvedStateResponse;
export type ResolvedStateEntity = ResolvedStateResponse["entities"][number];
export type ResolvedStateField = ResolvedStateEntity["fields"][number];
export type ResolvedStateSource = ResolvedStateField["sources"][number];

export type ContextSnapshotContent = ContextContent;
export type ContextBuildInput = BuildContextInput;
export const contextSnapshotContentSchema = contextContentSchema;
export const contextBuildInputSchema = buildContextInputSchema;
export const contextSnapshotSchema = domainContextSnapshotSchema;

export type ContextBuildResult = {
  snapshot: ContextSnapshot;
  idempotent: boolean;
};

export type StoryboardMutationResult = {
  storyboard: Storyboard;
  idempotent: boolean;
};

export type ListStoryboardsOptions = {
  contextSnapshotId?: string;
  status?: StoryboardStatus;
};

export type ListContextSnapshotsOptions = {
  sceneId: string;
  sceneRevisionId: string;
  purpose: ContextPurpose;
  policyId: ContextPolicyId;
  latest: boolean;
};

export type PatchProposalResult = {
  patch: WorkspacePatch;
  inference: Inference | null;
  modelRun: ModelRun | null;
  idempotent: boolean;
};

export type PatchAcceptanceResult = {
  patch: WorkspacePatch;
  fact: Fact | null;
  state?: EntityState | null;
  application: WorkspacePatchApplication | null;
  idempotent: boolean;
};

export type PatchRejectionResult = {
  patch: WorkspacePatch;
  idempotent: boolean;
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

function rawCurrentPatch(payload: WorkspaceErrorPayload) {
  if (payload.currentPatch !== undefined) return payload.currentPatch;
  if (payload.patch !== undefined) return payload.patch;
  if (isRecord(payload.details)) {
    if ("currentPatch" in payload.details) return payload.details.currentPatch;
    if ("patch" in payload.details) return payload.details.patch;
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
  readonly currentPatch: Patch | null;
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
    const parsedPatch = patchSchema.safeParse(rawCurrentPatch(payload));
    this.currentPatch = parsedPatch.success ? parsedPatch.data : null;
    this.consumedBy = payload.consumedBy === "chapter" || payload.consumedBy === "adaptation" ? payload.consumedBy : null;
    const withChapter = payload.currentChapter !== undefined
      ? detailsWithCurrentChapter(payload.details, payload.currentChapter)
      : payload.details;
    this.details = payload.currentAdaptation !== undefined
      ? detailsWithCurrentAdaptation(withChapter, payload.currentAdaptation)
      : withChapter;
    if (payload.currentPatch !== undefined || payload.patch !== undefined) {
      this.details = isRecord(this.details)
        ? { ...this.details, currentPatch: payload.currentPatch ?? payload.patch }
        : { value: this.details, currentPatch: payload.currentPatch ?? payload.patch };
    }
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

function parseScriptDocument(value: unknown) {
  const parsed = scriptDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("script document response");
  }
  return parsed.data;
}

function parseScriptDocumentEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("script document response");
  }
  return parseScriptDocument(value.document);
}

function parseScriptDocumentList(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("script document list response");
  }
  const parsed = z.array(scriptDocumentSchema).safeParse(value.documents);
  if (!parsed.success) {
    throw invalidDataError("script document list response");
  }
  return parsed.data;
}

export function parseContinuityGroup(value: unknown): ContinuityGroup {
  const parsed = strictContinuityGroupSchema.safeParse(value);
  if (!parsed.success) throw invalidDataError("continuity group response");
  return parsed.data;
}

function parseContinuityGroupEnvelope(value: unknown) {
  if (!isRecord(value)) throw invalidDataError("continuity group response");
  return parseContinuityGroup(value.continuityGroup);
}

export function parseContinuityGroupList(value: unknown) {
  if (!isRecord(value)) throw invalidDataError("continuity group list response");
  const parsed = z.array(strictContinuityGroupSchema).safeParse(value.continuityGroups);
  if (!parsed.success) throw invalidDataError("continuity group list response");
  return parsed.data;
}

function parseDocumentRevision(value: unknown) {
  const parsed = documentRevisionSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("document revision response");
  }
  return parsed.data as WorkspaceDocumentRevision;
}

function parseDocumentRevisionEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("document revision response");
  }
  return parseDocumentRevision(value.revision);
}

function parseAnalysisRun(value: unknown) {
  const parsed = analysisRunSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("analysis run response");
  }
  return parsed.data;
}

function parseAnalysisRunEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("analysis run response");
  }
  return parseAnalysisRun(value.analysisRun ?? value.run ?? value);
}

function parseEntity(value: unknown) {
  const parsed = entitySchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("entity response");
  }
  return parsed.data;
}

function parseEntityEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("entity response");
  }
  return parseEntity(value.entity);
}

function parseEntityList(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("entity list response");
  }
  const parsed = z.array(entitySchema).safeParse(value.entities);
  if (!parsed.success) {
    throw invalidDataError("entity list response");
  }
  return parsed.data;
}

function parseEntityAlias(value: unknown) {
  const parsed = entityAliasSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("entity alias response");
  }
  return parsed.data;
}

function parseEntityAliasEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("entity alias response");
  }
  return parseEntityAlias(value.alias);
}

function parseSceneEntityLink(value: unknown) {
  const parsed = sceneEntityLinkSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidDataError("scene entity link response");
  }
  return parsed.data;
}

function parseSceneEntityLinkEnvelope(value: unknown) {
  if (!isRecord(value)) {
    throw invalidDataError("scene entity link response");
  }
  return parseSceneEntityLink(value.link ?? value.entityLink);
}

function parseSceneEntityReview(value: unknown): SceneEntityReview {
  if (!isRecord(value)) {
    throw invalidDataError("scene entity review response");
  }

  const review = isRecord(value.review) ? value.review : value;
  const runValue = review.analysisRun ?? review.run;
  const parsedRuns = z.array(analysisRunSchema).safeParse(review.runs ?? []);
  if (!parsedRuns.success) {
    throw invalidDataError("scene entity review response");
  }
  const run = runValue === null || runValue === undefined
    ? (parsedRuns.data[0] ?? null)
    : parseAnalysisRun(runValue);
  const mentions = z.array(entityMentionSchema).safeParse(review.mentions ?? review.entityMentions ?? []);
  const links = z.array(sceneEntityLinkSchema).safeParse(review.links ?? review.entityLinks ?? []);
  const entities = z.array(entitySchema).safeParse(review.entities ?? []);
  const aliases = z.array(entityAliasSchema).safeParse(review.aliases ?? review.entityAliases ?? []);
  const evidenceSources = z.array(evidenceSourceSchema).safeParse(review.evidenceSources ?? review.evidence ?? []);

  if (!mentions.success || !links.success || !entities.success || !aliases.success || !evidenceSources.success) {
    throw invalidDataError("scene entity review response");
  }

  return {
    analysisRun: run,
    mentions: mentions.data,
    links: links.data,
    entities: entities.data,
    aliases: aliases.data,
    evidenceSources: evidenceSources.data,
  };
}

const statePatchSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  operation: z.literal("add_state"),
  targetEntityId: uuidSchema,
  targetFactId: z.null(),
  baseVersion: z.number().int().positive(),
  payload: statePatchPayloadSchema,
  truthClass: z.literal("canon"),
  evidenceSourceIds: z.array(uuidSchema),
  confidence: z.number().min(0).max(1).nullable(),
  conflictKind: z.enum(["none", "possible", "hard"]),
  conflictingFactIds: z.array(uuidSchema),
  conflictingStateIds: z.array(uuidSchema),
  conflictMessage: z.string().nullable(),
  sourceRevisionId: uuidSchema,
  inferenceId: uuidSchema.nullable(),
  modelRunId: uuidSchema.nullable(),
  status: z.enum(["pending", "accepted", "rejected", "expired", "superseded"]),
  proposedBy: z.enum(["rule", "model", "user", "import"]),
  version: z.number().int().positive(),
  createdAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
  resolvedByUserId: z.string().nullable(),
}).strict();

const statePatchApplicationSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  patchId: uuidSchema,
  operation: z.literal("add_state"),
  resultingFactId: z.null(),
  resultingStateId: uuidSchema,
  appliedPayload: z.record(z.string(), z.unknown()),
  requestId: z.string().min(1),
  createdAt: timestampSchema,
}).strict();

function parseWorkspacePatch(value: unknown): WorkspacePatch {
  const parsed = isRecord(value) && value.operation === "add_state"
    ? statePatchSchema.safeParse(value)
    : patchSchema.safeParse(value);
  if (!parsed.success) throw invalidDataError("patch response");
  return parsed.data as WorkspacePatch;
}

function parseWorkspacePatchList(value: unknown): WorkspacePatch[] {
  if (!Array.isArray(value)) throw invalidDataError("patch list response");
  return value.map((patch) => parseWorkspacePatch(patch));
}

function parseWorkspacePatchApplication(value: unknown): WorkspacePatchApplication {
  const parsed = isRecord(value) && value.operation === "add_state"
    ? statePatchApplicationSchema.safeParse(value)
    : patchApplicationSchema.safeParse(value);
  if (!parsed.success) throw invalidDataError("patch application response");
  return parsed.data as WorkspacePatchApplication;
}

function parseWorkspacePatchApplicationList(value: unknown): WorkspacePatchApplication[] {
  if (!Array.isArray(value)) throw invalidDataError("patch application list response");
  return value.map((application) => parseWorkspacePatchApplication(application));
}

function parseEntityState(value: unknown): EntityState {
  const parsed = entityStateSchema.safeParse(value);
  if (!parsed.success) throw invalidDataError("entity state response");
  return parsed.data;
}

export function parseScenePatchReview(value: unknown): ScenePatchReview {
  if (!isRecord(value)) throw invalidDataError("scene patch review response");
  const review = isRecord(value.review) ? value.review : value;
  const patches = (() => {
    try {
      return { success: true as const, data: parseWorkspacePatchList(review.patches ?? review.pendingPatches ?? []) };
    } catch {
      return { success: false as const };
    }
  })();
  const inferences = z.array(inferenceSchema).safeParse(review.inferences ?? []);
  const modelRuns = z.array(modelRunSchema).safeParse(review.modelRuns ?? review.runs ?? []);
  const evidenceSources = z.array(evidenceSourceSchema).safeParse(review.evidenceSources ?? review.evidence ?? []);
  const applications = (() => {
    try {
      return { success: true as const, data: parseWorkspacePatchApplicationList(review.applications ?? review.patchApplications ?? []) };
    } catch {
      return { success: false as const };
    }
  })();
  const facts = z.array(factSchema).safeParse(review.facts ?? []);
  const states = z.array(entityStateSchema).safeParse(review.states);
  if (!patches.success || !inferences.success || !modelRuns.success || !evidenceSources.success || !applications.success || !facts.success || !states.success) {
    throw invalidDataError("scene patch review response");
  }
  return { patches: patches.data, inferences: inferences.data, modelRuns: modelRuns.data, evidenceSources: evidenceSources.data, applications: applications.data, facts: facts.data, states: states.data };
}

function parsePatch(value: unknown) {
  return parseWorkspacePatch(value);
}

export function parsePatchEnvelope(value: unknown) {
  if (!isRecord(value)) throw invalidDataError("patch response");
  return parsePatch(value.patch ?? value);
}

function parsePatchList(value: unknown) {
  if (!isRecord(value)) throw invalidDataError("patch list response");
  return parseWorkspacePatchList(value.patches ?? value.pendingPatches ?? []);
}

function parsePatchProposalResult(value: unknown): PatchProposalResult {
  if (!isRecord(value)) throw invalidDataError("patch proposal response");
  const patch = parsePatch(value.patch);
  const inference = value.inference === null || value.inference === undefined ? null : (() => {
    const parsed = inferenceSchema.safeParse(value.inference);
    if (!parsed.success) throw invalidDataError("patch proposal inference response");
    return parsed.data;
  })();
  const modelRun = value.modelRun === null || value.modelRun === undefined ? null : (() => {
    const parsed = modelRunSchema.safeParse(value.modelRun);
    if (!parsed.success) throw invalidDataError("patch proposal model run response");
    return parsed.data;
  })();
  if (typeof value.idempotent !== "boolean") throw invalidDataError("patch proposal response");
  return { patch, inference, modelRun, idempotent: value.idempotent };
}

function parsePatchAcceptanceResult(value: unknown): PatchAcceptanceResult {
  if (!isRecord(value)) throw invalidDataError("patch acceptance response");
  const patch = parsePatch(value.patch);
  const fact = value.fact === null || value.fact === undefined ? null : (() => {
    const parsed = factSchema.safeParse(value.fact);
    if (!parsed.success) throw invalidDataError("patch acceptance fact response");
    return parsed.data;
  })();
  const application = value.application === null || value.application === undefined ? null : (() => {
    return parseWorkspacePatchApplication(value.application);
  })();
  if ("resultingState" in value) throw invalidDataError("patch acceptance response");
  const state = value.state === null || value.state === undefined ? null : parseEntityState(value.state);
  if (typeof value.idempotent !== "boolean") throw invalidDataError("patch acceptance response");
  return state ? { patch, fact, state, application, idempotent: value.idempotent } : { patch, fact, application, idempotent: value.idempotent };
}

function parsePatchRejectionResult(value: unknown): PatchRejectionResult {
  if (!isRecord(value)) throw invalidDataError("patch rejection response");
  if (Object.keys(value).some((key) => key !== "patch" && key !== "idempotent")) throw invalidDataError("patch rejection response");
  const patch = parsePatch(value.patch);
  if (typeof value.idempotent !== "boolean") throw invalidDataError("patch rejection response");
  return { patch, idempotent: value.idempotent };
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

function projectQuery(projectId: string) {
  return `projectId=${encodeURIComponent(projectId)}`;
}

export async function listScriptDocuments(projectId: string): Promise<ScriptDocument[]> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/documents`);
  return parseScriptDocumentList(result);
}

/** Backwards-friendly alias for callers that use the shorter domain name. */
export const listDocuments = listScriptDocuments;

export async function createScriptDocument(projectId: string, input: CreateScriptDocumentInput): Promise<ScriptDocument> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseScriptDocumentEnvelope(result);
}

export const createDocument = createScriptDocument;

export async function listContinuityGroups(projectId: string, documentId: string): Promise<ContinuityGroup[]> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/continuity-groups`);
  return parseContinuityGroupList(result);
}

export async function createContinuityGroup(projectId: string, documentId: string, input: CreateContinuityGroupInput): Promise<ContinuityGroup> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/continuity-groups`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseContinuityGroupEnvelope(result);
}

export async function getScriptDocument(projectId: string, documentId: string): Promise<ScriptDocument> {
  const result = await requestData<unknown>(`/api/documents/${encodeURIComponent(documentId)}?${projectQuery(projectId)}`);
  return parseScriptDocumentEnvelope(result);
}

export const getDocument = getScriptDocument;

export async function getDocumentRevision(projectId: string, documentId: string, revisionId: string): Promise<DocumentRevision> {
  const result = await requestData<unknown>(`/api/documents/${encodeURIComponent(documentId)}/revisions/${encodeURIComponent(revisionId)}?${projectQuery(projectId)}`);
  return parseDocumentRevisionEnvelope(result);
}

export const getScriptDocumentRevision = getDocumentRevision;

export async function createDocumentRevision(projectId: string, documentId: string, input: CreateWorkspaceDocumentRevisionInput): Promise<WorkspaceDocumentRevision> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/revisions`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseDocumentRevisionEnvelope(result);
}

export const saveDocumentRevision = createDocumentRevision;

export async function listEntities(projectId: string): Promise<Entity[]> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/entities`);
  return parseEntityList(result);
}

export async function createEntity(projectId: string, input: CreateEntityInput): Promise<Entity> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/entities`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseEntityEnvelope(result);
}

export async function createEntityAlias(projectId: string, entityId: string, input: CreateEntityAliasInput): Promise<EntityAlias> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/entities/${encodeURIComponent(entityId)}/aliases`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseEntityAliasEnvelope(result);
}

export async function getSceneEntityReview(projectId: string, sceneId: string, sceneRevisionId: string): Promise<SceneEntityReview> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/entity-review?${projectQuery(projectId)}&sceneRevisionId=${encodeURIComponent(sceneRevisionId)}`);
  return parseSceneEntityReview(result);
}

export async function enqueueAnalysis(projectId: string, input: EnqueueAnalysisInput): Promise<AnalysisRun> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(input.sceneId)}/analysis-runs`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseAnalysisRunEnvelope(result);
}

export const enqueueAnalysisRun = enqueueAnalysis;

export async function executeAnalysis(projectId: string, runId: string, input: ExecuteAnalysisInput = {}): Promise<AnalysisRun> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/analysis/runs/${encodeURIComponent(runId)}/execute`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parseAnalysisRunEnvelope(result);
}

export const executeAnalysisRun = executeAnalysis;

export async function reviewSceneEntityLink(projectId: string, sceneId: string, linkId: string, input: ReviewSceneEntityLinkInput): Promise<SceneEntityLink> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/entity-links/${encodeURIComponent(linkId)}`, {
    method: "PATCH",
    ...jsonBody(input),
  });
  return parseSceneEntityLinkEnvelope(result);
}

export const updateSceneEntityLink = reviewSceneEntityLink;

export async function getScenePatchReview(projectId: string, sceneId: string, sceneRevisionId: string): Promise<ScenePatchReview> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/patch-review?sceneRevisionId=${encodeURIComponent(sceneRevisionId)}`);
  return parseScenePatchReview(result);
}

export type ListPatchesOptions = {
  status?: Patch["status"];
  sceneRevisionId?: string;
  targetEntityId?: string;
};

export async function listPatches(projectId: string, options: ListPatchesOptions = {}): Promise<WorkspacePatch[]> {
  const query = new URLSearchParams();
  if (options.status) query.set("status", options.status);
  if (options.sceneRevisionId) query.set("sceneRevisionId", options.sceneRevisionId);
  if (options.targetEntityId) query.set("targetEntityId", options.targetEntityId);
  const suffix = query.toString();
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/patches${suffix ? `?${suffix}` : ""}`);
  return parsePatchList(result);
}

export async function proposeFactPatch(projectId: string, sceneId: string, input: ProposeFactPatchInput): Promise<PatchProposalResult> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/fact-patches`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parsePatchProposalResult(result);
}

export async function proposeStatePatch(projectId: string, sceneId: string, input: StatePatchProposalInput): Promise<PatchProposalResult> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/state-patches`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parsePatchProposalResult(result);
}

export function parseResolvedState(value: unknown): ResolvedState {
  const parsed = resolvedStateResponseSchema.safeParse(value);
  if (!parsed.success) throw invalidDataError("resolved state response");
  return parsed.data;
}

export function parseContextSnapshot(value: unknown): ContextSnapshot {
  const parsed = contextSnapshotSchema.safeParse(value);
  if (!parsed.success) throw invalidDataError("context snapshot response");
  return parsed.data;
}

export function parseContextSnapshotEnvelope(value: unknown): ContextSnapshot {
  const parsed = z.object({ snapshot: contextSnapshotSchema }).strict().safeParse(value);
  if (!parsed.success) throw invalidDataError("context snapshot response");
  return parsed.data.snapshot;
}

export function parseContextBuildResult(value: unknown): ContextBuildResult {
  const parsed = z.object({ snapshot: contextSnapshotSchema, idempotent: z.boolean() }).strict().safeParse(value);
  if (!parsed.success) throw invalidDataError("context build response");
  return parsed.data;
}

export function parseContextSnapshotList(value: unknown): ContextSnapshot[] {
  const parsed = z.object({ snapshots: z.array(contextSnapshotSchema) }).strict().safeParse(value);
  if (!parsed.success) throw invalidDataError("context snapshot list response");
  return parsed.data.snapshots;
}

export function parseStoryboard(value: unknown): Storyboard {
  const parsed = storyboardSchema.safeParse(value);
  if (!parsed.success) throw invalidDataError("storyboard response");
  return parsed.data;
}

export function parseStoryboardEnvelope(value: unknown): Storyboard {
  const parsed = z.object({ storyboard: storyboardSchema }).strict().safeParse(value);
  if (!parsed.success) throw invalidDataError("storyboard response");
  return parsed.data.storyboard;
}

export function parseStoryboardMutationResult(value: unknown): StoryboardMutationResult {
  const parsed = z.object({ storyboard: storyboardSchema, idempotent: z.boolean() }).strict().safeParse(value);
  if (!parsed.success) throw invalidDataError("storyboard mutation response");
  return parsed.data;
}

export function parseStoryboardList(value: unknown): Storyboard[] {
  const parsed = z.object({ storyboards: z.array(storyboardSchema) }).strict().safeParse(value);
  if (!parsed.success) throw invalidDataError("storyboard list response");
  return parsed.data.storyboards;
}

/** Build a provider-neutral, immutable Context Snapshot for one saved Scene revision. */
export async function buildContextSnapshot(projectId: string, input: ContextBuildInput): Promise<ContextBuildResult> {
  const parsedInput = contextBuildInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new WorkspaceApiError(400, {
      code: "VALIDATION_ERROR",
      message: "The context build request is invalid.",
      fieldErrors: parsedInput.error.flatten().fieldErrors as WorkspaceFieldErrors,
      retryable: false,
    });
  }
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/contexts/build`, {
    method: "POST",
    ...jsonBody(parsedInput.data),
  });
  return parseContextBuildResult(result);
}

/** Backwards-friendly alias used by workspace callers. */
export const buildContext = buildContextSnapshot;

export async function listContextSnapshots(projectId: string, options: ListContextSnapshotsOptions): Promise<ContextSnapshot[]> {
  const query = new URLSearchParams();
  query.set("sceneId", options.sceneId);
  query.set("sceneRevisionId", options.sceneRevisionId);
  query.set("purpose", options.purpose);
  query.set("policyId", options.policyId);
  query.set("latest", String(options.latest));
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/contexts?${query.toString()}`);
  return parseContextSnapshotList(result);
}

export async function getContextSnapshot(projectId: string, contextId: string): Promise<ContextSnapshot> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/contexts/${encodeURIComponent(contextId)}`);
  return parseContextSnapshotEnvelope(result);
}

export async function createStoryboard(projectId: string, sceneId: string, input: CreateStoryboardInput): Promise<StoryboardMutationResult> {
  const parsedInput = createStoryboardInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new WorkspaceApiError(400, {
      code: "VALIDATION_ERROR",
      message: "The storyboard request is invalid.",
      fieldErrors: parsedInput.error.flatten().fieldErrors as WorkspaceFieldErrors,
      retryable: false,
    });
  }
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/storyboards`, {
    method: "POST",
    ...jsonBody(parsedInput.data),
  });
  return parseStoryboardMutationResult(result);
}

export async function listStoryboards(projectId: string, sceneId: string, options: ListStoryboardsOptions = {}): Promise<Storyboard[]> {
  const query = new URLSearchParams();
  if (options.contextSnapshotId) query.set("contextSnapshotId", options.contextSnapshotId);
  if (options.status) query.set("status", options.status);
  const suffix = query.toString();
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/storyboards${suffix ? `?${suffix}` : ""}`);
  return parseStoryboardList(result);
}

export async function getStoryboard(projectId: string, storyboardId: string): Promise<Storyboard> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/storyboards/${encodeURIComponent(storyboardId)}`);
  return parseStoryboardEnvelope(result);
}

export async function approveStoryboard(projectId: string, storyboardId: string, input: ApproveStoryboardInput): Promise<StoryboardMutationResult> {
  const parsedInput = approveStoryboardInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new WorkspaceApiError(400, {
      code: "VALIDATION_ERROR",
      message: "The storyboard approval request is invalid.",
      fieldErrors: parsedInput.error.flatten().fieldErrors as WorkspaceFieldErrors,
      retryable: false,
    });
  }
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/storyboards/${encodeURIComponent(storyboardId)}/approve`, {
    method: "POST",
    ...jsonBody(parsedInput.data),
  });
  return parseStoryboardMutationResult(result);
}

export async function getResolvedState(projectId: string, sceneId: string, options: { sceneRevisionId: string; entityId?: string }): Promise<ResolvedState> {
  const query = new URLSearchParams({ sceneRevisionId: options.sceneRevisionId });
  if (options.entityId) query.set("entityId", options.entityId);
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/resolved-state?${query.toString()}`);
  return parseResolvedState(result);
}

export async function acceptPatch(projectId: string, patchId: string, input: AcceptPatchInput): Promise<PatchAcceptanceResult> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/patches/${encodeURIComponent(patchId)}/accept`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parsePatchAcceptanceResult(result);
}

export async function acceptEditedPatch(projectId: string, patchId: string, input: AcceptEditedPatchInput): Promise<PatchAcceptanceResult> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/patches/${encodeURIComponent(patchId)}/accept-edited`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parsePatchAcceptanceResult(result);
}

export async function rejectPatch(projectId: string, patchId: string, input: RejectPatchInput): Promise<PatchRejectionResult> {
  const result = await requestData<unknown>(`/api/projects/${encodeURIComponent(projectId)}/patches/${encodeURIComponent(patchId)}/reject`, {
    method: "POST",
    ...jsonBody(input),
  });
  return parsePatchRejectionResult(result);
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
