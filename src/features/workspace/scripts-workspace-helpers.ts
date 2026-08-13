import type { Entity, FactValueType } from "@/domain/story-bible";
import { isSceneStatePredicate } from "@/domain/story-bible";
import type { ScriptDocument } from "@/domain/document";
import type { Inference } from "@/domain/inference";
import type { Fact } from "@/domain/story-bible";
import type { Patch, PatchApplication, PatchConflictKind, PatchStatus } from "@/domain/canon-patch";

export type AnalysisSelection = {
  sceneId: string;
  sceneRevisionId: string;
};

/** A revision is part of the key: the same Scene can have many analyses. */
export function analysisSelectionKey(selection: AnalysisSelection) {
  return `${selection.sceneId}:${selection.sceneRevisionId}`;
}

export const analysisKey = analysisSelectionKey;

export function sameAnalysisSelection(left: AnalysisSelection | null | undefined, right: AnalysisSelection | null | undefined) {
  return Boolean(left && right && left.sceneId === right.sceneId && left.sceneRevisionId === right.sceneRevisionId);
}

/**
 * Guards every async analysis response before it reaches React state. A late
 * response from another Scene or revision is stale even if the request itself
 * completed successfully.
 */
export function isCurrentAnalysisResponse(current: AnalysisSelection | null | undefined, response: AnalysisSelection) {
  return sameAnalysisSelection(current, response);
}

export function isStaleAnalysisResponse(current: AnalysisSelection | null | undefined, response: AnalysisSelection) {
  return !isCurrentAnalysisResponse(current, response);
}

export const shouldApplyAnalysisResponse = isCurrentAnalysisResponse;

export type WorkspaceRevisionSelection = {
  projectId: string;
  documentId: string;
  sceneId: string;
  sceneRevisionId: string;
  entityId?: string | null;
};

export type ContextSelection = Omit<WorkspaceRevisionSelection, "entityId"> & {
  purpose: "storyboard" | "video";
  policyId: "storyboard-default-v1" | "video-default-v1";
};

/** Phase 3 requests are scoped beyond a Scene because document lanes can
 * reuse stable scene IDs across revisions and projects. */
export function workspaceRevisionSelectionKey(selection: WorkspaceRevisionSelection) {
  return [selection.projectId, selection.documentId, selection.sceneId, selection.sceneRevisionId, selection.entityId ?? "all"].join(":");
}

export function contextSelectionKey(selection: ContextSelection) {
  return [workspaceRevisionSelectionKey(selection), selection.purpose, selection.policyId].join(":");
}

export function sameContextSelection(left: ContextSelection | null | undefined, right: ContextSelection | null | undefined) {
  return Boolean(left && right && contextSelectionKey(left) === contextSelectionKey(right));
}

export function isCurrentContextResponse(current: ContextSelection | null | undefined, response: ContextSelection) {
  return sameContextSelection(current, response);
}

export function isStaleContextResponse(current: ContextSelection | null | undefined, response: ContextSelection) {
  return !isCurrentContextResponse(current, response);
}

export type StoryboardSelection = {
  projectId: string;
  sceneId: string;
  sceneRevisionId: string;
  contextSnapshotId: string;
};

export type StoryboardBoardSelection = StoryboardSelection & {
  storyboardId: string;
};

export function storyboardSelectionKey(selection: StoryboardSelection) {
  return [selection.projectId, selection.sceneId, selection.sceneRevisionId, selection.contextSnapshotId].join(":");
}

export function sameStoryboardSelection(left: StoryboardSelection | null | undefined, right: StoryboardSelection | null | undefined) {
  return Boolean(left && right && storyboardSelectionKey(left) === storyboardSelectionKey(right));
}

/** Ignore a Storyboard list response after the Context Snapshot/Scene changes. */
export function isCurrentStoryboardResponse(current: StoryboardSelection | null | undefined, response: StoryboardSelection) {
  return sameStoryboardSelection(current, response);
}

export function isStaleStoryboardResponse(current: StoryboardSelection | null | undefined, response: StoryboardSelection) {
  return !isCurrentStoryboardResponse(current, response);
}

export function storyboardBoardSelectionKey(selection: StoryboardBoardSelection) {
  return `${storyboardSelectionKey(selection)}:${selection.storyboardId}`;
}

export function sameStoryboardBoardSelection(left: StoryboardBoardSelection | null | undefined, right: StoryboardBoardSelection | null | undefined) {
  return Boolean(left && right && storyboardBoardSelectionKey(left) === storyboardBoardSelectionKey(right));
}

/** Detail responses additionally carry the board ID so a late load cannot replace another board. */
export function isCurrentStoryboardBoardResponse(current: StoryboardBoardSelection | null | undefined, response: StoryboardBoardSelection) {
  return sameStoryboardBoardSelection(current, response);
}

export function isStaleStoryboardBoardResponse(current: StoryboardBoardSelection | null | undefined, response: StoryboardBoardSelection) {
  return !isCurrentStoryboardBoardResponse(current, response);
}

/** Phase 5B compilation reads and mutations are bound to the exact ShotSpec. */
export type CompilationSelection = StoryboardBoardSelection & {
  shotSpecId: string;
};

export function compilationSelectionKey(selection: CompilationSelection) {
  return `${storyboardBoardSelectionKey(selection)}:${selection.shotSpecId}`;
}

export const compileSelectionKey = compilationSelectionKey;

export function sameCompilationSelection(left: CompilationSelection | null | undefined, right: CompilationSelection | null | undefined) {
  return Boolean(left && right && compilationSelectionKey(left) === compilationSelectionKey(right));
}

export function isCurrentCompilationResponse(current: CompilationSelection | null | undefined, response: CompilationSelection) {
  return sameCompilationSelection(current, response);
}

export function isStaleCompilationResponse(current: CompilationSelection | null | undefined, response: CompilationSelection) {
  return !isCurrentCompilationResponse(current, response);
}

/** Phase 5C actions are bound to the immutable compiled request as well as the Shot selection. */
export type GenerationSelection = CompilationSelection & {
  compiledRequestId: string;
};

export function generationSelectionKey(selection: GenerationSelection) {
  return `${compilationSelectionKey(selection)}:${selection.compiledRequestId}`;
}

export function sameGenerationSelection(left: GenerationSelection | null | undefined, right: GenerationSelection | null | undefined) {
  return Boolean(left && right && generationSelectionKey(left) === generationSelectionKey(right));
}

export function isCurrentGenerationResponse(current: GenerationSelection | null | undefined, response: GenerationSelection) {
  return sameGenerationSelection(current, response);
}

export function isStaleGenerationResponse(current: GenerationSelection | null | undefined, response: GenerationSelection) {
  return !isCurrentGenerationResponse(current, response);
}

/**
 * A compiled preview is only valid for the exact immutable Shot selection and
 * the input values that produced it. Asset refreshes can auto-select metadata,
 * so reference IDs belong in this render key too.
 */
export function compilationInputKey(
  selection: CompilationSelection | null | undefined,
  referenceAssetIds: readonly string[],
  durationInput: string,
  aspectInput: string,
) {
  const selectionKey = selection ? compilationSelectionKey(selection) : "none";
  return [selectionKey, referenceAssetIds.join(","), durationInput, aspectInput].join("|");
}

/** Defaults for a newly selected immutable Shot; overrides never cross Shots. */
export function compilationInputDefaults(durationSeconds: number | null | undefined) {
  return {
    durationInput: durationSeconds === null || durationSeconds === undefined ? "" : String(durationSeconds),
    aspectInput: "16:9",
  };
}

export function sameWorkspaceRevisionSelection(left: WorkspaceRevisionSelection | null | undefined, right: WorkspaceRevisionSelection | null | undefined) {
  return Boolean(left && right
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.sceneId === right.sceneId
    && left.sceneRevisionId === right.sceneRevisionId
    && (left.entityId ?? null) === (right.entityId ?? null));
}

export function isCurrentWorkspaceRevisionResponse(current: WorkspaceRevisionSelection | null | undefined, response: WorkspaceRevisionSelection) {
  return sameWorkspaceRevisionSelection(current, response);
}

export function isStaleWorkspaceRevisionResponse(current: WorkspaceRevisionSelection | null | undefined, response: WorkspaceRevisionSelection) {
  return !isCurrentWorkspaceRevisionResponse(current, response);
}

export function stateTierLabel(tier: "explicit" | "carried" | "base" | "missing" | "conflict") {
  if (tier === "explicit") return "Explicit Scene State";
  if (tier === "carried") return "Carried State";
  if (tier === "base") return "Base Canon fallback";
  if (tier === "conflict") return "Blocking conflict";
  return "Missing";
}

export function statePredicateLabel(predicate: string) {
  if (predicate === "wardrobe.current") return "Current wardrobe";
  if (predicate === "state.injury") return "Injury state";
  if (predicate === "state.held_prop") return "Held props";
  return predicate;
}

/** Fact proposals must not expose the dedicated Scene State predicates. */
export function isFactPredicate(predicate: string) {
  return !isSceneStatePredicate(predicate);
}

/**
 * Replace a server-canonical record without losing its stable list position;
 * append is useful for a newly-created record that was not in the list yet.
 */
export function replaceCanonicalRecord<T extends { id: string }>(records: readonly T[], canonical: T) {
  const index = records.findIndex((record) => record.id === canonical.id);
  if (index < 0) return [...records, canonical];
  return records.map((record, recordIndex) => recordIndex === index ? canonical : record);
}

export function replaceCanonicalScriptDocument(documents: readonly ScriptDocument[], canonical: ScriptDocument) {
  return replaceCanonicalRecord(documents, canonical);
}

export function replaceCanonicalEntity(entities: readonly Entity[], canonical: Entity) {
  return replaceCanonicalRecord(entities, canonical);
}

/**
 * Phase 2 review is keyed by the immutable scene revision as well as the
 * stable Scene ID.  This prevents a late patch read or mutation response from
 * being rendered over a newly selected revision.
 */
export type PatchSelection = AnalysisSelection;

export type PatchReviewRecord = {
  patches: readonly Patch[];
  inferences: readonly Inference[];
};

export type PatchAction = "accept" | "accept-edit" | "reject";

export function patchSelectionKey(selection: PatchSelection) {
  return analysisSelectionKey(selection);
}

export const isCurrentPatchResponse = isCurrentAnalysisResponse;
export const isStalePatchResponse = isStaleAnalysisResponse;

export function replaceCanonicalPatch(patches: readonly Patch[], canonical: Patch) {
  return replaceCanonicalRecord(patches, canonical);
}

export function replaceCanonicalInference(inferences: readonly Inference[], canonical: Inference) {
  return replaceCanonicalRecord(inferences, canonical);
}

export function patchConflictLabel(kind: PatchConflictKind) {
  if (kind === "hard") return "Hard conflict";
  if (kind === "possible") return "Possible conflict";
  return "No conflict";
}

/** A hard conflict always requires an explicit resolution outside this action. */
export function canAcceptPatch(patch: Pick<Patch, "status" | "conflictKind">) {
  return patch.status === "pending" && patch.conflictKind !== "hard";
}

export function patchStatusLabel(status: PatchStatus) {
  if (status === "pending") return "Pending Patch";
  if (status === "accepted") return "Canon applied";
  if (status === "rejected") return "Rejected";
  if (status === "expired") return "Expired";
  return "Superseded";
}

export function stringifyPatchValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function patchPayloadValue(patch: Pick<Patch, "payload">) {
  const payload = patch.payload;
  if ("value" in payload) return payload.value;
  if ("after" in payload) return payload.after;
  if ("nextValue" in payload) return payload.nextValue;
  return undefined;
}

export function patchPayloadBeforeValue(patch: Pick<Patch, "payload">) {
  const payload = patch.payload;
  if ("before" in payload) return payload.before;
  if ("beforeValue" in payload) return payload.beforeValue;
  if ("previousValue" in payload) return payload.previousValue;
  return undefined;
}

/**
 * Resolve the values shown by a review card from the canonical read model.
 * Applications are authoritative for the value that was actually applied;
 * target/result facts fill the before/after sides for replace and retract.
 */
export function patchReviewValues(
  patch: Pick<Patch, "operation" | "payload" | "status">,
  application: Pick<PatchApplication, "appliedPayload"> | null,
  targetFact: Pick<Fact, "value"> | null,
  resultingFact: Pick<Fact, "value"> | null,
) {
  const beforeValue = patch.operation === "retract_fact" || patch.operation === "replace_fact"
    ? targetFact?.value ?? patchPayloadBeforeValue(patch)
    : patchPayloadBeforeValue(patch);
  const appliedPayload = application?.appliedPayload;
  const afterValue = appliedPayload && "value" in appliedPayload
    ? appliedPayload.value
    : resultingFact?.value ?? patchPayloadValue(patch);
  return {
    before: beforeValue,
    after: patch.operation === "retract_fact" && patch.status === "accepted" ? "— (retracted)" : afterValue,
  };
}

/**
 * Convert the small composer input into the registry's JSON value shape. The
 * server still validates the predicate/value pair; this only prevents the UI
 * from sending a JSON predicate as an untyped string.
 */
export function candidateValueFromInput(raw: string, valueType: FactValueType) {
  const value = raw.trim();
  if (valueType === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  if (valueType === "boolean") {
    if (value.toLocaleLowerCase() === "true") return true;
    if (value.toLocaleLowerCase() === "false") return false;
    return value;
  }
  if (valueType === "json") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value ? [value] : [];
    }
  }
  return value;
}
