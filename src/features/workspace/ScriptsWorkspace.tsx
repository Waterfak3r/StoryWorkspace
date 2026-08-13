"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Check, Play, Plus, Trash, X } from "@phosphor-icons/react";
import type { DocumentRevision, SceneRevision, ScriptDocument } from "@/domain/document";
import type { AnalysisRun, AnalysisRunStatus, EntityMention } from "@/domain/analysis";
import type { AcceptEditedPatchInput, AcceptPatchInput, RejectPatchInput } from "@/domain/canon-patch";
import type { SceneEntityLink } from "@/domain/scene-link";
import { predicateSchemaRegistry } from "@/domain/story-bible";
import type { CreateEntityInput, Entity, EntityState, EvidenceSource, Fact, FactScope, FactValueType } from "@/domain/story-bible";
import {
  WorkspaceApiError,
  acceptEditedPatch,
  acceptPatch,
  buildContextSnapshot,
  createDocumentRevision,
  createContinuityGroup,
  createEntity,
  createEntityAlias,
  enqueueAnalysis,
  executeAnalysis,
  getScenePatchReview,
  getSceneEntityReview,
  listContextSnapshots,
  getScriptDocument,
  getDocumentRevision,
  getResolvedState,
  listContinuityGroups,
  listEntities,
  proposeFactPatch,
  proposeStatePatch,
  rejectPatch,
  reviewSceneEntityLink,
} from "./workspace-api";
import type {
  ContinuityGroup,
  ContinuityGroupKind,
  ContextPurpose,
  ContextPolicyId,
  ContextContent,
  ContextEntity,
  ContextSnapshot,
  PatchProposalResult,
  ResolvedState,
  SceneEntityReview,
  ScenePatchReview as ApiScenePatchReview,
  StatePatchProposalInput,
  WorkspacePatch,
  WorkspacePatchApplication,
} from "./workspace-api";
import {
  analysisSelectionKey,
  candidateValueFromInput,
  canAcceptPatch,
  contextSelectionKey,
  isCurrentAnalysisResponse,
  isCurrentContextResponse,
  isCurrentPatchResponse,
  patchSelectionKey,
  patchConflictLabel,
  patchPayloadValue,
  patchReviewValues,
  patchStatusLabel,
  stringifyPatchValue,
  replaceCanonicalEntity,
  replaceCanonicalPatch,
  replaceCanonicalRecord,
  isCurrentWorkspaceRevisionResponse,
  isFactPredicate,
  statePredicateLabel,
  stateTierLabel,
  workspaceRevisionSelectionKey,
} from "./scripts-workspace-helpers";

type ScriptsWorkspaceProps = {
  projectId: string;
  document: ScriptDocument | null;
  onDocumentChanged: (document: ScriptDocument) => void;
  onCreateDocument: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

type EditableScene = {
  id: string;
  title: string;
  content: string;
  narrativeRank: number;
  status: SceneRevision["status"];
  continuityGroupId: string;
  persisted: boolean;
};

type AnalysisState = {
  selection: { sceneId: string; sceneRevisionId: string };
  loading: boolean;
  status: AnalysisRunStatus | null;
  run: AnalysisRun | null;
  review: SceneEntityReview | null;
  error: string | null;
  action: "reviewing" | "running" | "reviewing-links" | null;
};

type PatchReviewState = {
  selection: { sceneId: string; sceneRevisionId: string };
  loading: boolean;
  review: ScenePatchReview | null;
  error: string | null;
  action: "reviewing" | "proposing" | "accepting" | "rejecting" | "refreshing" | null;
  latestConflict: WorkspacePatch | null;
};

type ContextSelection = {
  projectId: string;
  documentId: string;
  sceneId: string;
  sceneRevisionId: string;
  purpose: ContextPurpose;
  policyId: ContextPolicyId;
};

type ContextState = {
  selection: ContextSelection;
  loading: boolean;
  building: boolean;
  loaded: boolean;
  snapshot: ContextSnapshot | null;
  error: string | null;
};

type FactCandidateDraft = {
  entityId: string;
  predicate: string;
  value: unknown;
  valueType: FactValueType;
  scope: FactScope;
  evidenceQuote: string;
};

type StateCandidateDraft = {
  entityId: string;
  predicate: "wardrobe.current" | "state.injury" | "state.held_prop";
  value: string;
  valueType: "string" | "entity_ref";
  carryForward: boolean;
  priority: number;
  evidenceQuote: string;
};

/** Keep the API read model available to UI/e2e callers without duplicating it. */
export type ScenePatchReview = ApiScenePatchReview;

export type PatchActionRequest = {
  expectedVersion: number;
  requestId: string;
};

export type PatchReviewActionHandlers = {
  onAccept?: (patch: WorkspacePatch, request: PatchActionRequest) => void;
  onAcceptEdited?: (patch: WorkspacePatch, payload: Record<string, unknown>, request: PatchActionRequest) => void;
  onReject?: (patch: WorkspacePatch, reason: string | null, request: PatchActionRequest) => void;
};

type EntityType = Extract<CreateEntityInput["type"], "character" | "location" | "prop">;

const entityTypeLabels: Record<EntityType, string> = {
  character: "Character",
  location: "Location",
  prop: "Prop",
};

function idFor() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const seed = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32).split("");
  seed[12] = "4";
  seed[16] = ((Number.parseInt(seed[16], 16) & 0x3) | 0x8).toString(16);
  return `${seed.slice(0, 8).join("")}-${seed.slice(8, 12).join("")}-${seed.slice(12, 16).join("")}-${seed.slice(16, 20).join("")}-${seed.slice(20).join("")}`;
}

function requestId(prefix: string) {
  return `${prefix}-${idFor()}`;
}

function sceneDraftsFromRevision(revision: DocumentRevision | null): EditableScene[] {
  if (!revision) return [];
  return revision.sceneRevisions
    .slice()
    .sort((left, right) => left.narrativeRank - right.narrativeRank || left.sceneId.localeCompare(right.sceneId))
    .map((scene) => ({
      id: scene.sceneId,
      title: scene.title,
      content: scene.content,
      narrativeRank: scene.narrativeRank,
      status: scene.status,
      continuityGroupId: scene.continuityGroupId,
      persisted: true,
    }));
}

function activeScenes(scenes: readonly EditableScene[]) {
  return scenes.filter((scene) => scene.status === "active");
}

function sceneLabel(scene: Pick<EditableScene, "title" | "narrativeRank">) {
  return scene.title.trim() || `Scene ${scene.narrativeRank + 1}`;
}

function humanError(error: unknown, fallback: string) {
  return error instanceof WorkspaceApiError ? error.message : fallback;
}

function statusLabel(status: AnalysisRunStatus | null, loading: boolean) {
  if (loading && !status) return "Loading analysis";
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "succeeded") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "stale") return "Stale";
  return "Not analyzed";
}

function statusTone(status: AnalysisRunStatus | null) {
  if (status === "succeeded") return "text-success";
  if (status === "failed" || status === "stale") return "text-danger";
  if (status === "queued" || status === "running") return "text-accent";
  return "text-ink-faint";
}

function mentionForLink(link: SceneEntityLink, mentions: readonly EntityMention[]) {
  return link.mentionIds
    .map((mentionId) => mentions.find((mention) => mention.id === mentionId)?.surface)
    .filter((surface): surface is string => Boolean(surface))
    .join(" / ") || "Mention";
}

function evidenceForLink(link: SceneEntityLink, mentions: readonly EntityMention[], evidenceSources: readonly EvidenceSource[]) {
  const evidenceIds = new Set(
    link.mentionIds
      .map((mentionId) => mentions.find((mention) => mention.id === mentionId)?.evidenceSourceId)
      .filter((id): id is string => Boolean(id)),
  );
  return evidenceSources.filter((source) => evidenceIds.has(source.id));
}

function entityForLink(link: SceneEntityLink, entities: readonly Entity[]) {
  return entities.find((entity) => entity.id === link.entityId) ?? null;
}

function associatedEntitiesForReview(review: SceneEntityReview | null, entities: readonly Entity[]) {
  if (!review) return [] as Entity[];
  const available = [...review.entities, ...entities];
  const associated: Entity[] = [];
  for (const link of review.links) {
    if (link.status === "rejected" || link.status === "stale") continue;
    const entity = entityForLink(link, available);
    if (entity && !associated.some((candidate) => candidate.id === entity.id)) associated.push(entity);
  }
  return associated;
}

function confirmedEntitiesForReview(review: SceneEntityReview | null, entities: readonly Entity[]) {
  if (!review) return [] as Entity[];
  const available = [...review.entities, ...entities];
  const confirmed: Entity[] = [];
  for (const link of review.links) {
    if (link.status !== "confirmed") continue;
    const entity = entityForLink(link, available);
    if (entity && !confirmed.some((candidate) => candidate.id === entity.id)) confirmed.push(entity);
  }
  return confirmed;
}

function mentionSnippet(mention: string, link: SceneEntityLink, mentions: readonly EntityMention[], content: string) {
  const sourceMention = link.mentionIds
    .map((mentionId) => mentions.find((item) => item.id === mentionId))
    .find((item): item is EntityMention => Boolean(item));
  if (!sourceMention || !content) return mention;
  const start = Math.max(0, sourceMention.anchorStart - 36);
  const end = Math.min(content.length, sourceMention.anchorEnd + 64);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

function reviewToAnalysisState(selection: AnalysisState["selection"], review: SceneEntityReview): AnalysisState {
  return {
    selection,
    loading: false,
    status: review.analysisRun?.status ?? null,
    run: review.analysisRun,
    review,
    error: null,
    action: null,
  };
}

export function ScriptsWorkspace({ projectId, document, onDocumentChanged, onCreateDocument, onDirtyChange }: ScriptsWorkspaceProps) {
  const [freshDocument, setFreshDocument] = React.useState<ScriptDocument | null>(document);
  const [revision, setRevision] = React.useState<DocumentRevision | null>(null);
  const [scenes, setScenes] = React.useState<EditableScene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = React.useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = React.useState(false);
  const [documentError, setDocumentError] = React.useState<string | null>(null);
  const [revisionSaving, setRevisionSaving] = React.useState(false);
  const [revisionDirty, setRevisionDirty] = React.useState(false);
  const [revisionError, setRevisionError] = React.useState<string | null>(null);
  const [continuityGroups, setContinuityGroups] = React.useState<ContinuityGroup[]>([]);
  const [continuityGroupsLoading, setContinuityGroupsLoading] = React.useState(false);
  const [continuityGroupsError, setContinuityGroupsError] = React.useState<string | null>(null);
  const [groupFormOpen, setGroupFormOpen] = React.useState(false);
  const [groupKind, setGroupKind] = React.useState<ContinuityGroupKind>("flashback");
  const [groupName, setGroupName] = React.useState("");
  const [groupSaving, setGroupSaving] = React.useState(false);
  const [analysisByKey, setAnalysisByKey] = React.useState<Record<string, AnalysisState>>({});
  // Keep patch review keyed by Scene + immutable SceneRevision so a late
  // response cannot bleed into another selection.
  const [patchReviewByKey, setPatchReviewByKey] = React.useState<Record<string, PatchReviewState>>({});
  const [resolvedStateByKey, setResolvedStateByKey] = React.useState<Record<string, { selection: { projectId: string; documentId: string; sceneId: string; sceneRevisionId: string }; loading: boolean; state: ResolvedState | null; error: string | null }>>({});
  const [contextPurpose, setContextPurpose] = React.useState<ContextPurpose>("video");
  const [contextByKey, setContextByKey] = React.useState<Record<string, ContextState>>({});
  const [resolvedStateRefreshToken, setResolvedStateRefreshToken] = React.useState(0);
  const [entities, setEntities] = React.useState<Entity[]>([]);
  const [entityLoading, setEntityLoading] = React.useState(false);
  const [entityFormOpen, setEntityFormOpen] = React.useState(false);
  const [entityType, setEntityType] = React.useState<EntityType>("character");
  const [canonicalName, setCanonicalName] = React.useState("");
  const [alias, setAlias] = React.useState("");
  const [entitySaving, setEntitySaving] = React.useState(false);
  const [entityError, setEntityError] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState("Scripts are ready.");
  const documentRequestRef = React.useRef(0);
  const analysisSelectionRef = React.useRef<AnalysisState["selection"] | null>(null);
  const patchSelectionRef = React.useRef<PatchReviewState["selection"] | null>(null);
  const resolvedStateSelectionRef = React.useRef<{ projectId: string; documentId: string; sceneId: string; sceneRevisionId: string } | null>(null);
  const contextSelectionRef = React.useRef<ContextSelection | null>(null);
  const analysisByKeyRef = React.useRef<Record<string, AnalysisState>>({});
  const patchReviewByKeyRef = React.useRef<Record<string, PatchReviewState>>({});
  const contextByKeyRef = React.useRef<Record<string, ContextState>>({});
  const resolvedStateByKeyRef = React.useRef<typeof resolvedStateByKey>({});
  const documentId = document?.id ?? null;
  const documentVersion = document?.version ?? null;
  const documentRevisionId = document?.currentRevisionId ?? null;

  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId && scene.status === "active") ?? null;
  const selectedSceneAnalysisId = selectedScene?.id ?? null;
  const activeSceneList = activeScenes(scenes);
  const selectedRevisionId = revision?.sceneRevisions.find((scene) => scene.sceneId === selectedSceneId)?.id ?? null;
  const selectedAnalysisKey = selectedScene && selectedRevisionId
    ? analysisSelectionKey({ sceneId: selectedScene.id, sceneRevisionId: selectedRevisionId })
    : null;
  const selectedAnalysis = selectedAnalysisKey ? analysisByKey[selectedAnalysisKey] ?? null : null;
  const selectedPatchState = selectedAnalysisKey ? patchReviewByKey[selectedAnalysisKey] ?? null : null;
  const selectedPatchReview = selectedPatchState?.review ?? null;
  const associatedEntities = associatedEntitiesForReview(selectedAnalysis?.review ?? null, entities);
  const confirmedCharacters = confirmedEntitiesForReview(selectedAnalysis?.review ?? null, entities).filter((entity) => entity.type === "character");
  const stateProps = entities.filter((entity) => entity.type === "prop" && (entity.status === "active" || entity.status === "draft"));
  const selectedResolvedStateKey = documentId && selectedScene && selectedRevisionId
    ? workspaceRevisionSelectionKey({ projectId, documentId, sceneId: selectedScene.id, sceneRevisionId: selectedRevisionId })
    : null;
  const selectedResolvedState = selectedResolvedStateKey ? resolvedStateByKey[selectedResolvedStateKey] ?? null : null;
  const contextPolicyId: ContextPolicyId = contextPurpose === "storyboard" ? "storyboard-default-v1" : "video-default-v1";
  const selectedContextSelection = React.useMemo<ContextSelection | null>(() => documentId && selectedScene && selectedRevisionId
    ? { projectId, documentId, sceneId: selectedScene.id, sceneRevisionId: selectedRevisionId, purpose: contextPurpose, policyId: contextPolicyId }
    : null, [contextPolicyId, contextPurpose, documentId, projectId, selectedRevisionId, selectedScene]);
  const selectedContextKey = selectedContextSelection ? contextSelectionKey(selectedContextSelection) : null;
  const selectedContext = selectedContextKey ? contextByKey[selectedContextKey] ?? null : null;

  React.useEffect(() => {
    setFreshDocument(document);
  }, [document]);

  React.useEffect(() => {
    let cancelled = false;
    const requestNumber = documentRequestRef.current + 1;
    documentRequestRef.current = requestNumber;
    setDocumentLoading(true);
    setDocumentError(null);
    setRevisionError(null);
    setRevisionDirty(false);
    onDirtyChange(false);
    setRevision(null);
    setScenes([]);
    setSelectedSceneId(null);
    setContinuityGroups([]);
    setContinuityGroupsError(null);
    setGroupFormOpen(false);
    resolvedStateSelectionRef.current = null;
    setResolvedStateByKey({});
    contextSelectionRef.current = null;
    contextByKeyRef.current = {};
    setContextByKey({});
    analysisSelectionRef.current = null;
    patchSelectionRef.current = null;
    setAnalysisByKey({});
    setPatchReviewByKey({});

    if (!documentId) {
      setDocumentLoading(false);
      setContinuityGroupsLoading(false);
      setFreshDocument(null);
      return () => { cancelled = true; };
    }

    const load = async () => {
      try {
        const canonical = await getScriptDocument(projectId, documentId);
        if (cancelled || documentRequestRef.current !== requestNumber) return;
        setFreshDocument(canonical);
        onDocumentChanged(canonical);
        setContinuityGroupsLoading(true);
        void listContinuityGroups(projectId, canonical.id)
          .then((groups) => {
            if (cancelled || documentRequestRef.current !== requestNumber) return;
            setContinuityGroups(groups);
            setContinuityGroupsError(null);
          })
          .catch((error: unknown) => {
            if (cancelled || documentRequestRef.current !== requestNumber) return;
            setContinuityGroupsError(humanError(error, "Continuity groups could not be loaded."));
          })
          .finally(() => {
            if (!cancelled && documentRequestRef.current === requestNumber) setContinuityGroupsLoading(false);
          });
        if (!canonical.currentRevisionId) {
          setDocumentLoading(false);
          setStatusMessage("No saved revision yet. Add a scene, then save the script.");
          return;
        }
        const loadedRevision = await getDocumentRevision(projectId, canonical.id, canonical.currentRevisionId);
        if (cancelled || documentRequestRef.current !== requestNumber) return;
        const loadedScenes = sceneDraftsFromRevision(loadedRevision);
        setRevision(loadedRevision);
        setScenes(loadedScenes);
        setSelectedSceneId(loadedScenes.find((scene) => scene.status === "active")?.id ?? null);
        setDocumentLoading(false);
        setStatusMessage("Saved revision loaded.");
      } catch (error) {
        if (cancelled || documentRequestRef.current !== requestNumber) return;
        setDocumentLoading(false);
        setDocumentError(humanError(error, "The script could not be loaded. Try again."));
        setStatusMessage("Script loading failed.");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [documentId, documentRevisionId, documentVersion, onDirtyChange, onDocumentChanged, projectId]);

  React.useEffect(() => {
    let cancelled = false;
    setEntityLoading(true);
    void listEntities(projectId)
      .then((loaded) => {
        if (!cancelled) setEntities(loaded);
      })
      .catch(() => {
        // Entity cards can still be populated by the scene review read model.
      })
      .finally(() => {
        if (!cancelled) setEntityLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  React.useEffect(() => {
    analysisByKeyRef.current = analysisByKey;
  }, [analysisByKey]);

  React.useEffect(() => {
    patchReviewByKeyRef.current = patchReviewByKey;
  }, [patchReviewByKey]);

  React.useEffect(() => {
    resolvedStateByKeyRef.current = resolvedStateByKey;
  }, [resolvedStateByKey]);

  React.useEffect(() => {
    contextByKeyRef.current = contextByKey;
  }, [contextByKey]);

  React.useEffect(() => {
    if (!selectedSceneAnalysisId || !selectedRevisionId || !revision) {
      analysisSelectionRef.current = null;
      return;
    }
    const selection = { sceneId: selectedSceneAnalysisId, sceneRevisionId: selectedRevisionId };
    analysisSelectionRef.current = selection;
    const key = analysisSelectionKey(selection);
    const existing = analysisByKeyRef.current[key];
    // A prior request may still be marked loading after its owning effect was
    // cancelled by the save/reload hand-off. The replacement effect must be
    // allowed to issue a fresh read for the same immutable revision.
    if (existing?.review || existing?.error) return;

    let cancelled = false;
    setAnalysisByKey((current) => ({
      ...current,
      [key]: {
        selection,
        loading: true,
        status: current[key]?.status ?? null,
        run: current[key]?.run ?? null,
        review: current[key]?.review ?? null,
        error: null,
        action: "reviewing",
      },
    }));
    void getSceneEntityReview(projectId, selectedSceneAnalysisId, selectedRevisionId)
      .then((review) => {
        if (cancelled || !isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return;
        setAnalysisByKey((current) => ({ ...current, [key]: reviewToAnalysisState(selection, review) }));
        setEntities((current) => {
          let next = current;
          for (const entity of review.entities) next = replaceCanonicalEntity(next, entity);
          return next;
        });
      })
      .catch((error: unknown) => {
        if (cancelled || !isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return;
        setAnalysisByKey((current) => ({
          ...current,
          [key]: {
            selection,
            loading: false,
            status: current[key]?.status ?? null,
            run: current[key]?.run ?? null,
            review: current[key]?.review ?? null,
            error: humanError(error, "Entity review could not be loaded."),
            action: null,
          },
        }));
      });
    return () => { cancelled = true; };
  }, [projectId, revision, selectedRevisionId, selectedSceneAnalysisId]);

  React.useEffect(() => {
    if (!selectedSceneAnalysisId || !selectedRevisionId || !revision) {
      patchSelectionRef.current = null;
      return;
    }
    const selection = { sceneId: selectedSceneAnalysisId, sceneRevisionId: selectedRevisionId };
    patchSelectionRef.current = selection;
    const key = patchSelectionKey(selection);
    const existing = patchReviewByKeyRef.current[key];
    if (existing?.review || existing?.error) return;

    let cancelled = false;
    setPatchReviewByKey((current) => ({
      ...current,
      [key]: {
        selection,
        loading: true,
        review: current[key]?.review ?? null,
        error: null,
        action: "reviewing",
        latestConflict: null,
      },
    }));
    void getScenePatchReview(projectId, selectedSceneAnalysisId, selectedRevisionId)
      .then((review) => {
        if (cancelled || !isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
        setPatchReviewByKey((current) => ({
          ...current,
          [key]: { selection, loading: false, review, error: null, action: null, latestConflict: null },
        }));
      })
      .catch((error: unknown) => {
        if (cancelled || !isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
        setPatchReviewByKey((current) => ({
          ...current,
          [key]: {
            selection,
            loading: false,
            review: current[key]?.review ?? null,
            error: humanError(error, "Canon review could not be loaded."),
            action: null,
            latestConflict: null,
          },
        }));
      });
    return () => { cancelled = true; };
  }, [projectId, revision, selectedRevisionId, selectedSceneAnalysisId]);

  React.useEffect(() => {
    if (!documentId || !selectedSceneAnalysisId || !selectedRevisionId || !revision) {
      resolvedStateSelectionRef.current = null;
      return;
    }
    const selection = {
      projectId,
      documentId,
      sceneId: selectedSceneAnalysisId,
      sceneRevisionId: selectedRevisionId,
    };
    resolvedStateSelectionRef.current = selection;
    const key = workspaceRevisionSelectionKey(selection);
    const existing = resolvedStateByKeyRef.current[key];
    if (existing?.loading || existing?.state || existing?.error) return;
    let cancelled = false;
    setResolvedStateByKey((current) => ({
      ...current,
      [key]: { selection, loading: true, state: current[key]?.state ?? null, error: null },
    }));
    void getResolvedState(projectId, selectedSceneAnalysisId, { sceneRevisionId: selectedRevisionId })
      .then((state) => {
        if (cancelled || !isCurrentWorkspaceRevisionResponse(resolvedStateSelectionRef.current, selection)) return;
        setResolvedStateByKey((current) => ({ ...current, [key]: { selection, loading: false, state, error: null } }));
      })
      .catch((error: unknown) => {
        if (cancelled || !isCurrentWorkspaceRevisionResponse(resolvedStateSelectionRef.current, selection)) return;
        setResolvedStateByKey((current) => ({ ...current, [key]: { selection, loading: false, state: current[key]?.state ?? null, error: humanError(error, "Resolved Scene State could not be loaded.") } }));
      });
    return () => { cancelled = true; };
  }, [documentId, projectId, resolvedStateRefreshToken, revision, selectedRevisionId, selectedSceneAnalysisId]);

  React.useEffect(() => {
    if (!documentId || !selectedSceneAnalysisId || !selectedRevisionId || !revision || revisionDirty) {
      contextSelectionRef.current = null;
      return;
    }
    const selection: ContextSelection = {
      projectId,
      documentId,
      sceneId: selectedSceneAnalysisId,
      sceneRevisionId: selectedRevisionId,
      purpose: contextPurpose,
      policyId: contextPolicyId,
    };
    contextSelectionRef.current = selection;
    const key = contextSelectionKey(selection);
    setContextByKey((current) => ({
      ...current,
      [key]: {
        selection,
        loading: true,
        building: false,
        loaded: false,
        snapshot: current[key]?.snapshot ?? null,
        error: null,
      },
    }));
    void listContextSnapshots(projectId, {
      sceneId: selection.sceneId,
      sceneRevisionId: selection.sceneRevisionId,
      purpose: selection.purpose,
      policyId: selection.policyId,
      latest: true,
    })
      .then((snapshots) => {
        if (!isCurrentContextResponse(contextSelectionRef.current, selection)) return;
        const snapshot = snapshots.find((candidate) => candidate.isLatest) ?? snapshots[0] ?? null;
        setContextByKey((current) => ({
          ...current,
          [key]: { selection, loading: false, building: false, loaded: true, snapshot, error: null },
        }));
      })
      .catch((error: unknown) => {
        if (!isCurrentContextResponse(contextSelectionRef.current, selection)) return;
        setContextByKey((current) => ({
          ...current,
          [key]: {
            selection,
            loading: false,
            building: false,
            loaded: true,
            snapshot: current[key]?.snapshot ?? null,
            error: humanError(error, "Context Snapshot could not be loaded."),
          },
        }));
      });
  }, [contextPolicyId, contextPurpose, documentId, projectId, revision, revisionDirty, selectedRevisionId, selectedSceneAnalysisId]);

  const updateScene = React.useCallback((sceneId: string, update: Partial<Pick<EditableScene, "title" | "content" | "continuityGroupId">>) => {
    setScenes((current) => current.map((scene) => scene.id === sceneId ? { ...scene, ...update } : scene));
    setRevisionDirty(true);
    onDirtyChange(true);
    setRevisionError(null);
  }, [onDirtyChange]);

  const selectScene = React.useCallback((sceneId: string) => {
    if (sceneId !== selectedSceneId && revisionDirty && typeof window !== "undefined" && !window.confirm("This revision has unsaved changes. Switch scenes and keep them until you save?")) {
      return;
    }
    const nextRevisionId = revision?.sceneRevisions.find((scene) => scene.sceneId === sceneId)?.id ?? null;
    analysisSelectionRef.current = nextRevisionId ? { sceneId, sceneRevisionId: nextRevisionId } : null;
    patchSelectionRef.current = nextRevisionId ? { sceneId, sceneRevisionId: nextRevisionId } : null;
    setSelectedSceneId(sceneId);
  }, [revision, revisionDirty, selectedSceneId]);

  const addScene = React.useCallback(() => {
    const id = idFor();
    analysisSelectionRef.current = null;
    patchSelectionRef.current = null;
    setScenes((current) => [
      ...current,
      { id, title: "", content: "", narrativeRank: current.length, status: "active", continuityGroupId: continuityGroups.find((group) => group.isDefault)?.id ?? continuityGroups[0]?.id ?? "", persisted: false },
    ]);
    setSelectedSceneId(id);
    setRevisionDirty(true);
    onDirtyChange(true);
    setRevisionError(null);
    setStatusMessage("New scene added. Save the revision when ready.");
  }, [continuityGroups, onDirtyChange]);

  const removeScene = React.useCallback((sceneId: string) => {
    analysisSelectionRef.current = null;
    patchSelectionRef.current = null;
    setScenes((current) => {
      const target = current.find((scene) => scene.id === sceneId);
      if (!target) return current;
      if (!target.persisted) return current.filter((scene) => scene.id !== sceneId);
      return current.map((scene) => scene.id === sceneId ? { ...scene, status: "deleted" } : scene);
    });
    setSelectedSceneId((currentSelected) => {
      if (currentSelected !== sceneId) return currentSelected;
      const index = activeSceneList.findIndex((scene) => scene.id === sceneId);
      return activeSceneList[index + 1]?.id ?? activeSceneList[index - 1]?.id ?? null;
    });
    setRevisionDirty(true);
    onDirtyChange(true);
    setRevisionError(null);
    setStatusMessage("Scene marked for removal. Save the revision to commit it.");
  }, [activeSceneList, onDirtyChange]);

  const moveScene = React.useCallback((sceneId: string, direction: -1 | 1) => {
    setScenes((current) => {
      const visible = current.filter((scene) => scene.status === "active");
      const currentIndex = visible.findIndex((scene) => scene.id === sceneId);
      const targetIndex = currentIndex + direction;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visible.length) return current;
      const reordered = visible.slice();
      const [moved] = reordered.splice(currentIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      const order = new Map(reordered.map((scene, index) => [scene.id, index]));
      return current.map((scene) => order.has(scene.id) ? { ...scene, narrativeRank: order.get(scene.id) ?? scene.narrativeRank } : scene);
    });
    setRevisionDirty(true);
    onDirtyChange(true);
    setRevisionError(null);
  }, [onDirtyChange]);

  const saveRevision = React.useCallback(async () => {
    if (!freshDocument || revisionSaving || !revisionDirty) return;
    setRevisionSaving(true);
    setRevisionError(null);
    const saveDocumentId = freshDocument.id;
    const baseVersion = freshDocument.version;
    const selectedDraftBeforeSave = selectedSceneId ? scenes.find((scene) => scene.id === selectedSceneId) ?? null : null;
    try {
      const orderedScenes = scenes
        .slice()
        .sort((left, right) => {
          if (left.status === "deleted" && right.status !== "deleted") return 1;
          if (left.status !== "deleted" && right.status === "deleted") return -1;
          return left.narrativeRank - right.narrativeRank || left.id.localeCompare(right.id);
        })
        .map((scene, index) => {
          // New scenes receive a server UUID on first save. Persisted scenes
          // retain their IDs so links and analysis remain attached.
          const continuityGroupId = scene.continuityGroupId || continuityGroups.find((group) => group.isDefault)?.id || continuityGroups[0]?.id;
          return {
            ...(scene.persisted ? { id: scene.id } : {}),
            title: scene.title,
            content: scene.content,
            narrativeRank: index,
            ...(continuityGroupId ? { continuityGroupId } : {}),
            status: scene.status,
          };
        });
      const saved = await createDocumentRevision(projectId, saveDocumentId, {
        baseVersion,
        expectedVersion: baseVersion,
        requestId: requestId("document-revision"),
        actorId: "local-user",
        scenes: orderedScenes,
      });
      const canonicalDocument = await getScriptDocument(projectId, saveDocumentId);
      if (freshDocument.id !== saveDocumentId) return;
      analysisSelectionRef.current = null;
      patchSelectionRef.current = null;
      setRevision(saved);
      const canonicalScenes = sceneDraftsFromRevision(saved);
      setScenes(canonicalScenes);
      setPatchReviewByKey({});
      const selectedCanonicalId = selectedDraftBeforeSave && !selectedDraftBeforeSave.persisted
        ? canonicalScenes.find((scene) => scene.status === "active" && scene.title === selectedDraftBeforeSave.title && scene.content === selectedDraftBeforeSave.content)?.id ?? null
        : null;
      setSelectedSceneId((current) => selectedCanonicalId
        ?? (canonicalScenes.some((scene) => scene.id === current && scene.status === "active") ? current : canonicalScenes.find((scene) => scene.status === "active")?.id ?? null));
      setRevisionDirty(false);
      onDirtyChange(false);
      setFreshDocument(canonicalDocument);
      onDocumentChanged(canonicalDocument);
      setRevisionError(null);
      setStatusMessage("Script revision saved. Entity analysis can run separately.");
    } catch (error) {
      setRevisionError(humanError(error, "The script revision could not be saved. Try again."));
      setStatusMessage("Script save failed.");
    } finally {
      setRevisionSaving(false);
    }
  }, [continuityGroups, freshDocument, onDirtyChange, onDocumentChanged, projectId, revisionDirty, revisionSaving, scenes, selectedSceneId]);

  const setAnalysisState = React.useCallback((selection: AnalysisState["selection"], update: Partial<AnalysisState>) => {
    const key = analysisSelectionKey(selection);
    const defaults: AnalysisState = {
      selection,
      loading: false,
      status: null,
      run: null,
      review: null,
      error: null,
      action: null,
    };
    setAnalysisByKey((current) => ({
      ...current,
      [key]: {
        ...defaults,
        ...current[key],
        ...update,
      },
    }));
  }, []);

  const loadReview = React.useCallback(async (selection: AnalysisState["selection"], action: AnalysisState["action"] = "reviewing") => {
    if (!isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return null;
    const key = analysisSelectionKey(selection);
    setAnalysisState(selection, { loading: true, action, error: null });
    try {
      const loaded = await getSceneEntityReview(projectId, selection.sceneId, selection.sceneRevisionId);
      if (!isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return null;
      setAnalysisByKey((current) => ({ ...current, [key]: reviewToAnalysisState(selection, loaded) }));
      setEntities((current) => {
        let next = current;
        for (const entity of loaded.entities) next = replaceCanonicalEntity(next, entity);
        return next;
      });
      void listEntities(projectId).then(setEntities).catch(() => {
        // The review remains usable with the entities already in memory.
      });
      return loaded;
    } catch (error) {
      if (isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) {
        setAnalysisState(selection, { loading: false, action: null, error: humanError(error, "Entity review could not be loaded.") });
      }
      return null;
    }
  }, [projectId, setAnalysisState]);

  const setPatchState = React.useCallback((selection: PatchReviewState["selection"], update: Partial<PatchReviewState>) => {
    const key = patchSelectionKey(selection);
    const defaults: PatchReviewState = {
      selection,
      loading: false,
      review: null,
      error: null,
      action: null,
      latestConflict: null,
    };
    setPatchReviewByKey((current) => ({
      ...current,
      [key]: { ...defaults, ...current[key], ...update },
    }));
  }, []);

  const loadPatchReview = React.useCallback(async (selection: PatchReviewState["selection"], action: PatchReviewState["action"] = "reviewing") => {
    if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return null;
    const key = patchSelectionKey(selection);
    setPatchState(selection, { loading: true, action, error: null });
    try {
      const loaded = await getScenePatchReview(projectId, selection.sceneId, selection.sceneRevisionId);
      if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return null;
      setPatchReviewByKey((current) => ({
        ...current,
        [key]: { selection, loading: false, review: loaded, error: null, action: null, latestConflict: null },
      }));
      return loaded;
    } catch (error) {
      if (isCurrentPatchResponse(patchSelectionRef.current, selection)) {
        setPatchState(selection, { loading: false, action: null, error: humanError(error, "Canon review could not be loaded."), latestConflict: null });
      }
      return null;
    }
  }, [projectId, setPatchState]);

  const mergePatchMutationResult = React.useCallback((selection: PatchReviewState["selection"], updatedPatch: WorkspacePatch, fact: Fact | null, resultingState: EntityState | null, application: WorkspacePatchApplication | null) => {
    const key = patchSelectionKey(selection);
    setPatchReviewByKey((current) => {
      const state = current[key];
      if (!state?.review) return current;
      const review = {
        ...state.review,
        patches: replaceCanonicalPatch(state.review.patches, updatedPatch),
        facts: fact ? replaceCanonicalRecord(state.review.facts, fact) : state.review.facts,
        states: resultingState ? replaceCanonicalRecord(state.review.states, resultingState) : state.review.states,
        applications: application ? replaceCanonicalRecord(state.review.applications, application) : state.review.applications,
      };
      return { ...current, [key]: { ...state, review, loading: false, action: null, error: null } };
    });
  }, []);

  const mergePatchProposalResult = React.useCallback((selection: PatchReviewState["selection"], result: PatchProposalResult) => {
    const key = patchSelectionKey(selection);
    setPatchReviewByKey((current) => {
      const state = current[key];
      if (!state?.review) return current;
      const review = {
        ...state.review,
        patches: replaceCanonicalPatch(state.review.patches, result.patch),
        inferences: result.inference ? replaceCanonicalRecord(state.review.inferences, result.inference) : state.review.inferences,
        modelRuns: result.modelRun ? replaceCanonicalRecord(state.review.modelRuns, result.modelRun) : state.review.modelRuns,
      };
      return { ...current, [key]: { ...state, review, loading: false, action: null, error: null } };
    });
  }, []);

  const runPatchMutation = React.useCallback(async (
    selection: PatchReviewState["selection"],
    patch: WorkspacePatch,
    kind: "accept" | "accept-edited" | "reject",
    request: PatchActionRequest,
    payload?: Record<string, unknown>,
    reason?: string | null,
  ) => {
    if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
    if (revisionDirty) {
      setPatchState(selection, { error: "Save this Scene revision before reviewing its revision-bound Patch." });
      setStatusMessage("Save the revision before reviewing Canon or Scene State.");
      return;
    }
    setPatchState(selection, { loading: true, action: kind === "reject" ? "rejecting" : "accepting", error: null, latestConflict: null });
    try {
      let acceptedFact = false;
      let acceptedState = false;
      if (kind === "accept") {
        const input: AcceptPatchInput = { expectedVersion: request.expectedVersion, requestId: request.requestId, actorId: "local-user" };
        const result = await acceptPatch(projectId, patch.id, input);
        acceptedFact = Boolean(result.fact);
        acceptedState = Boolean(result.state);
        mergePatchMutationResult(selection, result.patch, result.fact, result.state ?? null, result.application);
      } else if (kind === "accept-edited") {
        const input: AcceptEditedPatchInput = { expectedVersion: request.expectedVersion, requestId: request.requestId, actorId: "local-user", payload: payload ?? patch.payload };
        const result = await acceptEditedPatch(projectId, patch.id, input);
        acceptedFact = Boolean(result.fact);
        acceptedState = Boolean(result.state);
        mergePatchMutationResult(selection, result.patch, result.fact, result.state ?? null, result.application);
      } else {
        const input: RejectPatchInput = { expectedVersion: request.expectedVersion, requestId: request.requestId, actorId: "local-user", reason: reason ?? null };
        const result = await rejectPatch(projectId, patch.id, input);
        mergePatchMutationResult(selection, result.patch, null, null, null);
      }
      if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
      await loadPatchReview(selection, "refreshing");
      if (documentId) {
        const resolvedKey = workspaceRevisionSelectionKey({ projectId, documentId, sceneId: selection.sceneId, sceneRevisionId: selection.sceneRevisionId });
        setResolvedStateByKey((current) => {
          const next = { ...current };
          delete next[resolvedKey];
          return next;
        });
        setResolvedStateRefreshToken((current) => current + 1);
      }
      if (isCurrentPatchResponse(patchSelectionRef.current, selection)) {
        setStatusMessage(kind === "reject" ? "Patch rejected; Canon and Scene State were not changed." : acceptedState ? "State Patch accepted; Scene State is now visible." : acceptedFact ? "Patch accepted; Canon fact is now visible." : "Patch accepted; Canon review refreshed.");
      }
    } catch (error) {
      if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
      const latestPatch = error instanceof WorkspaceApiError && error.status === 409 ? error.currentPatch : null;
      setPatchState(selection, {
        loading: false,
        action: null,
        error: humanError(error, "The Patch could not be updated. Review the latest server state."),
        // Keep the local review untouched; the latest server record is shown
        // separately so an in-progress edit is not silently overwritten.
        latestConflict: latestPatch,
      });
      setStatusMessage(latestPatch ? "Patch conflict: the latest server Patch is shown for comparison." : "Patch update failed; the script remains saved.");
    }
  }, [documentId, loadPatchReview, mergePatchMutationResult, projectId, revisionDirty, setPatchState]);

  const proposeCandidate = React.useCallback(async (selection: PatchReviewState["selection"], draft: FactCandidateDraft) => {
    if (!freshDocument || !revision || !isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
    if (revisionDirty) {
      setPatchState(selection, { error: "Save this Scene revision before proposing a revision-bound Canon Patch." });
      setStatusMessage("Save the revision before proposing Canon changes.");
      return;
    }
    const sceneRevision = revision.sceneRevisions.find((item) => item.id === selection.sceneRevisionId && item.sceneId === selection.sceneId);
    if (!sceneRevision) return;
    const quote = draft.evidenceQuote.trim();
    const anchorStart = quote ? sceneRevision.content.indexOf(quote) : -1;
    if (anchorStart < 0 || anchorStart + quote.length > sceneRevision.content.length) {
      setPatchState(selection, { error: "Evidence quote must be present in the current Scene text." });
      setStatusMessage("Patch proposal needs evidence from this Scene revision.");
      return;
    }
    setPatchState(selection, { loading: true, action: "proposing", error: null, latestConflict: null });
    try {
      const result = await proposeFactPatch(projectId, selection.sceneId, {
        documentId: freshDocument.id,
        sceneId: selection.sceneId,
        sceneRevisionId: selection.sceneRevisionId,
        operation: "add_fact",
        subjectEntityId: draft.entityId,
        targetEntityId: draft.entityId,
        predicate: draft.predicate,
        value: draft.value,
        valueType: draft.valueType,
        scope: draft.scope,
        factSceneId: draft.scope === "scene" ? selection.sceneId : null,
        validFromSceneId: draft.scope === "range" ? selection.sceneId : null,
        evidence: [{ anchorStart, anchorEnd: anchorStart + quote.length, quotedText: quote }],
        confidence: 0.8,
        rationale: "Proposed from the current Scene evidence.",
        proposedBy: "user",
        requestId: requestId("fact-patch-propose"),
        actorId: "local-user",
      });
      mergePatchProposalResult(selection, result);
      if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
      await loadPatchReview(selection, "refreshing");
      if (isCurrentPatchResponse(patchSelectionRef.current, selection)) setStatusMessage("Canon Patch proposed for review.");
    } catch (error) {
      if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
      setPatchState(selection, { loading: false, action: null, error: humanError(error, "The fact candidate could not be proposed."), latestConflict: null });
      setStatusMessage("Fact proposal failed; the script remains saved.");
    }
  }, [freshDocument, loadPatchReview, mergePatchProposalResult, projectId, revision, revisionDirty, setPatchState]);

  const proposeStateCandidate = React.useCallback(async (selection: PatchReviewState["selection"], draft: StateCandidateDraft) => {
    if (!freshDocument || !revision || !documentId || !isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
    if (revisionDirty) {
      setPatchState(selection, { error: "Save this Scene revision before proposing State so its continuity group is frozen." });
      setStatusMessage("Save the revision before proposing Scene State.");
      return;
    }
    const sceneRevision = revision.sceneRevisions.find((item) => item.id === selection.sceneRevisionId && item.sceneId === selection.sceneId);
    const entity = confirmedCharacters.find((candidate) => candidate.id === draft.entityId);
    if (!sceneRevision || !entity || entity.type !== "character") return;
    const quote = draft.evidenceQuote.trim();
    const anchorStart = quote ? sceneRevision.content.indexOf(quote) : -1;
    if (anchorStart < 0 || anchorStart + quote.length > sceneRevision.content.length) {
      setPatchState(selection, { error: "Evidence quote must be present in the current Scene text." });
      setStatusMessage("State Patch proposal needs evidence from this Scene revision.");
      return;
    }
    const input: StatePatchProposalInput = {
      documentId,
      sceneId: selection.sceneId,
      sceneRevisionId: selection.sceneRevisionId,
      subjectEntityId: entity.id,
      predicate: draft.predicate,
      value: draft.value,
      valueType: draft.valueType,
      carryForward: draft.carryForward,
      priority: draft.priority,
      validToSceneId: null,
      baseVersion: entity.version,
      evidence: [{ anchorStart, anchorEnd: anchorStart + quote.length, quotedText: quote }],
      requestId: requestId("state-patch-propose"),
      actorId: "local-user",
    };
    setPatchState(selection, { loading: true, action: "proposing", error: null, latestConflict: null });
    try {
      const result = await proposeStatePatch(projectId, selection.sceneId, input);
      mergePatchProposalResult(selection, result);
      if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
      await loadPatchReview(selection, "refreshing");
      if (isCurrentPatchResponse(patchSelectionRef.current, selection)) setStatusMessage("Scene State Patch proposed for review.");
    } catch (error) {
      if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
      setPatchState(selection, { loading: false, action: null, error: humanError(error, "The Scene State Patch could not be proposed."), latestConflict: null });
      setStatusMessage("State proposal failed; the script remains saved.");
    }
  }, [confirmedCharacters, documentId, freshDocument, loadPatchReview, mergePatchProposalResult, projectId, revision, revisionDirty, setPatchState]);

  const runAnalysis = React.useCallback(async () => {
    if (!freshDocument || !selectedScene || !selectedRevisionId || !revision || selectedAnalysis?.action === "running") return;
    const selection = { sceneId: selectedScene.id, sceneRevisionId: selectedRevisionId };
    analysisSelectionRef.current = selection;
    const key = analysisSelectionKey(selection);
    const sceneRevision = revision.sceneRevisions.find((scene) => scene.id === selectedRevisionId);
    if (!sceneRevision) return;
    setAnalysisState(selection, { loading: true, status: "queued", action: "running", error: null });
    setStatusMessage(`Analysis queued for ${sceneLabel(selectedScene)}.`);
    try {
      const queued = await enqueueAnalysis(projectId, {
        documentId: freshDocument.id,
        sceneId: selection.sceneId,
        sceneRevisionId: selection.sceneRevisionId,
        contentHash: sceneRevision.contentHash,
        analyzerVersion: "deterministic-v1",
        requestId: requestId("analysis-enqueue"),
        actorId: "local-user",
      });
      if (!isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return;
      setAnalysisState(selection, { status: queued.status, run: queued, loading: true, action: "running" });
      const executed = await executeAnalysis(projectId, queued.id, { requestId: requestId("analysis-execute") });
      if (!isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return;
      setAnalysisState(selection, { status: executed.status, run: executed, loading: true, action: "reviewing-links" });
      await loadReview(selection, "reviewing-links");
      if (isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) {
        setStatusMessage(`Analysis ${statusLabel(executed.status, false).toLocaleLowerCase()} for ${sceneLabel(selectedScene)}.`);
      }
    } catch (error) {
      if (!isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return;
      setAnalysisByKey((current) => ({
        ...current,
        [key]: {
          selection,
          loading: false,
          status: "failed",
          run: current[key]?.run ?? null,
          review: current[key]?.review ?? null,
          error: humanError(error, "Analysis could not be completed. Try again."),
          action: null,
        },
      }));
      setStatusMessage("Analysis failed; the script remains saved.");
    }
  }, [freshDocument, loadReview, projectId, revision, selectedAnalysis?.action, selectedRevisionId, selectedScene, setAnalysisState]);

  const buildContext = React.useCallback(async () => {
    const selection = selectedContextSelection;
    if (!selection || revisionDirty) return;
    const key = contextSelectionKey(selection);
    const current = contextByKeyRef.current[key];
    if (current?.building || current?.loading) return;
    contextSelectionRef.current = selection;
    setContextByKey((records) => ({
      ...records,
      [key]: {
        selection,
        loading: false,
        building: true,
        loaded: current?.loaded ?? false,
        snapshot: current?.snapshot ?? null,
        error: null,
      },
    }));
    setStatusMessage(`Building ${selection.purpose} Context Snapshot…`);
    try {
      const result = await buildContextSnapshot(projectId, {
        sceneId: selection.sceneId,
        sceneRevisionId: selection.sceneRevisionId,
        purpose: selection.purpose,
        policyId: selection.policyId,
        allowInferred: false,
        requestId: requestId("context-build"),
        actorId: "local-user",
      });
      if (!isCurrentContextResponse(contextSelectionRef.current, selection)) return;
      setContextByKey((records) => ({
        ...records,
        [key]: { selection, loading: false, building: false, loaded: true, snapshot: result.snapshot, error: null },
      }));
      setStatusMessage(result.idempotent ? "Context Snapshot replayed." : "Context Snapshot built. No Provider submission was made.");
    } catch (error) {
      if (!isCurrentContextResponse(contextSelectionRef.current, selection)) return;
      setContextByKey((records) => ({
        ...records,
        [key]: {
          selection,
          loading: false,
          building: false,
          loaded: true,
          snapshot: records[key]?.snapshot ?? null,
          error: humanError(error, "Context Snapshot could not be built."),
        },
      }));
      setStatusMessage("Context build failed; the script remains available.");
    }
  }, [projectId, revisionDirty, selectedContextSelection]);

  const reviewLink = React.useCallback(async (link: SceneEntityLink, decision: "confirmed" | "rejected") => {
    if (!selectedScene || !selectedRevisionId || !selectedAnalysis) return;
    const selection = { sceneId: selectedScene.id, sceneRevisionId: selectedRevisionId };
    const key = analysisSelectionKey(selection);
    setAnalysisState(selection, { loading: true, action: "reviewing-links", error: null });
    try {
      await reviewSceneEntityLink(projectId, selectedScene.id, link.id, {
        status: decision,
        expectedVersion: link.version,
        expectedSceneRevisionId: selectedRevisionId,
        requestId: requestId("entity-link-review"),
        actorId: "local-user",
      });
      if (!isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return;
      await loadReview(selection, "reviewing-links");
      setStatusMessage(`Link ${decision === "confirmed" ? "confirmed" : "rejected"}.`);
    } catch (error) {
      if (!isCurrentAnalysisResponse(analysisSelectionRef.current, selection)) return;
      setAnalysisByKey((current) => ({
        ...current,
        [key]: {
          ...current[key],
          loading: false,
          action: null,
          error: humanError(error, "The entity link could not be updated. Refresh the review and try again."),
        },
      }));
    }
  }, [loadReview, projectId, selectedAnalysis, selectedRevisionId, selectedScene, setAnalysisState]);

  const createProjectEntity = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = canonicalName.trim();
    if (!name || entitySaving) return;
    setEntitySaving(true);
    setEntityError(null);
    try {
      const created = await createEntity(projectId, {
        type: entityType,
        entityType,
        canonicalName: name,
        status: "draft",
        attributes: {},
        requestId: requestId("entity-create"),
        actorId: "local-user",
      });
      setEntities((current) => replaceCanonicalEntity(current, created));
      const aliasValue = alias.trim();
      if (aliasValue && aliasValue !== name) {
        await createEntityAlias(projectId, created.id, {
          alias: aliasValue,
          locale: null,
          requestId: requestId("alias-create"),
          actorId: "local-user",
        });
      }
      setCanonicalName("");
      setAlias("");
      setEntityFormOpen(false);
      setStatusMessage(`${entityTypeLabels[entityType]} ${name} created.`);
    } catch (error) {
      setEntityError(humanError(error, "The entity could not be created. Try again."));
      setStatusMessage("Entity creation failed.");
    } finally {
      setEntitySaving(false);
    }
  }, [alias, canonicalName, entitySaving, entityType, projectId]);

  const createProjectContinuityGroup = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!freshDocument || groupSaving) return;
    const name = groupName.trim();
    if (!name) return;
    setGroupSaving(true);
    setContinuityGroupsError(null);
    try {
      const created = await createContinuityGroup(projectId, freshDocument.id, {
        name,
        kind: groupKind,
        requestId: requestId("continuity-group-create"),
        actorId: "local-user",
      });
      setContinuityGroups((current) => replaceCanonicalRecord(current, created));
      if (selectedSceneId) updateScene(selectedSceneId, { continuityGroupId: created.id });
      setGroupName("");
      setGroupFormOpen(false);
      setStatusMessage(`Continuity group “${created.name}” created and selected.`);
    } catch (error) {
      setContinuityGroupsError(humanError(error, "The continuity group could not be created."));
      setStatusMessage("Continuity group creation failed.");
    } finally {
      setGroupSaving(false);
    }
  }, [freshDocument, groupKind, groupName, groupSaving, projectId, selectedSceneId, updateScene]);

  if (!document) {
    return (
      <ScriptsEmptySection onCreate={onCreateDocument} />
    );
  }

  return (
    <section aria-labelledby="scripts-heading" className="min-w-0">
      <div aria-live="polite" className="mb-5 min-h-6 text-sm text-ink-muted">{statusMessage}</div>
      <header className="border-b border-line pb-6">
        <p className="text-sm text-ink-faint">Scripts</p>
        <h2 id="scripts-heading" className="mt-3 break-words text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{freshDocument?.title || document.title}</h2>
        <p className="mt-3 max-w-[64ch] text-sm leading-6 text-ink-muted">Edit stable scenes, save immutable revisions, then review entity links for one scene at a time.</p>
      </header>

      {documentError ? <p role="alert" className="mt-5 border-l-2 border-danger pl-3 text-sm leading-6 text-danger">{documentError}</p> : null}
      {revisionError ? <p role="alert" className="mt-5 border-l-2 border-danger pl-3 text-sm leading-6 text-danger">{revisionError}</p> : null}

      {documentLoading ? (
        <p className="mt-8 text-sm text-ink-muted">Loading the current immutable revision…</p>
      ) : (
        <div className="mt-8 grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-ink">Scenes</h3>
                <p className="mt-1 text-sm text-ink-faint">{activeSceneList.length} active {activeSceneList.length === 1 ? "scene" : "scenes"}{revision ? ` · revision ${revision.revisionNumber}` : " · unsaved document"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={addScene} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-ink-muted transition-colors hover:border-accent hover:text-accent"><Plus size={17} aria-hidden="true" /> Add scene</button>
                <button type="button" onClick={() => void saveRevision()} disabled={!revisionDirty || revisionSaving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50">{revisionSaving ? "Saving revision" : "Save revision"}</button>
              </div>
            </div>

            {activeSceneList.length > 0 ? (
              <ol aria-label="Script scenes" className="mt-5 space-y-2">
                {activeSceneList.map((scene, index) => {
                  const selected = scene.id === selectedSceneId;
                  return (
                    <li key={scene.id} className={`min-w-0 rounded-lg border ${selected ? "border-accent bg-surface-raised shadow-sm" : "border-line bg-surface"}`}>
                      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                        <button type="button" onClick={() => selectScene(scene.id)} aria-pressed={selected} className={`min-h-11 min-w-0 flex-1 break-words text-left text-sm ${selected ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"}`}><span className="mr-2 font-mono text-xs text-ink-faint">{String(index + 1).padStart(2, "0")}</span>{sceneLabel(scene)}</button>
                        <button type="button" onClick={() => moveScene(scene.id, -1)} disabled={index === 0} aria-label={`Move ${sceneLabel(scene)} up`} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-ink-faint hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"><ArrowUp size={16} aria-hidden="true" /></button>
                        <button type="button" onClick={() => moveScene(scene.id, 1)} disabled={index === activeSceneList.length - 1} aria-label={`Move ${sceneLabel(scene)} down`} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-ink-faint hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"><ArrowDown size={16} aria-hidden="true" /></button>
                        <button type="button" onClick={() => removeScene(scene.id)} aria-label={`Remove ${sceneLabel(scene)}`} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-ink-faint hover:bg-danger/10 hover:text-danger"><Trash size={16} aria-hidden="true" /></button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="mt-5 border-l-2 border-line pl-4">
                <p className="text-sm font-semibold text-ink">No active scenes yet.</p>
                <p className="mt-2 text-sm leading-6 text-ink-muted">Add a scene to start a revision. Saving creates the immutable document revision used by analysis.</p>
              </div>
            )}

            {selectedScene ? (
              <div className="mt-8 min-w-0 rounded-lg border border-line bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Scene editor</p>
                    <h3 className="mt-2 break-words text-lg font-semibold text-ink">{sceneLabel(selectedScene)}</h3>
                  </div>
                  <span className="break-all font-mono text-[11px] text-ink-faint">{selectedScene.id}</span>
                </div>
                <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="scene-title">Title</label>
                <input id="scene-title" value={selectedScene.title} onChange={(event) => updateScene(selectedScene.id, { title: event.target.value })} className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink" maxLength={300} />
                <div className="mt-5 min-w-0 rounded-lg border border-line bg-surface-raised p-3">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <label className="block text-sm font-semibold text-ink" htmlFor="scene-continuity-group">Continuity group</label>
                      <p className="mt-1 text-xs leading-5 text-ink-faint">State carries only within this lane. Flashbacks and dreams stay isolated.</p>
                    </div>
                    <button type="button" onClick={() => setGroupFormOpen((open) => !open)} className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent"><Plus size={14} aria-hidden="true" /> {groupFormOpen ? "Close" : "New group"}</button>
                  </div>
                  <select id="scene-continuity-group" aria-label="Continuity group" value={selectedScene.continuityGroupId} onChange={(event) => updateScene(selectedScene.id, { continuityGroupId: event.target.value })} disabled={continuityGroupsLoading || continuityGroups.length === 0} className="mt-3 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm text-ink">
                    {continuityGroups.length === 0 ? <option value="">{continuityGroupsLoading ? "Loading groups…" : "No groups available"}</option> : continuityGroups.map((group) => <option key={group.id} value={group.id}>{group.name}{group.isDefault ? " · main" : ` · ${group.kind}`}</option>)}
                  </select>
                  {continuityGroupsError ? <p role="alert" className="mt-2 break-words text-xs leading-5 text-danger">{continuityGroupsError}</p> : null}
                  {groupFormOpen ? (
                    <form onSubmit={(event) => void createProjectContinuityGroup(event)} className="mt-3 min-w-0 border-t border-line pt-3">
                      <label className="block text-xs font-semibold text-ink" htmlFor="continuity-group-kind">Group type</label>
                      <select id="continuity-group-kind" value={groupKind} onChange={(event) => setGroupKind(event.target.value as ContinuityGroupKind)} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink">
                        <option value="main" disabled>Main (the default group already exists)</option>
                        <option value="flashback">Flashback</option>
                        <option value="dream">Dream</option>
                        <option value="parallel">Parallel</option>
                        <option value="custom">Custom</option>
                      </select>
                      <label className="mt-3 block text-xs font-semibold text-ink" htmlFor="continuity-group-name">Group name</label>
                      <input id="continuity-group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} required maxLength={200} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink" placeholder="e.g. Main timeline" />
                      <button type="submit" disabled={groupSaving || !groupName.trim()} className="mt-3 inline-flex min-h-10 items-center rounded-md bg-accent px-3 text-xs font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">{groupSaving ? "Creating group" : "Create and use group"}</button>
                    </form>
                  ) : null}
                </div>
                <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="scene-content">Content</label>
                <textarea id="scene-content" value={selectedScene.content} onChange={(event) => updateScene(selectedScene.id, { content: event.target.value })} className="mt-2 min-h-56 w-full min-w-0 resize-y rounded-lg border border-line bg-surface-raised px-3 py-3 text-sm leading-6 text-ink" maxLength={200000} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-faint"><span>{revisionDirty ? "Unsaved changes" : "Saved"}</span><span>{selectedScene.content.length.toLocaleString()} characters</span></div>
              </div>
            ) : null}
          </div>

          <aside className="min-w-0 xl:border-l xl:border-line xl:pl-7" aria-labelledby="scene-analysis-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="scene-analysis-heading" className="break-words text-base font-semibold text-ink">Entity review</h3>
                <p className="mt-1 text-sm leading-6 text-ink-muted">Analysis is separate from saving and navigation.</p>
              </div>
              <button type="button" onClick={() => void runAnalysis()} disabled={!selectedScene || !selectedRevisionId || revisionDirty || selectedAnalysis?.action === "running" || selectedAnalysis?.loading === true} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"><Play size={16} aria-hidden="true" />{selectedAnalysis?.status === "failed" || selectedAnalysis?.status === "stale" ? "Retry analysis" : "Analyze scene"}</button>
            </div>
            {revisionDirty ? <p className="mt-3 text-xs leading-5 text-ink-faint">Save this revision before starting analysis.</p> : null}
            {selectedScene && selectedRevisionId ? (
              <div className="mt-5 min-w-0" aria-busy={selectedAnalysis?.loading || undefined}>
                <p className={`text-sm font-semibold ${statusTone(selectedAnalysis?.status ?? null)}`}>Status: {statusLabel(selectedAnalysis?.status ?? null, selectedAnalysis?.loading ?? false)}</p>
                {selectedAnalysis?.error ? <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-sm leading-6 text-danger">{selectedAnalysis.error}</p> : null}
                {selectedAnalysis?.loading && selectedAnalysis.action ? <p className="mt-3 text-xs text-ink-faint">{selectedAnalysis.action === "running" ? "The worker is processing this revision." : "Refreshing evidence and candidate links."}</p> : null}
                <EntityReviewList review={selectedAnalysis?.review ?? null} entities={entities} entityLoading={entityLoading} sceneContent={selectedScene.content} onReviewLink={(link, decision) => void reviewLink(link, decision)} disabled={selectedAnalysis?.loading ?? false} />
                <CanonPatchReviewPanel
                  review={selectedPatchReview}
                  sceneContent={selectedScene.content}
                  entities={associatedEntities}
                  confirmedCharacters={confirmedCharacters}
                  stateProps={stateProps}
                  loading={selectedPatchState?.loading ?? false}
                  error={selectedPatchState?.error ?? null}
                  latestConflict={selectedPatchState?.latestConflict ?? null}
                  resolvedState={selectedResolvedState?.state ?? null}
                  resolvedStateLoading={selectedResolvedState?.loading ?? false}
                  resolvedStateError={selectedResolvedState?.error ?? null}
                  contextState={selectedContext}
                  contextPurpose={contextPurpose}
                  contextPolicyId={contextPolicyId}
                  contextDisabled={revisionDirty || !selectedScene || !selectedRevisionId || Boolean(selectedContext?.loading) || Boolean(selectedContext?.building)}
                  hasSavedRevision={Boolean(selectedScene && selectedRevisionId && !revisionDirty)}
                  hasScene={Boolean(selectedScene)}
                  onContextPurposeChange={setContextPurpose}
                  onBuildContext={() => void buildContext()}
                  actions={selectedPatchState && !revisionDirty ? {
                    onAccept: (patch, request) => void runPatchMutation(selectedPatchState.selection, patch, "accept", request),
                    onAcceptEdited: (patch, payload, request) => void runPatchMutation(selectedPatchState.selection, patch, "accept-edited", request, payload),
                    onReject: (patch, reason, request) => void runPatchMutation(selectedPatchState.selection, patch, "reject", request, undefined, reason),
                  } : undefined}
                  onPropose={selectedPatchState && !revisionDirty ? (draft) => void proposeCandidate(selectedPatchState.selection, draft) : undefined}
                  onProposeState={selectedPatchState && !revisionDirty ? (draft) => void proposeStateCandidate(selectedPatchState.selection, draft) : undefined}
                  stateProposalBlocked={revisionDirty}
                />
              </div>
            ) : (
              <p className="mt-5 border-l-2 border-line pl-3 text-sm leading-6 text-ink-faint">Save at least one scene to review its entity mentions.</p>
            )}

            <div className="mt-8 border-t border-line pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-ink">Entity cards</h3>
                  <p className="mt-1 text-sm text-ink-muted">Project-scoped Character, Location, and Prop records.</p>
                </div>
                <button type="button" onClick={() => { setEntityFormOpen((open) => !open); setEntityError(null); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-ink-muted hover:border-accent hover:text-accent"><Plus size={16} aria-hidden="true" /> {entityFormOpen ? "Close" : "New entity"}</button>
              </div>
              {entityFormOpen ? (
                <form onSubmit={(event) => void createProjectEntity(event)} className="mt-4 rounded-lg border border-line bg-surface p-4">
                  <label className="block text-sm font-semibold text-ink" htmlFor="entity-type">Type</label>
                  <select id="entity-type" value={entityType} onChange={(event) => setEntityType(event.target.value as EntityType)} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink">
                    {(Object.keys(entityTypeLabels) as EntityType[]).map((type) => <option key={type} value={type}>{entityTypeLabels[type]}</option>)}
                  </select>
                  <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="entity-name">Canonical name</label>
                  <input id="entity-name" value={canonicalName} onChange={(event) => setCanonicalName(event.target.value)} required maxLength={200} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink" />
                  <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="entity-alias">Alias <span className="font-normal text-ink-faint">(optional)</span></label>
                  <input id="entity-alias" value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={200} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink" />
                  {entityError ? <p role="alert" className="mt-3 text-sm leading-6 text-danger">{entityError}</p> : null}
                  <button type="submit" disabled={entitySaving || !canonicalName.trim()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50">{entitySaving ? "Creating entity" : "Create entity"}</button>
                </form>
              ) : null}
              <EntityCards entities={entities} />
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function EntityReviewList({
  review,
  entities,
  entityLoading,
  sceneContent,
  onReviewLink,
  disabled,
}: {
  review: SceneEntityReview | null;
  entities: Entity[];
  entityLoading: boolean;
  sceneContent: string;
  onReviewLink: (link: SceneEntityLink, decision: "confirmed" | "rejected") => void;
  disabled: boolean;
}) {
  if (entityLoading && !review) return <p className="mt-5 text-sm text-ink-faint">Loading entity cards…</p>;
  if (!review) return <p className="mt-5 border-l-2 border-line pl-3 text-sm leading-6 text-ink-faint">No analysis has been run for this Scene revision.</p>;
  if (review.links.length === 0) return <p className="mt-5 border-l-2 border-line pl-3 text-sm leading-6 text-ink-faint">No entity mentions found in this revision.</p>;
  return (
    <ul aria-label="Entity candidate links" className="mt-5 space-y-4">
      {review.links.map((link) => {
        const entity = entityForLink(link, [...review.entities, ...entities]);
        const mention = mentionForLink(link, review.mentions);
        const evidence = evidenceForLink(link, review.mentions, review.evidenceSources);
        const candidate = link.status === "candidate";
        return (
          <li key={link.id} className="min-w-0 rounded-lg border border-line bg-surface p-4">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-ink">{mention} <span className="font-normal text-ink-faint">→</span> {entity?.canonicalName ?? link.entityId}</p>
                <p className={`mt-1 text-xs font-semibold uppercase tracking-[0.08em] ${link.status === "confirmed" ? "text-success" : link.status === "rejected" ? "text-ink-faint" : link.status === "stale" ? "text-danger" : "text-accent"}`}>{link.status}</p>
              </div>
              {candidate ? (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={() => onReviewLink(link, "confirmed")} disabled={disabled} aria-label={`Confirm mention ${mention} as ${entity?.canonicalName ?? link.entityId}`} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-success px-2 text-xs font-semibold text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50"><Check size={15} aria-hidden="true" /> Confirm</button>
                  <button type="button" onClick={() => onReviewLink(link, "rejected")} disabled={disabled} aria-label={`Reject mention ${mention} as ${entity?.canonicalName ?? link.entityId}`} className="inline-flex min-h-10 items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold text-ink-muted hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"><X size={15} aria-hidden="true" /> Reject</button>
                </div>
              ) : null}
            </div>
            {evidence.length > 0 ? (
              <ul aria-label={`Evidence for ${mention}`} className="mt-3 space-y-2">
                {evidence.map((source) => <li key={source.id} className="break-words whitespace-pre-wrap border-l-2 border-line pl-3 text-xs leading-5 text-ink-muted">{source.quotedText || mention}</li>)}
              </ul>
              ) : <p className="mt-3 break-words whitespace-pre-wrap text-xs leading-5 text-ink-faint">Evidence: {mentionSnippet(mention, link, review.mentions, sceneContent)}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Phase 2 review panel. It is intentionally present even while the server
 * read model is empty: authors can see the Canon/Inference/Pending vocabulary
 * and the review affordances without the editor pretending that an AI result
 * is already active Canon. Mutating callbacks stay revision-scoped so a late
 * response cannot replace the current review.
 */
function CanonPatchReviewPanel({
  review,
  sceneContent,
  entities,
  confirmedCharacters,
  stateProps,
  loading,
  error,
  latestConflict,
  actions,
  onPropose,
  onProposeState,
  stateProposalBlocked,
  resolvedState,
  resolvedStateLoading,
  resolvedStateError,
  contextState,
  contextPurpose,
  contextPolicyId,
  contextDisabled,
  hasSavedRevision,
  hasScene,
  onContextPurposeChange,
  onBuildContext,
}: {
  review: ScenePatchReview | null;
  sceneContent: string;
  entities: readonly Entity[];
  confirmedCharacters: readonly Entity[];
  stateProps: readonly Entity[];
  loading: boolean;
  error: string | null;
  latestConflict: WorkspacePatch | null;
  actions?: PatchReviewActionHandlers;
  onPropose?: (draft: FactCandidateDraft) => void;
  onProposeState?: (draft: StateCandidateDraft) => void;
  stateProposalBlocked: boolean;
  resolvedState: ResolvedState | null;
  resolvedStateLoading: boolean;
  resolvedStateError: string | null;
  contextState: ContextState | null;
  contextPurpose: ContextPurpose;
  contextPolicyId: ContextPolicyId;
  contextDisabled: boolean;
  hasSavedRevision: boolean;
  hasScene: boolean;
  onContextPurposeChange: (purpose: ContextPurpose) => void;
  onBuildContext: () => void;
}) {
  return (
    <section className="mt-8 min-w-0 border-t border-line pt-6" aria-labelledby="canon-patch-review-heading" data-testid="canon-patch-review">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Phase 2–3</p>
          <h3 id="canon-patch-review-heading" className="mt-2 break-words text-base font-semibold text-ink">Canon review</h3>
          <p className="mt-1 max-w-[48ch] text-sm leading-6 text-ink-muted">Inference evidence and a Pending Canon Patch stay separate from active Canon until review.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]" aria-label="Canon review legend">
          <span className="rounded-md border border-line px-2 py-1 text-ink-faint">Canon</span>
          <span className="rounded-md border border-accent/40 px-2 py-1 text-accent">Inference</span>
          <span className="rounded-md border border-line px-2 py-1 text-ink-muted">Pending</span>
        </div>
      </div>

      {loading ? <p className="mt-4 text-xs text-accent" aria-live="polite">Refreshing Patch review…</p> : null}
      {error ? <p role="alert" className="mt-4 border-l-2 border-danger pl-3 text-xs leading-5 text-danger">{error}</p> : null}
      {latestConflict ? <PatchConflictPreview patch={latestConflict} /> : null}

      {review && review.patches.length > 0 ? (
        <ul aria-label="Pending Canon patches" className="mt-5 space-y-4">
          {review.patches.map((patch) => <CanonPatchCard
            key={patch.id}
            patch={patch}
            evidenceSources={review.evidenceSources}
            application={review.applications.find((application) => application.patchId === patch.id) ?? null}
            targetFact={patch.targetFactId ? review.facts.find((fact) => fact.id === patch.targetFactId) ?? null : null}
            resultingFact={(() => {
              const application = review.applications.find((candidate) => candidate.patchId === patch.id);
              return application?.resultingFactId ? review.facts.find((fact) => fact.id === application.resultingFactId) ?? null : null;
            })()}
            resultingState={(() => {
              const application = review.applications.find((candidate) => candidate.patchId === patch.id);
              return application?.resultingStateId ? review.states.find((state) => state.id === application.resultingStateId) ?? null : null;
            })()}
            sceneContent={sceneContent}
            actions={actions}
          />)}
        </ul>
      ) : (
        <div className="mt-5 border-l-2 border-line pl-3" data-testid="canon-patch-empty">
          <p className="text-sm font-semibold text-ink">No Patch proposals for this Scene revision.</p>
          <p className="mt-2 text-xs leading-5 text-ink-faint">A fact candidate saves an Inference beside a Pending Canon Patch. It cannot silently activate Canon.</p>
        </div>
      )}

      <FactCandidateComposer entities={entities} sceneContent={sceneContent} onPropose={onPropose} />
      <StatePatchComposer characters={confirmedCharacters} props={stateProps} sceneContent={sceneContent} onPropose={onProposeState} blockedByUnsavedRevision={stateProposalBlocked} />
      <ResolvedStateInspector entities={entities} state={resolvedState} loading={resolvedStateLoading} error={resolvedStateError} />
      <ContextInspector
        state={contextState}
        purpose={contextPurpose}
        policyId={contextPolicyId}
        disabled={contextDisabled}
        hasSavedRevision={hasSavedRevision}
        hasScene={hasScene}
        onPurposeChange={onContextPurposeChange}
        onBuild={onBuildContext}
      />
    </section>
  );
}

function PatchConflictPreview({ patch }: { patch: WorkspacePatch }) {
  return (
    <div className="mt-4 rounded-md border border-danger/40 bg-danger/5 p-3" data-testid={`patch-conflict-${patch.id}`}>
      <p className="text-xs font-semibold text-danger">Latest server Patch · version {patch.version}</p>
      <p className="mt-1 text-xs leading-5 text-danger">{patchConflictLabel(patch.conflictKind)}: {patch.conflictMessage || "The Patch changed while it was being reviewed."}</p>
      <p className="mt-2 break-words font-mono text-[11px] text-ink-muted">{patch.id}</p>
    </div>
  );
}

function FactCandidateComposer({ entities, sceneContent, onPropose }: { entities: readonly Entity[]; sceneContent: string; onPropose?: (draft: FactCandidateDraft) => void }) {
  const [entityId, setEntityId] = React.useState(entities[0]?.id ?? "");
  const [predicate, setPredicate] = React.useState(Object.keys(predicateSchemaRegistry)[0] ?? "");
  const [scope, setScope] = React.useState<string>(predicateSchemaRegistry[predicate]?.scopes[0] ?? "base");
  const [value, setValue] = React.useState("");
  const [evidenceQuote, setEvidenceQuote] = React.useState("");
  const definition = predicateSchemaRegistry[predicate];
  const selectedEntityId = entities.some((entity) => entity.id === entityId) ? entityId : entities[0]?.id ?? "";
  const effectiveScope = definition?.scopes.some((candidateScope) => candidateScope === scope) ? scope : definition?.scopes[0] ?? "base";
  const compatiblePredicates = Object.entries(predicateSchemaRegistry).filter(([candidatePredicate, candidate]) => {
    if (!isFactPredicate(candidatePredicate)) return false;
    const entity = entities.find((item) => item.id === selectedEntityId);
    return !candidate.entityTypes || !entity || candidate.entityTypes.includes(entity.type);
  });

  return (
    <form className="mt-6 min-w-0 rounded-lg border border-line bg-surface p-4" onSubmit={(event) => {
      event.preventDefault();
      if (!onPropose || !selectedEntityId || !definition || !value.trim() || !evidenceQuote.trim()) return;
      onPropose({ entityId: selectedEntityId, predicate, value: candidateValueFromInput(value, definition.valueType), valueType: definition.valueType, scope: effectiveScope as FactScope, evidenceQuote });
    }} data-testid="fact-candidate-composer">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="break-words text-sm font-semibold text-ink">Propose a Canon Patch</h4>
          <p className="mt-1 text-xs leading-5 text-ink-muted">Save an Inference and Pending Canon Patch for review; this form never activates Canon directly.</p>
        </div>
        <span className="rounded-md border border-accent/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">Inference + Pending Canon</span>
      </div>
      <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="candidate-entity">Entity</label>
      <select id="candidate-entity" value={selectedEntityId} onChange={(event) => setEntityId(event.target.value)} disabled={entities.length === 0} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink">
        {entities.length === 0 ? <option value="">Run analysis or create an entity first</option> : entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.canonicalName} · {entity.type}</option>)}
      </select>
      <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="candidate-predicate">Schema predicate</label>
      <select id="candidate-predicate" value={predicate} onChange={(event) => setPredicate(event.target.value)} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink">
        {compatiblePredicates.map(([key]) => <option key={key} value={key}>{key}</option>)}
      </select>
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="block text-xs font-semibold text-ink" htmlFor="candidate-scope">Scope</label>
          <select id="candidate-scope" value={effectiveScope} onChange={(event) => setScope(event.target.value)} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink">
            {(definition?.scopes ?? []).map((candidateScope) => <option key={candidateScope} value={candidateScope}>{candidateScope}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-semibold text-ink" htmlFor="candidate-value">Value <span className="font-normal text-ink-faint">({definition?.valueType ?? "text"})</span></label>
          <input id="candidate-value" value={value} onChange={(event) => setValue(event.target.value)} maxLength={2000} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink" placeholder="e.g. silver earring" />
        </div>
      </div>
      <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="candidate-evidence">Evidence quote</label>
      <textarea id="candidate-evidence" value={evidenceQuote} onChange={(event) => setEvidenceQuote(event.target.value)} maxLength={20000} className="mt-2 min-h-16 w-full min-w-0 resize-y rounded-md border border-line bg-surface-raised px-3 py-2 text-xs leading-5 text-ink" placeholder={sceneContent ? "Paste the exact phrase from this Scene revision" : "No Scene text available"} />
      <button type="submit" disabled={!onPropose || !selectedEntityId || !predicate || !value.trim() || !evidenceQuote.trim()} className="mt-4 inline-flex min-h-10 items-center rounded-md border border-accent px-3 text-xs font-semibold text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-45">Propose Canon Patch</button>
      <p className="mt-2 text-[11px] leading-5 text-ink-faint">Evidence must be an exact span from the current SceneRevision; the server will validate it before creating an Inference and Pending Patch.</p>
    </form>
  );
}

function StatePatchComposer({
  characters,
  props,
  sceneContent,
  onPropose,
  blockedByUnsavedRevision,
}: {
  characters: readonly Entity[];
  props: readonly Entity[];
  sceneContent: string;
  onPropose?: (draft: StateCandidateDraft) => void;
  blockedByUnsavedRevision: boolean;
}) {
  const [characterId, setCharacterId] = React.useState(characters[0]?.id ?? "");
  const [predicate, setPredicate] = React.useState<StateCandidateDraft["predicate"]>("wardrobe.current");
  const [value, setValue] = React.useState("");
  const [carryForward, setCarryForward] = React.useState(false);
  const [evidenceQuote, setEvidenceQuote] = React.useState("");
  const selectedCharacterId = characters.some((entity) => entity.id === characterId) ? characterId : characters[0]?.id ?? "";
  const selectedPropId = predicate === "state.held_prop" && props.some((entity) => entity.id === value) ? value : props[0]?.id ?? "";
  const effectiveValue = predicate === "state.held_prop" ? selectedPropId : value;
  const valueType = predicate === "state.held_prop" ? "entity_ref" as const : "string" as const;
  return (
    <form className="mt-6 min-w-0 rounded-lg border border-accent/30 bg-accent/5 p-4" onSubmit={(event) => {
      event.preventDefault();
      if (!onPropose || !selectedCharacterId || !effectiveValue || !evidenceQuote.trim()) return;
      onPropose({ entityId: selectedCharacterId, predicate, value: effectiveValue, valueType, carryForward, priority: 100, evidenceQuote });
    }} data-testid="state-patch-composer">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="break-words text-sm font-semibold text-ink">Propose Scene State</h4>
          <p className="mt-1 text-xs leading-5 text-ink-muted">State is temporary, revision-bound, and separate from Character Base, Inference, and Canon Fact.</p>
        </div>
        <span className="rounded-md border border-accent/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">State · pending review</span>
      </div>
      <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="state-entity">Confirmed character</label>
      <select id="state-entity" value={selectedCharacterId} onChange={(event) => setCharacterId(event.target.value)} disabled={characters.length === 0} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink">
        {characters.length === 0 ? <option value="">Confirm a character link in this Scene first</option> : characters.map((entity) => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}
      </select>
      <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="state-predicate">State predicate</label>
      <select id="state-predicate" value={predicate} onChange={(event) => { const next = event.target.value as StateCandidateDraft["predicate"]; setPredicate(next); if (next === "state.held_prop") setValue(""); }} disabled={characters.length === 0} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink">
        <option value="wardrobe.current">wardrobe.current · Current wardrobe</option>
        <option value="state.injury">state.injury · Injury</option>
        <option value="state.held_prop">state.held_prop · Held prop</option>
      </select>
      {predicate === "state.held_prop" ? (
        <>
          <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="state-prop">Active or draft Prop</label>
          <select id="state-prop" value={selectedPropId} onChange={(event) => setValue(event.target.value)} disabled={props.length === 0 || characters.length === 0} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink">
            {props.length === 0 ? <option value="">Create an active or draft Prop first</option> : props.map((prop) => <option key={prop.id} value={prop.id}>{prop.canonicalName} · {prop.status}</option>)}
          </select>
        </>
      ) : (
        <>
          <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="state-value">State value</label>
          <input id="state-value" value={value} onChange={(event) => setValue(event.target.value)} maxLength={2000} disabled={characters.length === 0} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink" placeholder={predicate === "wardrobe.current" ? "e.g. faded black coat" : "e.g. left shoulder is bandaged"} />
        </>
      )}
      <label className="mt-4 flex min-w-0 items-start gap-2 text-xs text-ink" htmlFor="state-carry-forward"><input id="state-carry-forward" type="checkbox" checked={carryForward} onChange={(event) => setCarryForward(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-accent" /> <span><span className="font-semibold">Carry forward within this group</span><span className="mt-1 block text-ink-faint">Never crosses into another continuity group.</span></span></label>
      <p className="mt-3 text-[11px] text-ink-faint">Priority: 100 (explicit author state default)</p>
      <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="state-evidence">Exact evidence quote</label>
      <textarea id="state-evidence" value={evidenceQuote} onChange={(event) => setEvidenceQuote(event.target.value)} maxLength={20000} disabled={characters.length === 0} className="mt-2 min-h-16 w-full min-w-0 resize-y rounded-md border border-line bg-surface px-3 py-2 text-xs leading-5 text-ink" placeholder={sceneContent ? "Paste the exact phrase from this Scene revision" : "No Scene text available"} />
      <button type="submit" disabled={!onPropose || blockedByUnsavedRevision || characters.length === 0 || !selectedCharacterId || !effectiveValue || !evidenceQuote.trim() || (predicate === "state.held_prop" && props.length === 0)} className="mt-4 inline-flex min-h-10 items-center rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45">Propose State Patch</button>
      <p className={`mt-2 text-[11px] leading-5 ${blockedByUnsavedRevision ? "font-semibold text-danger" : "text-ink-faint"}`}>{blockedByUnsavedRevision ? "Save this revision first so the selected continuity group is frozen before State review." : "The current Scene revision and confirmed character version are sent with this reviewable State Patch."}</p>
    </form>
  );
}

function ResolvedStateInspector({ entities, state, loading, error }: { entities: readonly Entity[]; state: ResolvedState | null; loading: boolean; error: string | null }) {
  const entityName = (entityId: string) => entities.find((entity) => entity.id === entityId)?.canonicalName ?? entityId;
  return (
    <section className="mt-6 min-w-0 rounded-lg border border-line bg-surface-raised p-4" aria-labelledby="resolved-state-heading" data-testid="resolved-state-inspector">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Phase 3</p>
          <h4 id="resolved-state-heading" className="mt-2 break-words text-sm font-semibold text-ink">Resolved Scene State</h4>
          <p className="mt-1 text-xs leading-5 text-ink-muted">Explicit → carried → Base fallback → missing. Conflicts remain blocking and are never auto-selected.</p>
        </div>
        {state?.continuityGroupId ? <span className="max-w-full break-all font-mono text-[10px] text-ink-faint">group {state.continuityGroupId}</span> : null}
      </div>
      {loading ? <p className="mt-4 text-xs text-accent" aria-live="polite">Resolving current Scene State…</p> : null}
      {error ? <p role="alert" className="mt-4 break-words border-l-2 border-danger pl-3 text-xs leading-5 text-danger">{error}</p> : null}
      {state?.hasBlockingConflicts ? <p role="alert" className="mt-4 break-words border-l-2 border-danger pl-3 text-xs leading-5 text-danger">Blocking continuity conflict: review the conflicting state sources before downstream generation.</p> : null}
      {state && state.entities.length > 0 ? (
        <div aria-label="Resolved state entities" className="mt-4 space-y-4">
          {state.entities.map((entity) => (
            <section key={entity.entityId} className="min-w-0 rounded-md border border-line bg-surface p-3" aria-labelledby={`resolved-state-entity-${entity.entityId}`}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <h5 id={`resolved-state-entity-${entity.entityId}`} className="break-words text-xs font-semibold text-ink">{entityName(entity.entityId)}</h5>
                <span className="max-w-full break-all font-mono text-[10px] text-ink-faint">{entity.entityId}</span>
              </div>
              {entity.hasBlockingConflicts ? <p role="alert" className="mt-2 break-words text-[11px] leading-5 text-danger">This entity has a blocking state conflict; no value was auto-selected.</p> : null}
              {entity.fields.length > 0 ? (
                <ul aria-label={`Resolved state fields for ${entityName(entity.entityId)}`} className="mt-3 space-y-3">
                  {entity.fields.map((field) => {
                    const conflict = field.tier === "conflict" || field.blockingConflict;
                    const displayedValue = field.tier === "missing"
                      ? "No explicit, carried, or mapped Base value."
                      : field.tier === "conflict"
                        ? `Conflicting values: ${stringifyPatchValue(field.conflictValues)}`
                        : stringifyPatchValue(field.value);
                    return (
                      <li key={field.predicate} className={`min-w-0 rounded-md border p-3 ${conflict ? "border-danger/50 bg-danger/5" : "border-line bg-surface-raised"}`}>
                        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                          <p className="break-words text-xs font-semibold text-ink">{statePredicateLabel(field.predicate)}</p>
                          <span className={`rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${conflict ? "border-danger/40 text-danger" : field.tier === "missing" ? "border-line text-ink-faint" : field.tier === "base" ? "border-line text-ink-muted" : "border-accent/40 text-accent"}`}>{stateTierLabel(field.tier)}</span>
                        </div>
                        <p className="mt-2 break-words whitespace-pre-wrap text-xs leading-5 text-ink">{displayedValue}</p>
                        <p className="mt-1 break-words text-[11px] leading-5 text-ink-faint">{field.valueType} · {field.cardinality} · priority {field.priority ?? "—"}</p>
                        {field.sources.length > 0 ? (
                          <ul aria-label={`Sources for ${field.predicate}`} className="mt-3 space-y-2">
                            {field.sources.map((source, index) => (
                              <li key={`${source.kind}-${source.recordId}-${index}`} className="min-w-0 break-words border-l-2 border-line pl-2 text-[11px] leading-5 text-ink-muted">
                                <p className="font-semibold text-ink-muted">{source.kind} record <span className="break-all font-mono">{source.recordId}</span></p>
                                <p className="mt-1 break-words">Tier {stateTierLabel(source.tier)} · priority {source.priority} · applies at <span className="break-all font-mono">{source.appliesAtSceneId ?? "—"}</span> · revision <span className="break-all font-mono">{source.sourceRevisionId ?? "—"}</span></p>
                                <p className="mt-1 break-words">Evidence source: <span className="break-all font-mono">{source.evidenceSourceId}</span></p>
                                <p className="mt-1 break-words">Value: {stringifyPatchValue(source.value)}</p>
                                {source.quotedText ? <p className="mt-1 break-words whitespace-pre-wrap">Quote: “{source.quotedText}”</p> : <p className="mt-1 text-ink-faint">No quoted evidence attached.</p>}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {conflict ? <p role="alert" className="mt-2 break-words text-[11px] leading-5 text-danger">All same-tier values are shown; choose explicitly before using this state.</p> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="mt-3 border-l-2 border-line pl-2 text-[11px] leading-5 text-ink-faint">No resolved fields returned for this entity.</p>}
            </section>
          ))}
        </div>
      ) : !loading && !error ? <p className="mt-4 border-l-2 border-line pl-3 text-xs leading-5 text-ink-faint">No confirmed linked entities or resolved fields returned.</p> : null}
    </section>
  );
}

type ContextIssueItem = ContextContent["missing"][number]
  | ContextContent["conflicts"][number]
  | ContextContent["warnings"][number]
  | ContextContent["omitted"][number];

function contextValue(value: unknown) {
  return stringifyPatchValue(value);
}

function contextIssueSummary(item: ContextIssueItem) {
  if ("message" in item) {
    return `${item.code}: ${item.message}`;
  }
  return `${item.kind} ${item.recordId ?? "—"}: ${item.reason}`;
}

function ContextIssueSection({ title, items, tone, testId }: { title: string; items: readonly ContextIssueItem[]; tone: "danger" | "accent" | "muted"; testId: string }) {
  const toneClass = tone === "danger" ? "border-danger/40 bg-danger/5 text-danger" : tone === "accent" ? "border-accent/40 bg-accent/5 text-accent" : "border-line bg-surface-muted text-ink-muted";
  return (
    <section className={`min-w-0 rounded-md border p-3 ${toneClass}`} aria-labelledby={`${testId}-heading`} data-testid={testId}>
      <h5 id={`${testId}-heading`} className="text-xs font-semibold uppercase tracking-[0.08em]">{title}</h5>
      {items.length > 0 ? <ul className="mt-2 min-w-0 space-y-2">{items.map((item, index) => <li key={`${testId}-${index}`} className="min-w-0 break-words whitespace-pre-wrap text-xs leading-5">{contextIssueSummary(item)}</li>)}</ul> : <p className="mt-2 text-xs leading-5 opacity-75">None recorded.</p>}
    </section>
  );
}

function ContextEntityCard({ item, index }: { item: ContextEntity; index: number }) {
  return (
    <li className="min-w-0 rounded-md border border-line bg-surface p-3" data-testid={`context-entity-${index}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="break-words text-sm font-semibold text-ink">{item.canonicalName}</p><p className="mt-1 break-words text-xs text-ink-muted">{item.type} · Roles: {item.roles.join(", ") || "None"}</p></div>
        <span className="max-w-full break-all font-mono text-[10px] text-ink-faint">{item.entityId}</span>
      </div>
      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded bg-surface-muted p-2"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Base facts</p>{item.baseFacts.length > 0 ? <ul className="mt-2 space-y-2">{item.baseFacts.map((fact) => <li key={fact.factId} className="min-w-0 break-words text-xs leading-5 text-ink-muted"><span className="font-semibold text-ink">{fact.predicate}</span>: {contextValue(fact.value)}<br /><span className="break-all font-mono text-[10px] text-ink-faint">fact {fact.factId} · v{fact.version} · source {fact.sourceId}</span></li>)}</ul> : <p className="mt-2 text-xs text-ink-faint">None included.</p>}</div>
        <div className="min-w-0 rounded bg-surface-muted p-2"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Resolved State</p>{item.resolvedState ? item.resolvedState.fields.length > 0 ? <ul className="mt-2 space-y-2">{item.resolvedState.fields.map((field) => <li key={field.predicate} className="min-w-0 break-words text-xs leading-5 text-ink-muted"><span className="font-semibold text-ink">{statePredicateLabel(field.predicate)}</span> · {stateTierLabel(field.tier)}: {contextValue(field.value)}{field.sources.length > 0 ? <ul className="mt-1 space-y-1 border-l-2 border-line pl-2">{field.sources.map((source) => <li key={`${source.kind}-${source.recordId}`} className="break-all font-mono text-[10px] text-ink-faint">{source.kind} {source.recordId} · evidence {source.evidenceSourceId} · source revision {source.sourceRevisionId ?? "—"}</li>)}</ul> : null}</li>)}</ul> : <p className="mt-2 text-xs text-ink-faint">No resolved fields.</p> : <p className="mt-2 text-xs text-ink-faint">None included.</p>}</div>
      </div>
    </li>
  );
}

function ContextInspector({
  state,
  purpose,
  policyId,
  disabled,
  hasSavedRevision,
  hasScene,
  onPurposeChange,
  onBuild,
}: {
  state: ContextState | null;
  purpose: ContextPurpose;
  policyId: ContextPolicyId;
  disabled: boolean;
  hasSavedRevision: boolean;
  hasScene: boolean;
  onPurposeChange: (purpose: ContextPurpose) => void;
  onBuild: () => void;
}) {
  const content = state?.snapshot?.content;
  const scene = content?.scene;
  const entities = content?.entities ?? [];
  const provenance = content?.provenance ?? [];
  return (
    <section className="mt-6 min-w-0 rounded-lg border border-line bg-surface-raised p-4" aria-labelledby="context-inspector-heading" data-testid="context-inspector">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Phase 4</p><h4 id="context-inspector-heading" className="mt-2 break-words text-sm font-semibold text-ink">Context Inspector</h4><p className="mt-1 max-w-[58ch] text-xs leading-5 text-ink-muted">Inspect the immutable, provider-neutral input assembled from this saved Scene revision. Building here never submits to a Provider.</p></div>
        <div className="flex shrink-0 flex-wrap items-center gap-2"><span className="rounded border border-line px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">allowInferred=false</span><span className="rounded border border-line px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">No Provider submission</span></div>
      </div>
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0"><label className="block text-xs font-semibold text-ink" htmlFor="context-purpose">Purpose</label><select id="context-purpose" aria-label="Context purpose" value={purpose} onChange={(event) => onPurposeChange(event.target.value as ContextPurpose)} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm text-ink"><option value="storyboard">Storyboard</option><option value="video">Video</option></select></div>
        <div className="min-w-0"><label className="block text-xs font-semibold text-ink" htmlFor="context-policy">Policy</label><select id="context-policy" aria-label="Context policy" value={policyId} disabled className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-muted px-3 text-sm text-ink"><option value={policyId}>{policyId}</option></select></div>
      </div>
      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3"><button type="button" onClick={onBuild} disabled={disabled || !hasSavedRevision || !hasScene} className="inline-flex min-h-10 items-center rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45" data-testid="context-build">{state?.building ? "Building Snapshot…" : "Build Context Snapshot"}</button>{!hasSavedRevision ? <p className="break-words text-xs font-semibold text-danger">Save this revision first before building a Context Snapshot.</p> : !hasScene ? <p className="break-words text-xs text-ink-faint">Save a revision with a Scene before building context.</p> : null}</div>
      {state?.loading ? <p className="mt-4 text-xs text-accent" aria-live="polite">Loading the latest Context Snapshot…</p> : null}
      {state?.error ? <p role="alert" className="mt-4 break-words border-l-2 border-danger pl-3 text-xs leading-5 text-danger">Context error: {state.error}</p> : null}
      {state?.snapshot ? (
        <div className="mt-5 min-w-0 space-y-4">
          <dl className="grid min-w-0 grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div className="min-w-0 rounded bg-surface p-3"><dt className="text-ink-faint">Snapshot ID</dt><dd className="mt-1 break-all font-mono text-ink" data-testid="context-snapshot-id">{state.snapshot.id}</dd></div>
            <div className="min-w-0 rounded bg-surface p-3"><dt className="text-ink-faint">Content hash</dt><dd className="mt-1 break-all font-mono text-ink" data-testid="context-content-hash">{state.snapshot.contentHash}</dd></div>
            <div className="min-w-0 rounded bg-surface p-3"><dt className="text-ink-faint">Input hash</dt><dd className="mt-1 break-all font-mono text-ink" data-testid="context-input-hash">{state.snapshot.inputHash}</dd></div>
            <div className="min-w-0 rounded bg-surface p-3"><dt className="text-ink-faint">Policy / latest</dt><dd className="mt-1 break-words text-ink">{state.snapshot.policyId} · v{state.snapshot.policyVersion} · {state.snapshot.isLatest ? "Latest" : "Historical"}</dd></div>
            <div className="min-w-0 rounded bg-surface p-3 sm:col-span-2"><dt className="text-ink-faint">Created</dt><dd className="mt-1 break-words text-ink">{state.snapshot.createdAt}</dd></div>
          </dl>
          <section className="min-w-0 rounded-md border border-line bg-surface p-3" aria-labelledby="context-scene-heading"><h5 id="context-scene-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Scene</h5><p className="mt-2 break-words whitespace-pre-wrap text-xs leading-5 text-ink">{scene?.text ?? "No Scene text included."}</p><p className="mt-2 break-all font-mono text-[10px] text-ink-faint">{scene?.id ?? state.snapshot.sceneId} · revision {scene?.revisionId ?? state.snapshot.sceneRevisionId}</p></section>
          <section className="min-w-0" aria-labelledby="context-entities-heading"><h5 id="context-entities-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Included Entities ({entities.length})</h5>{entities.length > 0 ? <ul className="mt-3 min-w-0 space-y-3">{entities.map((item, index) => <ContextEntityCard key={`context-entity-${index}`} item={item} index={index} />)}</ul> : <p className="mt-3 border-l-2 border-line pl-3 text-xs text-ink-faint">No confirmed entities were included.</p>}</section>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><ContextIssueSection title="Blocking conflicts" items={content?.conflicts ?? []} tone="danger" testId="context-conflicts" /><ContextIssueSection title="Missing" items={content?.missing ?? []} tone="danger" testId="context-missing" /><ContextIssueSection title="Warnings" items={content?.warnings ?? []} tone="accent" testId="context-warnings" /><ContextIssueSection title="Omitted" items={content?.omitted ?? []} tone="muted" testId="context-omitted" /></div>
          <section className="min-w-0 rounded-md border border-line bg-surface p-3" aria-labelledby="context-provenance-heading" data-testid="context-provenance"><h5 id="context-provenance-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Provenance</h5>{provenance.length > 0 ? <ul className="mt-3 min-w-0 space-y-2">{provenance.map((item) => <li key={`${item.kind}-${item.recordId}`} className="min-w-0 break-words text-xs leading-5 text-ink-muted"><span className="font-semibold text-ink">{item.kind}</span> · <span className="break-all font-mono">{item.recordId}</span> · version {item.version ?? "—"}{item.sourceId ? <> · source <span className="break-all font-mono">{item.sourceId}</span></> : null}</li>)}</ul> : <p className="mt-2 text-xs text-ink-faint">No provenance records included.</p>}</section>
        </div>
      ) : !state?.loading && !state?.error ? <p className="mt-5 border-l-2 border-line pl-3 text-xs leading-5 text-ink-faint">No Context Snapshot loaded for this purpose and saved revision. Build one to inspect its frozen input.</p> : null}
    </section>
  );
}

function CanonPatchCard({
  patch,
  evidenceSources,
  application,
  targetFact,
  resultingFact,
  resultingState,
  sceneContent,
  actions,
}: {
  patch: WorkspacePatch;
  evidenceSources: readonly EvidenceSource[];
  application: WorkspacePatchApplication | null;
  targetFact: Fact | null;
  resultingFact: Fact | null;
  resultingState: EntityState | null;
  sceneContent: string;
  actions?: PatchReviewActionHandlers;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editedValue, setEditedValue] = React.useState(stringifyPatchValue(patchPayloadValue(patch)));
  const [rejectReason, setRejectReason] = React.useState("");
  const payload = patch.payload;
  const predicate = typeof payload.predicate === "string" ? payload.predicate : "Unspecified predicate";
  const scope = typeof (payload as Record<string, unknown>).scope === "string" ? (payload as Record<string, unknown>).scope as string : null;
  const isStatePatch = patch.operation === "add_state";
  const displayValues = isStatePatch && resultingState
    ? { before: undefined, after: resultingState.value }
    : patchReviewValues(patch, application, targetFact, resultingFact);
  const before = stringifyPatchValue(displayValues.before);
  const after = stringifyPatchValue(displayValues.after);
  const evidence = evidenceSources.filter((source) => patch.evidenceSourceIds.includes(source.id));
  const accepted = patch.status === "accepted";
  const hardConflict = patch.conflictKind === "hard";

  return (
    <li className="min-w-0 rounded-lg border border-line bg-surface p-4" data-testid={`canon-patch-${patch.id}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-words text-sm font-semibold text-ink">{predicate}</p>
            {scope ? <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-ink-faint">{scope}</span> : null}
          </div>
          <p className="mt-1 text-xs text-ink-faint">{isStatePatch ? "Scene State" : patch.operation.replaceAll("_", " ")} · {patchStatusLabel(patch.status)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
          <span className={isStatePatch ? "rounded-md border border-accent/40 px-2 py-1 text-accent" : "rounded-md border border-success/40 px-2 py-1 text-success"}>{isStatePatch ? "Scene State" : "Canon"}</span>
          <span className={hardConflict ? "rounded-md border border-danger/40 px-2 py-1 text-danger" : patch.conflictKind === "possible" ? "rounded-md border border-accent/40 px-2 py-1 text-accent" : "rounded-md border border-line px-2 py-1 text-ink-faint"}>{patchConflictLabel(patch.conflictKind)}</span>
        </div>
      </div>

      <dl className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-md bg-surface-muted p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Before</dt>
          <dd className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink-muted">{before}</dd>
        </div>
        <div className="min-w-0 rounded-md bg-surface-muted p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">After</dt>
          <dd className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-ink">{after}</dd>
        </div>
      </dl>

      <dl className="mt-4 grid min-w-0 grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <div className="min-w-0"><dt className="inline text-ink-faint">Confidence: </dt><dd className="inline text-ink-muted">{patch.confidence === null ? "—" : `${Math.round(patch.confidence * 100)}%`}</dd></div>
        <div className="min-w-0"><dt className="inline text-ink-faint">Proposed by: </dt><dd className="inline break-words text-ink-muted">{patch.proposedBy}{patch.modelRunId ? ` · model ${patch.modelRunId}` : ""}</dd></div>
        <div className="min-w-0 sm:col-span-2"><dt className="inline text-ink-faint">Evidence: </dt><dd className="inline text-ink-muted">{evidence.length > 0 ? `${evidence.length} source${evidence.length === 1 ? "" : "s"}` : "source unavailable"} · Scene revision {patch.sourceRevisionId}</dd></div>
        {isStatePatch ? <div className="min-w-0 sm:col-span-2"><dt className="inline text-ink-faint">Boundary: </dt><dd className="inline text-ink-muted">Temporary Scene State only; Character Base and Inference remain unchanged until review.</dd></div> : null}
        {isStatePatch && resultingState ? <div className="min-w-0 sm:col-span-2"><dt className="inline text-ink-faint">Applied EntityState: </dt><dd className="inline break-words text-ink-muted">{resultingState.id} · {resultingState.continuityGroupId} · source revision {resultingState.sourceRevisionId}</dd></div> : null}
      </dl>

      {evidence.length > 0 ? (
        <ul aria-label={`Evidence for ${predicate}`} className="mt-4 space-y-2">
          {evidence.map((source) => <li key={source.id} className="break-words whitespace-pre-wrap border-l-2 border-line pl-3 text-xs leading-5 text-ink-muted">{source.quotedText || evidenceSnippet(source, sceneContent)}</li>)}
        </ul>
      ) : null}

      {hardConflict ? (
        <p role="alert" className="mt-4 border-l-2 border-danger pl-3 text-xs leading-5 text-danger">普通接受已阻止：{patch.conflictMessage || "此 Patch 与现有 Canon 冲突，需要先解决冲突。"}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!canAcceptPatch(patch) || !actions?.onAccept} aria-disabled={!canAcceptPatch(patch) || !actions?.onAccept} title={hardConflict ? "Resolve the hard conflict before accepting" : undefined} onClick={() => actions?.onAccept?.(patch, { expectedVersion: patch.version, requestId: requestId("patch-accept") })} className="inline-flex min-h-10 items-center rounded-md border border-success px-3 text-xs font-semibold text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-45" data-testid={`accept-patch-${patch.id}`}>Accept</button>
        <button type="button" disabled={!canAcceptPatch(patch) || !actions?.onAcceptEdited} aria-disabled={!canAcceptPatch(patch) || !actions?.onAcceptEdited} onClick={() => setEditing((current) => !current)} className="inline-flex min-h-10 items-center rounded-md border border-line px-3 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45" data-testid={`edit-patch-${patch.id}`}>{editing ? "Close edit" : "Edit then accept"}</button>
        <button type="button" disabled={patch.status !== "pending" || !actions?.onReject} aria-disabled={patch.status !== "pending" || !actions?.onReject} onClick={() => actions?.onReject?.(patch, rejectReason.trim() || null, { expectedVersion: patch.version, requestId: requestId("patch-reject") })} className="inline-flex min-h-10 items-center rounded-md border border-line px-3 text-xs font-semibold text-ink-muted hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-45" data-testid={`reject-patch-${patch.id}`}>Reject</button>
        {!accepted ? <span className="text-[11px] text-ink-faint">Review actions require the patch API.</span> : <span className="text-[11px] font-semibold text-success">{isStatePatch ? "Scene State is visible after acceptance." : "Canon is visible after acceptance."}</span>}
      </div>
      {editing ? (
        <div className="mt-4 rounded-md border border-accent/30 bg-surface-raised p-3">
          <label className="block text-xs font-semibold text-ink" htmlFor={`edit-patch-value-${patch.id}`}>Edited after value</label>
          <textarea id={`edit-patch-value-${patch.id}`} value={editedValue} onChange={(event) => setEditedValue(event.target.value)} className="mt-2 min-h-20 w-full min-w-0 resize-y rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs leading-5 text-ink" />
          <label className="mt-3 block text-xs font-semibold text-ink" htmlFor={`reject-patch-reason-${patch.id}`}>Reject reason <span className="font-normal text-ink-faint">(optional)</span></label>
          <input id={`reject-patch-reason-${patch.id}`} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-xs text-ink" />
          <button type="button" disabled={!actions?.onAcceptEdited || !canAcceptPatch(patch)} onClick={() => actions?.onAcceptEdited?.(patch, { ...patch.payload, value: parseEditedValue(editedValue, patchPayloadValue(patch)) }, { expectedVersion: patch.version, requestId: requestId("patch-accept-edit") })} className="mt-3 inline-flex min-h-10 items-center rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45">Accept edited value</button>
        </div>
      ) : null}
    </li>
  );
}

function parseEditedValue(raw: string, original: unknown) {
  const valueType = Array.isArray(original) || (typeof original === "object" && original !== null)
    ? "json"
    : typeof original === "number"
      ? "number"
      : typeof original === "boolean"
        ? "boolean"
        : "string";
  return candidateValueFromInput(raw, valueType);
}

function evidenceSnippet(source: EvidenceSource, content: string) {
  const start = Number.parseInt(source.anchorStart ?? "", 10);
  const end = Number.parseInt(source.anchorEnd ?? "", 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !content) return "Evidence anchor unavailable.";
  const safeStart = Math.max(0, start - 36);
  const safeEnd = Math.min(content.length, end + 64);
  return `${safeStart > 0 ? "…" : ""}${content.slice(safeStart, safeEnd)}${safeEnd < content.length ? "…" : ""}`;
}

function EntityCards({ entities }: { entities: Entity[] }) {
  if (entities.length === 0) return <p className="mt-4 border-l-2 border-line pl-3 text-sm leading-6 text-ink-faint">No entities yet. Create a card or run analysis to discover one.</p>;
  return (
    <ul aria-label="Project entities" className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
      {entities.map((entity) => <li key={entity.id} className="min-w-0 rounded-lg border border-line bg-surface p-3"><p className="break-words text-sm font-semibold text-ink">{entity.canonicalName}</p><p className="mt-1 text-xs uppercase tracking-[0.08em] text-ink-faint">{entity.type} · {entity.status}</p></li>)}
    </ul>
  );
}

function ScriptsEmptySection({ onCreate }: { onCreate: () => void }) {
  return (
    <section aria-labelledby="scripts-empty-heading" className="max-w-[780px]">
      <div aria-live="polite" className="mb-5 min-h-6 text-sm text-ink-muted">Scripts are ready.</div>
      <header className="border-b border-line pb-6">
        <p className="text-sm text-ink-faint">Scripts</p>
        <h2 id="scripts-empty-heading" className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">Start a script document.</h2>
        <p className="mt-3 max-w-[60ch] text-sm leading-6 text-ink-muted">Create a document with stable scenes, then save revisions before asking the entity resolver to inspect them.</p>
      </header>
      <div className="mt-8 border-l-2 border-line pl-4">
        <p className="text-sm font-semibold text-ink">No script documents yet</p>
        <p className="mt-2 max-w-[54ch] text-sm leading-6 text-ink-muted">A saved revision keeps Scene IDs stable while the text changes.</p>
        <button type="button" onClick={onCreate} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong"><Plus size={17} aria-hidden="true" /> New script</button>
      </div>
    </section>
  );
}
