"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Check, Play, Plus, Trash, X } from "@phosphor-icons/react";
import type { DocumentRevision, SceneRevision, ScriptDocument } from "@/domain/document";
import type { AnalysisRun, AnalysisRunStatus, EntityMention } from "@/domain/analysis";
import type { AcceptEditedPatchInput, AcceptPatchInput, Patch, PatchApplication, RejectPatchInput } from "@/domain/canon-patch";
import type { SceneEntityLink } from "@/domain/scene-link";
import { predicateSchemaRegistry } from "@/domain/story-bible";
import type { CreateEntityInput, Entity, EvidenceSource, Fact, FactScope, FactValueType } from "@/domain/story-bible";
import {
  WorkspaceApiError,
  acceptEditedPatch,
  acceptPatch,
  createDocumentRevision,
  createEntity,
  createEntityAlias,
  enqueueAnalysis,
  executeAnalysis,
  getScenePatchReview,
  getSceneEntityReview,
  getScriptDocument,
  getDocumentRevision,
  listEntities,
  proposeFactPatch,
  rejectPatch,
  reviewSceneEntityLink,
} from "./workspace-api";
import type { PatchProposalResult, SceneEntityReview, ScenePatchReview as ApiScenePatchReview } from "./workspace-api";
import {
  analysisSelectionKey,
  candidateValueFromInput,
  canAcceptPatch,
  isCurrentAnalysisResponse,
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
  latestConflict: Patch | null;
};

type FactCandidateDraft = {
  entityId: string;
  predicate: string;
  value: unknown;
  valueType: FactValueType;
  scope: FactScope;
  evidenceQuote: string;
};

/** Keep the API read model available to UI/e2e callers without duplicating it. */
export type ScenePatchReview = ApiScenePatchReview;

export type PatchActionRequest = {
  expectedVersion: number;
  requestId: string;
};

export type PatchReviewActionHandlers = {
  onAccept?: (patch: Patch, request: PatchActionRequest) => void;
  onAcceptEdited?: (patch: Patch, payload: Record<string, unknown>, request: PatchActionRequest) => void;
  onReject?: (patch: Patch, reason: string | null, request: PatchActionRequest) => void;
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
  const [analysisByKey, setAnalysisByKey] = React.useState<Record<string, AnalysisState>>({});
  // Keep patch review keyed by Scene + immutable SceneRevision so a late
  // response cannot bleed into another selection.
  const [patchReviewByKey, setPatchReviewByKey] = React.useState<Record<string, PatchReviewState>>({});
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
  const analysisByKeyRef = React.useRef<Record<string, AnalysisState>>({});
  const patchReviewByKeyRef = React.useRef<Record<string, PatchReviewState>>({});
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
    analysisSelectionRef.current = null;
    patchSelectionRef.current = null;
    setAnalysisByKey({});
    setPatchReviewByKey({});

    if (!documentId) {
      setDocumentLoading(false);
      setFreshDocument(null);
      return () => { cancelled = true; };
    }

    const load = async () => {
      try {
        const canonical = await getScriptDocument(projectId, documentId);
        if (cancelled || documentRequestRef.current !== requestNumber) return;
        setFreshDocument(canonical);
        onDocumentChanged(canonical);
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

  const updateScene = React.useCallback((sceneId: string, update: Partial<Pick<EditableScene, "title" | "content">>) => {
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
      { id, title: "", content: "", narrativeRank: current.length, status: "active", persisted: false },
    ]);
    setSelectedSceneId(id);
    setRevisionDirty(true);
    onDirtyChange(true);
    setRevisionError(null);
    setStatusMessage("New scene added. Save the revision when ready.");
  }, [onDirtyChange]);

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
        .map((scene, index) => ({
          // New scenes receive a server UUID on first save. Persisted scenes
          // retain their IDs so links and analysis remain attached.
          ...(scene.persisted ? { id: scene.id } : {}),
          title: scene.title,
          content: scene.content,
          narrativeRank: index,
          status: scene.status,
        }));
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
  }, [freshDocument, onDirtyChange, onDocumentChanged, projectId, revisionDirty, revisionSaving, scenes, selectedSceneId]);

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

  const mergePatchMutationResult = React.useCallback((selection: PatchReviewState["selection"], updatedPatch: Patch, fact: Fact | null, application: PatchApplication | null) => {
    const key = patchSelectionKey(selection);
    setPatchReviewByKey((current) => {
      const state = current[key];
      if (!state?.review) return current;
      const review = {
        ...state.review,
        patches: replaceCanonicalPatch(state.review.patches, updatedPatch),
        facts: fact ? replaceCanonicalRecord(state.review.facts, fact) : state.review.facts,
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
    patch: Patch,
    kind: "accept" | "accept-edited" | "reject",
    request: PatchActionRequest,
    payload?: Record<string, unknown>,
    reason?: string | null,
  ) => {
    if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
    setPatchState(selection, { loading: true, action: kind === "reject" ? "rejecting" : "accepting", error: null, latestConflict: null });
    try {
      let acceptedFact = false;
      if (kind === "accept") {
        const input: AcceptPatchInput = { expectedVersion: request.expectedVersion, requestId: request.requestId, actorId: "local-user" };
        const result = await acceptPatch(projectId, patch.id, input);
        acceptedFact = Boolean(result.fact);
        mergePatchMutationResult(selection, result.patch, result.fact, result.application);
      } else if (kind === "accept-edited") {
        const input: AcceptEditedPatchInput = { expectedVersion: request.expectedVersion, requestId: request.requestId, actorId: "local-user", payload: payload ?? patch.payload };
        const result = await acceptEditedPatch(projectId, patch.id, input);
        acceptedFact = Boolean(result.fact);
        mergePatchMutationResult(selection, result.patch, result.fact, result.application);
      } else {
        const input: RejectPatchInput = { expectedVersion: request.expectedVersion, requestId: request.requestId, actorId: "local-user", reason: reason ?? null };
        const result = await rejectPatch(projectId, patch.id, input);
        mergePatchMutationResult(selection, result.patch, null, null);
      }
      if (!isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
      await loadPatchReview(selection, "refreshing");
      if (isCurrentPatchResponse(patchSelectionRef.current, selection)) {
        setStatusMessage(kind === "reject" ? "Patch rejected; Canon was not changed." : acceptedFact ? "Patch accepted; Canon fact is now visible." : "Patch accepted; Canon review refreshed.");
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
  }, [loadPatchReview, mergePatchMutationResult, projectId, setPatchState]);

  const proposeCandidate = React.useCallback(async (selection: PatchReviewState["selection"], draft: FactCandidateDraft) => {
    if (!freshDocument || !revision || !isCurrentPatchResponse(patchSelectionRef.current, selection)) return;
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
  }, [freshDocument, loadPatchReview, mergePatchProposalResult, projectId, revision, setPatchState]);

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
                  loading={selectedPatchState?.loading ?? false}
                  error={selectedPatchState?.error ?? null}
                  latestConflict={selectedPatchState?.latestConflict ?? null}
                  actions={selectedPatchState ? {
                    onAccept: (patch, request) => void runPatchMutation(selectedPatchState.selection, patch, "accept", request),
                    onAcceptEdited: (patch, payload, request) => void runPatchMutation(selectedPatchState.selection, patch, "accept-edited", request, payload),
                    onReject: (patch, reason, request) => void runPatchMutation(selectedPatchState.selection, patch, "reject", request, undefined, reason),
                  } : undefined}
                  onPropose={selectedPatchState ? (draft) => void proposeCandidate(selectedPatchState.selection, draft) : undefined}
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
  loading,
  error,
  latestConflict,
  actions,
  onPropose,
}: {
  review: ScenePatchReview | null;
  sceneContent: string;
  entities: readonly Entity[];
  loading: boolean;
  error: string | null;
  latestConflict: Patch | null;
  actions?: PatchReviewActionHandlers;
  onPropose?: (draft: FactCandidateDraft) => void;
}) {
  return (
    <section className="mt-8 min-w-0 border-t border-line pt-6" aria-labelledby="canon-patch-review-heading" data-testid="canon-patch-review">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Phase 2</p>
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
    </section>
  );
}

function PatchConflictPreview({ patch }: { patch: Patch }) {
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
  const compatiblePredicates = Object.entries(predicateSchemaRegistry).filter(([, candidate]) => {
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

function CanonPatchCard({
  patch,
  evidenceSources,
  application,
  targetFact,
  resultingFact,
  sceneContent,
  actions,
}: {
  patch: Patch;
  evidenceSources: readonly EvidenceSource[];
  application: PatchApplication | null;
  targetFact: Fact | null;
  resultingFact: Fact | null;
  sceneContent: string;
  actions?: PatchReviewActionHandlers;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editedValue, setEditedValue] = React.useState(stringifyPatchValue(patchPayloadValue(patch)));
  const [rejectReason, setRejectReason] = React.useState("");
  const payload = patch.payload;
  const predicate = typeof payload.predicate === "string" ? payload.predicate : "Unspecified predicate";
  const scope = typeof payload.scope === "string" ? payload.scope : null;
  const displayValues = patchReviewValues(patch, application, targetFact, resultingFact);
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
          <p className="mt-1 text-xs text-ink-faint">{patch.operation.replaceAll("_", " ")} · {patchStatusLabel(patch.status)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
          <span className="rounded-md border border-success/40 px-2 py-1 text-success">Canon</span>
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
        {!accepted ? <span className="text-[11px] text-ink-faint">Review actions require the patch API.</span> : <span className="text-[11px] font-semibold text-success">Canon is visible after acceptance.</span>}
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
