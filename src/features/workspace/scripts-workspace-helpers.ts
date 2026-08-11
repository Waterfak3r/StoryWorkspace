import type { Entity, FactValueType } from "@/domain/story-bible";
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
