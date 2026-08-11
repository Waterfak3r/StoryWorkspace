import { describe, expect, it } from "vitest";
import type { Patch } from "@/domain/canon-patch";
import {
  analysisSelectionKey,
  candidateValueFromInput,
  canAcceptPatch,
  isCurrentAnalysisResponse,
  isCurrentPatchResponse,
  isStalePatchResponse,
  isStaleAnalysisResponse,
  patchConflictLabel,
  patchPayloadBeforeValue,
  patchPayloadValue,
  patchReviewValues,
  patchSelectionKey,
  patchStatusLabel,
  replaceCanonicalEntity,
  replaceCanonicalPatch,
  replaceCanonicalRecord,
  stringifyPatchValue,
} from "./scripts-workspace-helpers";

const scene = { sceneId: "scene-1", sceneRevisionId: "revision-1" };

describe("scripts workspace async selection helpers", () => {
  it("keys analysis by stable scene and immutable scene revision", () => {
    expect(analysisSelectionKey(scene)).toBe("scene-1:revision-1");
    expect(analysisSelectionKey({ ...scene, sceneRevisionId: "revision-2" })).not.toBe(analysisSelectionKey(scene));
  });

  it("ignores a response after selection or revision changes", () => {
    expect(isCurrentAnalysisResponse(scene, scene)).toBe(true);
    expect(isCurrentAnalysisResponse({ ...scene, sceneId: "scene-2" }, scene)).toBe(false);
    expect(isCurrentAnalysisResponse({ ...scene, sceneRevisionId: "revision-2" }, scene)).toBe(false);
    expect(isStaleAnalysisResponse({ ...scene, sceneRevisionId: "revision-2" }, scene)).toBe(true);
    expect(isStaleAnalysisResponse(null, scene)).toBe(true);
  });
});

describe("scripts workspace canonical replacement helpers", () => {
  it("replaces a canonical record in place and appends a new record", () => {
    const records = [{ id: "one", value: "old" }, { id: "two", value: "same" }];
    expect(replaceCanonicalRecord(records, { id: "one", value: "new" })).toEqual([
      { id: "one", value: "new" },
      { id: "two", value: "same" },
    ]);
    expect(replaceCanonicalRecord(records, { id: "three", value: "new" })).toEqual([
      ...records,
      { id: "three", value: "new" },
    ]);
  });

  it("uses the same replacement contract for entities", () => {
    const entity = {
      id: "entity-1",
      projectId: "project-1",
      type: "character" as const,
      canonicalName: "Lin Mo",
      status: "draft" as const,
      mergedIntoEntityId: null,
      attributes: {},
      schemaVersion: 1,
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(replaceCanonicalEntity([entity], { ...entity, version: 2 })).toEqual([{ ...entity, version: 2 }]);
  });
});

describe("Phase 2 patch review helpers", () => {
  const patch = {
    id: "00000000-0000-4000-8000-000000000001",
    projectId: "00000000-0000-4000-8000-000000000002",
    operation: "add_fact" as const,
    targetEntityId: "00000000-0000-4000-8000-000000000004",
    targetFactId: null,
    baseVersion: 1,
    payload: {
      predicate: "appearance.distinctive_features",
      before: null,
      value: "silver earring",
    },
    truthClass: "canon" as const,
    evidenceSourceIds: [],
    confidence: 0.98,
    conflictKind: "none" as const,
    conflictingFactIds: [],
    conflictMessage: null,
    sourceRevisionId: "00000000-0000-4000-8000-000000000003",
    inferenceId: null,
    modelRunId: null,
    status: "pending" as const,
    proposedBy: "rule" as const,
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    resolvedAt: null,
    resolvedByUserId: null,
  } satisfies Patch;

  it("uses the same immutable selection key and ignores late patch responses", () => {
    const current = { sceneId: "scene-1", sceneRevisionId: "revision-1" };
    expect(patchSelectionKey(current)).toBe(analysisSelectionKey(current));
    expect(isCurrentPatchResponse(current, current)).toBe(true);
    expect(isCurrentPatchResponse({ ...current, sceneRevisionId: "revision-2" }, current)).toBe(false);
    expect(isStalePatchResponse(null, current)).toBe(true);
  });

  it("keeps patch replacement canonical and action-safe", () => {
    expect(replaceCanonicalPatch([patch], { ...patch, version: 2 })).toEqual([{ ...patch, version: 2 }]);
    expect(canAcceptPatch(patch)).toBe(true);
    expect(canAcceptPatch({ ...patch, conflictKind: "hard" })).toBe(false);
    expect(canAcceptPatch({ ...patch, status: "accepted" })).toBe(false);
  });

  it("normalizes review labels and payload values without losing JSON evidence", () => {
    expect(patchConflictLabel("none")).toBe("No conflict");
    expect(patchConflictLabel("possible")).toBe("Possible conflict");
    expect(patchConflictLabel("hard")).toBe("Hard conflict");
    expect(patchStatusLabel("pending")).toBe("Pending Patch");
    expect(patchPayloadBeforeValue(patch)).toBeNull();
    expect(patchPayloadValue(patch)).toBe("silver earring");
    expect(stringifyPatchValue({ ok: true })).toContain('"ok": true');
  });

  it("prioritizes applied provenance and target facts for review values", () => {
    const replacePatch = { ...patch, operation: "replace_fact" as const, targetFactId: "00000000-0000-4000-8000-000000000005", payload: { ...patch.payload, before: "old", value: "draft" } };
    expect(patchReviewValues(replacePatch, { appliedPayload: { value: "edited" } }, { value: "old" }, { value: "new" })).toEqual({ before: "old", after: "edited" });
    const retractPatch = { ...replacePatch, operation: "retract_fact" as const, status: "accepted" as const, payload: {} };
    expect(patchReviewValues(retractPatch, { appliedPayload: {} }, { value: "old" }, null)).toEqual({ before: "old", after: "— (retracted)" });
  });

  it("coerces structured composer values before server validation", () => {
    expect(candidateValueFromInput("42", "number")).toBe(42);
    expect(candidateValueFromInput("true", "boolean")).toBe(true);
    expect(candidateValueFromInput("silver earring", "json")).toEqual(["silver earring"]);
    expect(candidateValueFromInput('["silver earring"]', "json")).toEqual(["silver earring"]);
  });
});
