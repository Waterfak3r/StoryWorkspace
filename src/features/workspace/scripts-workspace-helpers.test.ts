import { describe, expect, it } from "vitest";
import type { Patch } from "@/domain/canon-patch";
import {
  analysisSelectionKey,
  candidateValueFromInput,
  canAcceptPatch,
  contextSelectionKey,
  isCurrentContextResponse,
  isStaleContextResponse,
  isCurrentStoryboardBoardResponse,
  isCurrentStoryboardResponse,
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
  isCurrentWorkspaceRevisionResponse,
  isFactPredicate,
  isStaleWorkspaceRevisionResponse,
  isStaleStoryboardBoardResponse,
  isStaleStoryboardResponse,
  statePredicateLabel,
  stateTierLabel,
  storyboardBoardSelectionKey,
  storyboardSelectionKey,
  compilationSelectionKey,
  compilationInputKey,
  compilationInputDefaults,
  isCurrentCompilationResponse,
  isStaleCompilationResponse,
  generationSelectionKey,
  isCurrentGenerationResponse,
  isStaleGenerationResponse,
  workspaceRevisionSelectionKey,
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
    conflictingStateIds: [],
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

describe("Phase 3 continuity and resolved-state helpers", () => {
  const selection = {
    projectId: "project-1",
    documentId: "document-1",
    sceneId: "scene-1",
    sceneRevisionId: "revision-1",
    entityId: null,
  };

  it("keys resolved state by project, document, scene, revision, and entity", () => {
    expect(workspaceRevisionSelectionKey(selection)).toBe("project-1:document-1:scene-1:revision-1:all");
    expect(workspaceRevisionSelectionKey({ ...selection, sceneRevisionId: "revision-2" })).not.toBe(workspaceRevisionSelectionKey(selection));
    expect(workspaceRevisionSelectionKey({ ...selection, entityId: "entity-1" })).not.toBe(workspaceRevisionSelectionKey(selection));
  });

  it("ignores stale responses after project/document/revision changes", () => {
    expect(isCurrentWorkspaceRevisionResponse(selection, selection)).toBe(true);
    expect(isStaleWorkspaceRevisionResponse({ ...selection, projectId: "project-2" }, selection)).toBe(true);
    expect(isStaleWorkspaceRevisionResponse({ ...selection, documentId: "document-2" }, selection)).toBe(true);
    expect(isStaleWorkspaceRevisionResponse({ ...selection, sceneRevisionId: "revision-2" }, selection)).toBe(true);
    expect(isStaleWorkspaceRevisionResponse(null, selection)).toBe(true);
  });

  it("keeps state tiers explicit in labels", () => {
    expect(stateTierLabel("explicit")).toBe("Explicit Scene State");
    expect(stateTierLabel("carried")).toBe("Carried State");
    expect(stateTierLabel("base")).toBe("Base Canon fallback");
    expect(stateTierLabel("missing")).toBe("Missing");
    expect(stateTierLabel("conflict")).toBe("Blocking conflict");
    expect(statePredicateLabel("wardrobe.current")).toBe("Current wardrobe");
  });

  it("keeps Scene State predicates out of the Fact composer", () => {
    expect(isFactPredicate("appearance.hair")).toBe(true);
    expect(isFactPredicate("wardrobe.current")).toBe(false);
    expect(isFactPredicate("state.injury")).toBe(false);
    expect(isFactPredicate("state.held_prop")).toBe(false);
  });
});

describe("Phase 4 Context Snapshot selection helpers", () => {
  const selection = {
    projectId: "project-1",
    documentId: "document-1",
    sceneId: "scene-1",
    sceneRevisionId: "revision-1",
    purpose: "video" as const,
    policyId: "video-default-v1" as const,
  };

  it("keys context reads by project, revision, purpose, and matching policy", () => {
    expect(contextSelectionKey(selection)).toBe("project-1:document-1:scene-1:revision-1:all:video:video-default-v1");
    expect(contextSelectionKey({ ...selection, purpose: "storyboard", policyId: "storyboard-default-v1" })).not.toBe(contextSelectionKey(selection));
  });

  it("ignores late Context responses after a Scene or purpose switch", () => {
    expect(isCurrentContextResponse(selection, selection)).toBe(true);
    expect(isCurrentContextResponse({ ...selection, sceneRevisionId: "revision-2" }, selection)).toBe(false);
    expect(isCurrentContextResponse({ ...selection, purpose: "storyboard", policyId: "storyboard-default-v1" }, selection)).toBe(false);
    expect(isStaleContextResponse(null, selection)).toBe(true);
  });
});

describe("Phase 5A Storyboard selection helpers", () => {
  const selection = {
    projectId: "project-1",
    sceneId: "scene-1",
    sceneRevisionId: "revision-1",
    contextSnapshotId: "snapshot-1",
  };
  const boardSelection = { ...selection, storyboardId: "storyboard-1" };

  it("keys Storyboard reads by the immutable Context Snapshot", () => {
    expect(storyboardSelectionKey(selection)).toBe("project-1:scene-1:revision-1:snapshot-1");
    expect(storyboardSelectionKey({ ...selection, contextSnapshotId: "snapshot-2" })).not.toBe(storyboardSelectionKey(selection));
    expect(storyboardBoardSelectionKey(boardSelection)).toBe("project-1:scene-1:revision-1:snapshot-1:storyboard-1");
  });

  it("ignores late list and board detail responses after local selection changes", () => {
    expect(isCurrentStoryboardResponse(selection, selection)).toBe(true);
    expect(isCurrentStoryboardResponse({ ...selection, sceneRevisionId: "revision-2" }, selection)).toBe(false);
    expect(isCurrentStoryboardResponse({ ...selection, contextSnapshotId: "snapshot-2" }, selection)).toBe(false);
    expect(isStaleStoryboardResponse(null, selection)).toBe(true);
    expect(isCurrentStoryboardBoardResponse(boardSelection, boardSelection)).toBe(true);
    expect(isCurrentStoryboardBoardResponse({ ...boardSelection, storyboardId: "storyboard-2" }, boardSelection)).toBe(false);
    expect(isStaleStoryboardBoardResponse(null, boardSelection)).toBe(true);
  });
});

describe("Phase 5B compilation selection helpers", () => {
  const selection = {
    projectId: "project-1",
    sceneId: "scene-1",
    sceneRevisionId: "revision-1",
    contextSnapshotId: "snapshot-1",
    storyboardId: "storyboard-1",
    shotSpecId: "shot-1",
  };

  it("keys a compile response by project, revision, snapshot, board, and ShotSpec", () => {
    expect(compilationSelectionKey(selection)).toBe("project-1:scene-1:revision-1:snapshot-1:storyboard-1:shot-1");
    expect(compilationSelectionKey({ ...selection, shotSpecId: "shot-2" })).not.toBe(compilationSelectionKey(selection));
    expect(compilationSelectionKey({ ...selection, contextSnapshotId: "snapshot-2" })).not.toBe(compilationSelectionKey(selection));
  });

  it("rejects late compile responses after any immutable selection changes", () => {
    expect(isCurrentCompilationResponse(selection, selection)).toBe(true);
    expect(isCurrentCompilationResponse({ ...selection, storyboardId: "storyboard-2" }, selection)).toBe(false);
    expect(isCurrentCompilationResponse({ ...selection, shotSpecId: "shot-2" }, selection)).toBe(false);
    expect(isStaleCompilationResponse(null, selection)).toBe(true);
  });

  it("invalidates a rendered preview key when refreshed asset selection changes", () => {
    const withFirstAsset = compilationInputKey(selection, ["asset-1"], "", "16:9");
    const withSecondAsset = compilationInputKey(selection, ["asset-1", "asset-2"], "", "16:9");
    expect(withFirstAsset).not.toBe(withSecondAsset);
    expect(compilationInputKey(selection, ["asset-1"], "6", "16:9")).not.toBe(withFirstAsset);
  });

  it("derives fresh parameter defaults from the newly selected Shot", () => {
    expect(compilationInputDefaults(8)).toEqual({ durationInput: "8", aspectInput: "16:9" });
    expect(compilationInputDefaults(null)).toEqual({ durationInput: "", aspectInput: "16:9" });
  });

  it("binds generation responses to the immutable compiled request", () => {
    const generationSelection = { ...selection, compiledRequestId: "compiled-1" };
    expect(generationSelectionKey(generationSelection)).toBe("project-1:scene-1:revision-1:snapshot-1:storyboard-1:shot-1:compiled-1");
    expect(generationSelectionKey({ ...generationSelection, shotSpecId: "shot-2" })).not.toBe(generationSelectionKey(generationSelection));
    expect(isCurrentGenerationResponse(generationSelection, generationSelection)).toBe(true);
    expect(isCurrentGenerationResponse({ ...generationSelection, compiledRequestId: "compiled-2" }, generationSelection)).toBe(false);
    expect(isStaleGenerationResponse(null, generationSelection)).toBe(true);
  });
});
