"use client";

import * as React from "react";
import {
  FAKE_VIDEO_CAPABILITY_PROFILE,
  compileShotInputSchema,
  createReferenceAssetInputSchema,
  type CompileShotResult,
  type ReferenceAsset,
} from "@/domain/generation-compiler";
import type { ContextEntity, ContextSnapshot } from "@/domain/context-builder";
import type { ShotSpecContent, StoryboardStatus } from "@/domain/storyboard";
import {
  WorkspaceApiError,
  compileShot,
  createReferenceAsset,
  listReferenceAssets,
} from "./workspace-api";
import {
  compilationInputDefaults,
  compilationInputKey,
  compilationSelectionKey,
  isCurrentCompilationResponse,
  type CompilationSelection,
} from "./scripts-workspace-helpers";

type CompilationPreviewProps = {
  projectId: string;
  snapshot: ContextSnapshot;
  storyboardId: string | null;
  shotSpecId: string | null;
  shot: ShotSpecContent;
  shotIndex: number;
  boardStatus: StoryboardStatus;
  boardDirty: boolean;
};

function requestId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof WorkspaceApiError ? error.message : fallback;
}

function relevantEntities(snapshot: ContextSnapshot, shot: ShotSpecContent) {
  const ids = new Set([
    ...shot.subjects.map((subject) => subject.entityId),
    ...(shot.locationEntityId ? [shot.locationEntityId] : []),
    ...shot.propEntityIds,
  ]);
  return snapshot.content.entities.filter((entity) => ids.has(entity.entityId));
}

function entityName(entities: readonly ContextEntity[], entityId: string) {
  return entities.find((entity) => entity.entityId === entityId)?.canonicalName ?? entityId;
}

function AssetList({
  assets,
  entities,
  selectedIds,
  onToggle,
  disabled,
}: {
  assets: readonly ReferenceAsset[];
  entities: readonly ContextEntity[];
  selectedIds: readonly string[];
  onToggle: (assetId: string, checked: boolean) => void;
  disabled: boolean;
}) {
  if (entities.length === 0) {
    return <p className="mt-3 border-l-2 border-line pl-3 text-xs leading-5 text-ink-faint">This Shot has no included Character, Location, or Prop entity. Text-only compilation remains available.</p>;
  }
  return (
    <div className="mt-3 min-w-0 space-y-3" data-testid="reference-asset-list">
      {entities.map((entity) => {
        const entityAssets = assets.filter((asset) => asset.entityId === entity.entityId && asset.status === "approved");
        return (
          <section key={entity.entityId} className="min-w-0 rounded-md border border-line bg-surface-raised p-3" aria-labelledby={`reference-assets-${entity.entityId}`}>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <h6 id={`reference-assets-${entity.entityId}`} className="break-words text-xs font-semibold text-ink">{entity.canonicalName} <span className="font-normal text-ink-faint">· {entity.type}</span></h6>
              <span className="break-all font-mono text-[10px] text-ink-faint">{entity.entityId}</span>
            </div>
            {entityAssets.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {entityAssets.map((asset) => {
                  const checked = selectedIds.includes(asset.id);
                  const atLimit = selectedIds.length >= 20;
                  return (
                    <li key={asset.id} className="min-w-0">
                      <label className="flex min-w-0 items-start gap-2 rounded border border-line bg-surface px-2 py-2 text-xs text-ink">
                        <input type="checkbox" checked={checked} onChange={(event) => onToggle(asset.id, event.target.checked)} disabled={disabled || (!checked && atLimit)} className="mt-0.5 size-4 shrink-0 accent-accent" />
                        <span className="min-w-0 break-words"><span className="font-semibold">{asset.label}</span><span className="mt-1 block break-all font-mono text-[10px] text-ink-faint">approved · metadata {asset.metadataHash}</span></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-2 text-xs leading-5 text-ink-faint">No approved reference metadata for this entity yet.</p>}
          </section>
        );
      })}
    </div>
  );
}

function IssueList({ title, items, tone, testId }: { title: string; items: readonly string[]; tone: "warning" | "muted"; testId: string }) {
  return (
    <section className={`min-w-0 rounded-md border p-3 ${tone === "warning" ? "border-accent/40 bg-accent/5" : "border-line bg-surface-muted"}`} data-testid={testId}>
      <h6 className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${tone === "warning" ? "text-accent" : "text-ink-faint"}`}>{title}</h6>
      {items.length > 0 ? <ul className="mt-2 min-w-0 space-y-1">{items.map((item, index) => <li key={`${testId}-${index}`} className="break-words text-xs leading-5 text-ink-muted">{item}</li>)}</ul> : <p className="mt-2 text-xs leading-5 text-ink-faint">None recorded.</p>}
    </section>
  );
}

function CompileResult({ result, entities }: { result: CompileShotResult; entities: readonly ContextEntity[] }) {
  const { compiledRequest, preview } = result;
  return (
    <section className="mt-5 min-w-0 space-y-4 border-t border-line pt-4" data-testid="compile-result">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h6 className="text-xs font-semibold text-ink">Compiled request preview</h6><p className="mt-1 text-[11px] leading-5 text-ink-faint">This is a deterministic request preview. It does not submit or generate media.</p></div>
        <span className="max-w-full break-all rounded border border-success/40 px-2 py-1 font-mono text-[10px] text-success" data-testid="compiled-hash">compiledHash {compiledRequest.compiledHash}</span>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-3" data-testid="compiled-normalized-parameters">
        <div className="min-w-0 rounded bg-surface-raised p-2"><dt className="text-ink-faint">Provider</dt><dd className="mt-1 break-words text-ink">{compiledRequest.provider}</dd></div>
        <div className="min-w-0 rounded bg-surface-raised p-2"><dt className="text-ink-faint">Model / profile</dt><dd className="mt-1 break-words text-ink">{compiledRequest.model} · {compiledRequest.capabilityProfileId} v{compiledRequest.capabilityProfileVersion}</dd></div>
        <div className="min-w-0 rounded bg-surface-raised p-2"><dt className="text-ink-faint">Normalized parameters</dt><dd className="mt-1 break-words text-ink">{compiledRequest.parameters.durationSeconds}s · {compiledRequest.parameters.aspectRatio}</dd></div>
      </dl>

      <section className="min-w-0 rounded-md border border-line bg-surface-raised p-3" aria-labelledby="compiled-prompt-segments-heading">
        <h6 id="compiled-prompt-segments-heading" className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Prompt segments / source IDs</h6>
        <ol className="mt-3 min-w-0 space-y-2">{compiledRequest.promptSegments.map((segment, index) => <li key={`${segment.role}-${index}`} className="min-w-0 rounded border border-line bg-surface p-2" data-testid={`prompt-segment-${index}`}><p className="text-xs font-semibold text-ink">{segment.role}</p><p className="mt-1 break-words whitespace-pre-wrap text-xs leading-5 text-ink-muted">{segment.text}</p><p className="mt-1 break-words text-[10px] text-ink-faint">source IDs: {segment.sourceIds.join(", ")}</p></li>)}</ol>
      </section>

      <section className="min-w-0 rounded-md border border-line bg-surface-raised p-3" aria-labelledby="compiled-negative-heading">
        <h6 id="compiled-negative-heading" className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Negative prompt</h6>
        <p className="mt-2 break-words whitespace-pre-wrap text-xs leading-5 text-ink-muted">{compiledRequest.negativePrompt ?? "None"}</p>
      </section>

      <section className="min-w-0 rounded-md border border-line bg-surface-raised p-3" aria-labelledby="compiled-assets-heading">
        <h6 id="compiled-assets-heading" className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Selected asset inputs</h6>
        {compiledRequest.assetInputs.length > 0 ? <ul className="mt-2 min-w-0 space-y-2">{compiledRequest.assetInputs.map((asset) => <li key={asset.assetId} className="min-w-0 break-words text-xs leading-5 text-ink-muted">{entityName(entities, asset.entityId)} · {asset.purpose} · weight {asset.weight} · <span className="break-all font-mono text-[10px]">{asset.assetId}</span></li>)}</ul> : <p className="mt-2 text-xs text-ink-faint">Text-only request; no reference metadata selected.</p>}
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><IssueList title="Warnings" items={compiledRequest.warnings} tone="warning" testId="compile-warnings" /><IssueList title="Omitted context" items={compiledRequest.omittedContext} tone="muted" testId="compile-omitted-context" /></div>

      <section className="min-w-0 rounded-md border border-accent/40 bg-accent/5 p-3" data-testid="fake-preview-request">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h6 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">Fake Video preview request</h6><p className="mt-1 text-xs text-ink-muted">Endpoint: <span className="break-all font-mono">{preview.endpoint}</span></p></div><span className="max-w-full break-all font-mono text-[10px] text-accent" data-testid="preview-request-hash">requestHash {preview.requestHash}</span></div>
        <pre className="mt-3 min-w-0 max-w-full overflow-hidden whitespace-pre-wrap break-words rounded bg-surface p-3 text-[11px] leading-5 text-ink" data-testid="preview-body">{JSON.stringify(preview.body, null, 2)}</pre>
        <p className="mt-3 text-[11px] leading-5 text-ink-faint">Preview only: no provider submission and no media generation occurred.</p>
      </section>
    </section>
  );
}

export function CompilationPreview({ projectId, snapshot, storyboardId, shotSpecId, shot, shotIndex, boardStatus, boardDirty }: CompilationPreviewProps) {
  const entities = React.useMemo(() => relevantEntities(snapshot, shot), [shot, snapshot]);
  const entityIds = React.useMemo(() => entities.map((entity) => entity.entityId), [entities]);
  const entityIdsKey = entityIds.join(",");
  const selection = React.useMemo<CompilationSelection | null>(() => {
    if (boardStatus !== "approved" || !storyboardId || !shotSpecId) return null;
    return { projectId, sceneId: snapshot.sceneId, sceneRevisionId: snapshot.sceneRevisionId, contextSnapshotId: snapshot.id, storyboardId, shotSpecId };
  }, [boardStatus, projectId, shotSpecId, snapshot.id, snapshot.sceneId, snapshot.sceneRevisionId, storyboardId]);
  const selectionKey = selection ? compilationSelectionKey(selection) : null;
  const selectionRef = React.useRef<CompilationSelection | null>(null);
  const compileGuardRef = React.useRef<string | null>(null);
  const [assetsState, setAssetsState] = React.useState<{ key: string; items: ReferenceAsset[] } | null>(null);
  const [assetLoading, setAssetLoading] = React.useState(false);
  const [assetErrorState, setAssetErrorState] = React.useState<{ key: string; message: string } | null>(null);
  const [refreshToken, setRefreshToken] = React.useState(0);
  const [selectedAssetIds, setSelectedAssetIds] = React.useState<string[]>([]);
  const [assetEntityId, setAssetEntityId] = React.useState(entityIds[0] ?? "");
  const [assetLabel, setAssetLabel] = React.useState("");
  const [assetCreateState, setAssetCreateState] = React.useState<{ key: string; busy: boolean; error: string | null; notice: string | null } | null>(null);
  const pendingAssetIdRef = React.useRef<string | null>(null);
  const initialInputDefaults = compilationInputDefaults(shot.durationSeconds);
  const [durationInput, setDurationInput] = React.useState(initialInputDefaults.durationInput);
  const [aspectInput, setAspectInput] = React.useState(initialInputDefaults.aspectInput);
  const [compileResultState, setCompileResultState] = React.useState<{ key: string; result: CompileShotResult } | null>(null);
  const [compileErrorState, setCompileErrorState] = React.useState<{ key: string; message: string } | null>(null);
  const [compileValidationError, setCompileValidationError] = React.useState<string | null>(null);
  const [compiling, setCompiling] = React.useState(false);
  const assets = assetsState?.key === selectionKey ? assetsState.items : [];
  const assetError = assetErrorState?.key === selectionKey ? assetErrorState.message : null;
  const compileInputSignature = compilationInputKey(selection, selectedAssetIds, durationInput, aspectInput);
  const compileResult = compileResultState?.key === compileInputSignature ? compileResultState.result : null;
  const compileError = compileErrorState?.key === compileInputSignature ? compileErrorState.message : null;
  const assetCreating = Boolean(selectionKey && assetCreateState?.key === selectionKey && assetCreateState?.busy);
  const assetCreateError = selectionKey && assetCreateState?.key === selectionKey ? assetCreateState.error : null;
  const assetCreateNotice = selectionKey && assetCreateState?.key === selectionKey ? assetCreateState.notice : null;
  const previousSelectionKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const key = selectionKey;
    if (previousSelectionKeyRef.current === key) return;
    previousSelectionKeyRef.current = key;
    compileGuardRef.current = null;
    pendingAssetIdRef.current = null;
    const defaults = compilationInputDefaults(shot.durationSeconds);
    const nextAssetEntityId = entityIds[0] ?? "";
    let active = true;
    queueMicrotask(() => {
      if (!active || previousSelectionKeyRef.current !== key) return;
      setDurationInput(defaults.durationInput);
      setAspectInput(defaults.aspectInput);
      setSelectedAssetIds([]);
      setAssetEntityId(nextAssetEntityId);
      setAssetLabel("");
      setAssetCreateState(null);
      setAssetsState(null);
      setAssetErrorState(null);
      setAssetLoading(false);
      setCompileValidationError(null);
      setCompileResultState(null);
      setCompileErrorState(null);
      setCompiling(false);
    });
    return () => {
      active = false;
    };
  }, [entityIds, entityIdsKey, selectionKey, shot.durationSeconds]);

  React.useEffect(() => {
    const key = selectionKey;
    const currentSelection = selection;
    selectionRef.current = currentSelection;
    compileGuardRef.current = null;
    if (!currentSelection || !key || entityIds.length === 0) {
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setAssetLoading(true);
      setAssetErrorState(null);
    });
    void Promise.all(entityIds.map((entityId) => listReferenceAssets(projectId, entityId)))
      .then((lists) => {
        if (!active || !isCurrentCompilationResponse(selectionRef.current, currentSelection)) return;
        const merged = Array.from(new Map(lists.flat().map((asset) => [asset.id, asset])).values());
        setAssetsState({ key, items: merged });
        setSelectedAssetIds((current) => {
          const next = current.filter((assetId) => merged.some((asset) => asset.id === assetId));
          const pending = pendingAssetIdRef.current;
          if (pending && merged.some((asset) => asset.id === pending) && next.length < 20) {
            pendingAssetIdRef.current = null;
            return next.includes(pending) ? next : [...next, pending];
          }
          return next;
        });
      })
      .catch((error) => {
        if (!active || !isCurrentCompilationResponse(selectionRef.current, currentSelection)) return;
        setAssetErrorState({ key, message: errorMessage(error, "Approved reference metadata could not be loaded. Retry without changing the Scene.") });
      })
      .finally(() => {
        if (active && selectionRef.current && compilationSelectionKey(selectionRef.current) === key) setAssetLoading(false);
      });
    return () => {
      active = false;
      if (selectionRef.current && compilationSelectionKey(selectionRef.current) === key) {
        selectionRef.current = null;
        setAssetLoading(false);
        setCompiling(false);
      }
    };
  }, [entityIds, entityIdsKey, projectId, refreshToken, selection, selectionKey]);

  const effectiveAssetEntityId = entityIds.includes(assetEntityId) ? assetEntityId : entityIds[0] ?? "";

  const invalidateCompile = React.useCallback(() => {
    compileGuardRef.current = null;
    setCompiling(false);
    setCompileResultState(null);
    setCompileErrorState(null);
  }, []);

  const toggleAsset = React.useCallback((assetId: string, checked: boolean) => {
    setSelectedAssetIds((current) => {
      if (checked) {
        if (current.includes(assetId) || current.length >= 20) return current;
        return [...current, assetId];
      }
      return current.filter((id) => id !== assetId);
    });
    invalidateCompile();
  }, [invalidateCompile]);

  const createMetadata = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentSelection = selection;
    const key = selectionKey;
    if (!currentSelection || !key) return;
    const parsed = createReferenceAssetInputSchema.safeParse({ entityId: effectiveAssetEntityId, label: assetLabel, requestId: requestId("reference-asset-create"), actorId: "local-user" });
    if (!parsed.success) {
      setAssetCreateState({ key, busy: false, error: "Enter a label and choose a Shot-linked entity before creating metadata.", notice: null });
      return;
    }
    setAssetCreateState({ key, busy: true, error: null, notice: null });
    const isCurrent = () => Boolean(selectionRef.current && isCurrentCompilationResponse(selectionRef.current, currentSelection));
    try {
      const result = await createReferenceAsset(projectId, parsed.data);
      if (!isCurrent()) return;
      pendingAssetIdRef.current = result.referenceAsset.id;
      setAssetLabel("");
      setAssetCreateState({ key, busy: true, error: null, notice: result.idempotent ? "Approved reference metadata already existed; it is selected after refresh." : "Approved reference metadata created; refreshing assets to select it." });
      setRefreshToken((value) => value + 1);
    } catch (error) {
      if (!isCurrent()) return;
      setAssetCreateState({ key, busy: false, error: errorMessage(error, "Reference metadata could not be created. The Scene remains unchanged."), notice: null });
    } finally {
      if (isCurrent()) setAssetCreateState((current) => current?.key === key ? { ...current, busy: false } : current);
    }
  }, [assetLabel, effectiveAssetEntityId, projectId, selection, selectionKey]);

  const compile = React.useCallback(async () => {
    if (!selection || boardDirty || compiling) return;
    const durationSeconds = durationInput.trim() ? Number(durationInput) : null;
    const aspectRatio = aspectInput.trim() ? aspectInput.trim() : null;
    const rawInput = {
      capabilityProfileId: FAKE_VIDEO_CAPABILITY_PROFILE.id,
      referenceAssetIds: selectedAssetIds,
      parameters: { durationSeconds, aspectRatio },
      requestId: requestId("shot-compile"),
      actorId: "local-user",
    };
    const parsed = compileShotInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setCompileValidationError(issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Enter valid compile parameters.");
      setCompileErrorState(null);
      return;
    }
    setCompileValidationError(null);
    setCompileErrorState(null);
    setCompileResultState(null);
    const guard = selectionKey;
    if (!guard) return;
    compileGuardRef.current = guard;
    setCompiling(true);
    try {
      const result = await compileShot(projectId, shotSpecId ?? "", parsed.data);
      if (!selectionRef.current || !isCurrentCompilationResponse(selectionRef.current, selection) || compileGuardRef.current !== guard) return;
      setCompileResultState({ key: compileInputSignature, result });
    } catch (error) {
      if (!selectionRef.current || !isCurrentCompilationResponse(selectionRef.current, selection) || compileGuardRef.current !== guard) return;
      setCompileErrorState({ key: compileInputSignature, message: errorMessage(error, "Compilation preview failed. Retry; the Scene remains available.") });
    } finally {
      if (compileGuardRef.current === guard) {
        compileGuardRef.current = null;
        setCompiling(false);
      }
    }
  }, [boardDirty, compiling, compileInputSignature, durationInput, projectId, selectedAssetIds, selection, selectionKey, shotSpecId, aspectInput]);

  if (boardStatus !== "approved") {
    return (
      <section className="mt-5 min-w-0 rounded-md border border-line bg-surface-raised p-3" data-testid={`compilation-preview-${shotIndex}`}>
        <h6 className="text-xs font-semibold text-ink">Fake Video Compile Preview</h6>
        <p className="mt-2 break-words text-xs leading-5 text-ink-muted">{boardStatus === "superseded" ? "This Storyboard is superseded. Select the current approved Storyboard before compiling." : "This Storyboard is a draft. Approve it before compiling a Shot."}</p>
      </section>
    );
  }

  return (
    <section className="mt-5 min-w-0 rounded-md border border-accent/30 bg-surface-raised p-3" data-testid={`compilation-preview-${shotIndex}`} aria-labelledby={`compilation-preview-heading-${shotIndex}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">Phase 5B</p><h6 id={`compilation-preview-heading-${shotIndex}`} className="mt-1 break-words text-xs font-semibold text-ink">Fake Video Compile Preview</h6><p className="mt-1 break-words text-[11px] leading-5 text-ink-muted">Compile the approved Shot into a deterministic provider request preview. No media is submitted or generated.</p></div>
        <span className="max-w-full break-all rounded border border-line px-2 py-1 font-mono text-[10px] text-ink-faint">ShotSpec {shotSpecId ?? "not saved"}</span>
      </div>
      {boardDirty ? <p role="alert" className="mt-3 break-words border-l-2 border-danger pl-3 text-xs leading-5 text-danger">This approved board has local edits. Save a replacement and approve the current board before compiling.</p> : null}

      <section className="mt-4 min-w-0 rounded-md border border-line bg-surface p-3" data-testid="compilation-capability-profile">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><h6 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Capability profile</h6><span className="rounded border border-success/40 px-2 py-1 text-[10px] font-semibold text-success">fake-video</span></div>
        <dl className="mt-3 grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"><div className="min-w-0"><dt className="text-ink-faint">Provider</dt><dd className="mt-1 break-words text-ink">{FAKE_VIDEO_CAPABILITY_PROFILE.provider}</dd></div><div className="min-w-0"><dt className="text-ink-faint">Model</dt><dd className="mt-1 break-words text-ink">{FAKE_VIDEO_CAPABILITY_PROFILE.model}</dd></div><div className="min-w-0"><dt className="text-ink-faint">Profile ID</dt><dd className="mt-1 break-words text-ink">{FAKE_VIDEO_CAPABILITY_PROFILE.id}</dd></div><div className="min-w-0"><dt className="text-ink-faint">Profile version</dt><dd className="mt-1 break-words text-ink">{FAKE_VIDEO_CAPABILITY_PROFILE.version}</dd></div></dl>
        <p className="mt-3 break-words text-[11px] leading-5 text-ink-faint">Supported durations: {FAKE_VIDEO_CAPABILITY_PROFILE.limits.durationSeconds.join(" / ")} seconds · aspect ratios: {FAKE_VIDEO_CAPABILITY_PROFILE.limits.aspectRatios.join(" / ")} · max {FAKE_VIDEO_CAPABILITY_PROFILE.supports.maxReferenceImages} reference images.</p>
      </section>

      <section className="mt-4 min-w-0 rounded-md border border-line bg-surface p-3" aria-labelledby={`reference-assets-heading-${shotIndex}`}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h6 id={`reference-assets-heading-${shotIndex}`} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Approved reference metadata</h6><p className="mt-1 break-words text-[11px] leading-5 text-ink-muted">Only approved assets for this Shot’s subjects, location, and props are listed. Metadata only / no upload.</p></div><span className="rounded border border-line px-2 py-1 text-[10px] text-ink-faint">{selectedAssetIds.length} / 20 inputs · provider max {FAKE_VIDEO_CAPABILITY_PROFILE.supports.maxReferenceImages}</span></div>
        {assetLoading ? <p className="mt-3 text-xs text-accent" aria-live="polite">Loading approved reference metadata…</p> : null}
        {assetError ? <p role="alert" className="mt-3 break-words border-l-2 border-danger pl-3 text-xs leading-5 text-danger">{assetError}</p> : null}
        <AssetList assets={assets} entities={entities} selectedIds={selectedAssetIds} onToggle={toggleAsset} disabled={assetLoading || compiling || boardDirty} />
        {entities.length > 0 ? <form className="mt-4 min-w-0 border-t border-line pt-4" onSubmit={(event) => void createMetadata(event)}><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Create local approved metadata</p><div className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2"><div className="min-w-0"><label className="block text-xs font-semibold text-ink" htmlFor={`reference-entity-${shotIndex}`}>Shot-linked entity</label><select id={`reference-entity-${shotIndex}`} value={effectiveAssetEntityId} onChange={(event) => setAssetEntityId(event.target.value)} disabled={assetCreating || boardDirty} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-2 text-xs text-ink">{entities.map((entity) => <option key={entity.entityId} value={entity.entityId}>{entity.canonicalName} · {entity.type}</option>)}</select></div><div className="min-w-0"><label className="block text-xs font-semibold text-ink" htmlFor={`reference-label-${shotIndex}`}>Metadata label</label><input id={`reference-label-${shotIndex}`} value={assetLabel} onChange={(event) => setAssetLabel(event.target.value)} maxLength={300} disabled={assetCreating || boardDirty} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-2 text-xs text-ink" placeholder="e.g. blue coat reference" /></div></div>{assetCreateError ? <p role="alert" className="mt-2 break-words text-xs leading-5 text-danger">{assetCreateError}</p> : null}{assetCreateNotice ? <p className="mt-2 break-words text-xs leading-5 text-success">{assetCreateNotice}</p> : null}<button type="submit" disabled={assetCreating || boardDirty || !effectiveAssetEntityId || !assetLabel.trim()} className="mt-3 inline-flex min-h-9 items-center rounded-md border border-accent px-3 text-xs font-semibold text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-45">{assetCreating ? "Creating metadata…" : "Create approved reference metadata"}</button></form> : null}
      </section>

      <section className="mt-4 min-w-0 rounded-md border border-line bg-surface p-3" aria-labelledby={`compile-parameters-heading-${shotIndex}`}>
        <h6 id={`compile-parameters-heading-${shotIndex}`} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Compile parameters</h6>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"><div className="min-w-0"><label className="block text-xs font-semibold text-ink" htmlFor={`compile-duration-${shotIndex}`}>Duration seconds</label><input id={`compile-duration-${shotIndex}`} type="number" min="0.1" max="60" step="0.1" value={durationInput} onChange={(event) => { invalidateCompile(); setDurationInput(event.target.value); }} disabled={compiling || boardDirty} placeholder={shot.durationSeconds === null ? "Provider default" : undefined} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-2 text-xs text-ink" /><p className="mt-1 text-[10px] text-ink-faint">Accepts any 0.1–60; provider normalizes unsupported values.</p></div><div className="min-w-0"><label className="block text-xs font-semibold text-ink" htmlFor={`compile-aspect-${shotIndex}`}>Aspect ratio</label><input id={`compile-aspect-${shotIndex}`} value={aspectInput} onChange={(event) => { invalidateCompile(); setAspectInput(event.target.value); }} disabled={compiling || boardDirty} maxLength={20} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-2 text-xs text-ink" /><p className="mt-1 text-[10px] text-ink-faint">Supported: 16:9 / 9:16; any ≤20 characters shows server fallback warnings.</p></div></div>
        {compileValidationError ? <p role="alert" className="mt-3 break-words border-l-2 border-danger pl-3 text-xs leading-5 text-danger">{compileValidationError}</p> : null}
        {compileError ? <p role="alert" className="mt-3 break-words border-l-2 border-danger pl-3 text-xs leading-5 text-danger">{compileError}</p> : null}
        <button type="button" onClick={() => void compile()} disabled={compiling || boardDirty || !selection || assetLoading} className="mt-4 inline-flex min-h-10 items-center rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45" data-testid="compile-preview">{compiling ? "Compiling preview…" : "Compile preview"}</button>
      </section>

      {compileResult ? <CompileResult result={compileResult} entities={entities} /> : null}
    </section>
  );
}
