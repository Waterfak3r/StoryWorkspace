"use client";

import * as React from "react";
import { ArrowClockwise, Check, Plus } from "@phosphor-icons/react";
import type { ContextEntity, ContextSnapshot } from "@/domain/context-builder";
import { shotSpecContentSchema, type ShotSpecContent, type Storyboard, type StoryboardStatus } from "@/domain/storyboard";
import type { CompileShotResult } from "@/domain/generation-compiler";
import { CompilationPreview } from "./CompilationPreview";
import type { CompilationSelection } from "./scripts-workspace-helpers";
import { useI18n } from "@/features/i18n/LocaleProvider";

export type StoryboardDraft = {
  title: string;
  shots: ShotSpecContent[];
};

export type StoryboardEditorState = {
  loading: boolean;
  saving: boolean;
  approving: boolean;
  loaded: boolean;
  list: Storyboard[];
  selectedStoryboardId: string | null;
  draft: StoryboardDraft | null;
  dirty: boolean;
  error: string | null;
};

type StoryboardEditorProps = {
  projectId: string;
  snapshot: ContextSnapshot | null;
  state: StoryboardEditorState | null;
  selectionValid: boolean;
  onNew: () => void;
  onDraftChange: (draft: StoryboardDraft) => void;
  onLoad: (storyboardId: string) => void;
  onSave: () => void;
  onApprove: () => void;
  onReload: () => void;
  onCompileResult?: (selection: CompilationSelection, result: CompileShotResult | null) => void;
  renderGenerationPanel?: (selection: CompilationSelection, result: CompileShotResult) => React.ReactNode;
};

function entityLabel(entity: ContextEntity) {
  return `${entity.canonicalName} · ${entity.type}`;
}

function characters(snapshot: ContextSnapshot | null) {
  return snapshot?.content.entities.filter((entity) => entity.type === "character") ?? [];
}

function locations(snapshot: ContextSnapshot | null) {
  return snapshot?.content.entities.filter((entity) => entity.type === "location") ?? [];
}

function props(snapshot: ContextSnapshot | null) {
  return snapshot?.content.entities.filter((entity) => entity.type === "prop") ?? [];
}

function updateShot(draft: StoryboardDraft, index: number, update: Partial<ShotSpecContent>): StoryboardDraft {
  return { ...draft, shots: draft.shots.map((shot, shotIndex) => shotIndex === index ? { ...shot, ...update } : shot) };
}

function updateSubject(draft: StoryboardDraft, shotIndex: number, subjectIndex: number, update: Partial<ShotSpecContent["subjects"][number]>): StoryboardDraft {
  return updateShot(draft, shotIndex, {
    subjects: draft.shots[shotIndex].subjects.map((subject, index) => index === subjectIndex ? { ...subject, ...update } : subject),
  });
}

function StoryboardShotEditor({
  projectId,
  draft,
  shotIndex,
  snapshot,
  onChange,
  disabled,
  boardStatus,
  boardDirty,
  storyboardId,
  shotSpecId,
  onRemove,
  onCompileResult,
  renderGenerationPanel,
}: {
  projectId: string;
  draft: StoryboardDraft;
  shotIndex: number;
  snapshot: ContextSnapshot;
  onChange: (next: StoryboardDraft) => void;
  disabled: boolean;
  boardStatus: StoryboardStatus;
  boardDirty: boolean;
  storyboardId: string | null;
  shotSpecId: string | null;
  onRemove: () => void;
  onCompileResult?: (selection: CompilationSelection, result: CompileShotResult | null) => void;
  renderGenerationPanel?: (selection: CompilationSelection, result: CompileShotResult) => React.ReactNode;
}) {
  const { t } = useI18n();
  const shot = draft.shots[shotIndex];
  const characterEntities = characters(snapshot);
  const locationEntities = locations(snapshot);
  const propEntities = props(snapshot);
  const selectedSubjectIds = new Set(shot.subjects.map((subject) => subject.entityId));
  const nextCharacter = characterEntities.find((entity) => !selectedSubjectIds.has(entity.entityId)) ?? null;

  return (
    <li className="min-w-0 rounded-lg border border-line bg-surface p-4" data-testid={`storyboard-shot-${shotIndex}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("Shot {ordinal}", { ordinal: shot.ordinal })}</p>
          <p className="mt-1 text-xs text-ink-muted">{t("Every ShotSpec is immutable after save; editing creates a new Storyboard version.")}</p>
        </div>
        <button type="button" onClick={onRemove} disabled={disabled || draft.shots.length <= 1} className="min-h-9 rounded-md border border-line px-2 text-xs font-semibold text-ink-muted hover:border-danger hover:text-danger disabled:cursor-not-allowed disabled:opacity-40">{t("Remove shot")}</button>
      </div>

      <label className="mt-4 block text-xs font-semibold text-ink" htmlFor={`storyboard-shot-purpose-${shotIndex}`}>{t("Narrative purpose")}</label>
      <textarea id={`storyboard-shot-purpose-${shotIndex}`} value={shot.narrativePurpose} onChange={(event) => onChange(updateShot(draft, shotIndex, { narrativePurpose: event.target.value }))} disabled={disabled} maxLength={1000} className="mt-2 min-h-16 w-full min-w-0 resize-y rounded-md border border-line bg-surface-raised px-3 py-2 text-sm leading-5 text-ink" />

      <div className="mt-4 rounded-md border border-line bg-surface-raised p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ink">{t("Subjects")}</p>
          <span className="text-[11px] text-ink-faint">{t("Snapshot Characters only")}</span>
        </div>
        <ul className="mt-3 space-y-3" aria-label={t("Subjects for shot {ordinal}", { ordinal: shot.ordinal })}>
          {shot.subjects.map((subject, subjectIndex) => (
            <li key={`${shotIndex}-${subjectIndex}`} className="min-w-0 rounded-md border border-line bg-surface p-3" data-testid={`storyboard-subject-${shotIndex}-${subjectIndex}`}>
              <label className="block text-xs font-semibold text-ink" htmlFor={`storyboard-subject-character-${shotIndex}-${subjectIndex}`}>{t("Character")}</label>
              <select id={`storyboard-subject-character-${shotIndex}-${subjectIndex}`} value={subject.entityId} onChange={(event) => onChange(updateSubject(draft, shotIndex, subjectIndex, { entityId: event.target.value }))} disabled={disabled || characterEntities.length === 0} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink">
                {characterEntities.length === 0 ? <option value="">{t("No included Character")}</option> : characterEntities.map((entity) => <option key={entity.entityId} value={entity.entityId} disabled={entity.entityId !== subject.entityId && selectedSubjectIds.has(entity.entityId)}>{entityLabel(entity)}</option>)}
              </select>
              <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-ink" htmlFor={`storyboard-subject-action-${shotIndex}-${subjectIndex}`}>{t("Action")}</label>
                  <input id={`storyboard-subject-action-${shotIndex}-${subjectIndex}`} value={subject.action} onChange={(event) => onChange(updateSubject(draft, shotIndex, subjectIndex, { action: event.target.value }))} disabled={disabled} maxLength={1000} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink" />
                </div>
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-ink" htmlFor={`storyboard-subject-role-${shotIndex}-${subjectIndex}`}>{t("Framing role")}</label>
                  <select id={`storyboard-subject-role-${shotIndex}-${subjectIndex}`} value={subject.framingRole} onChange={(event) => onChange(updateSubject(draft, shotIndex, subjectIndex, { framingRole: event.target.value as ShotSpecContent["subjects"][number]["framingRole"] }))} disabled={disabled} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink">
                    <option value="primary">{t("Primary")}</option><option value="secondary">{t("Secondary")}</option><option value="background">{t("Background")}</option>
                  </select>
                </div>
              </div>
              <label className="mt-3 block text-xs font-semibold text-ink" htmlFor={`storyboard-subject-expression-${shotIndex}-${subjectIndex}`}>{t("Expression")} <span className="font-normal text-ink-faint">{t("optional")}</span></label>
              <input id={`storyboard-subject-expression-${shotIndex}-${subjectIndex}`} value={subject.expression ?? ""} onChange={(event) => onChange(updateSubject(draft, shotIndex, subjectIndex, { expression: event.target.value || null }))} disabled={disabled} maxLength={500} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink" />
              {shot.subjects.length > 1 ? <button type="button" onClick={() => onChange(updateShot(draft, shotIndex, { subjects: shot.subjects.filter((_, index) => index !== subjectIndex) }))} disabled={disabled} className="mt-3 min-h-9 rounded-md border border-line px-2 text-xs text-ink-muted hover:border-danger hover:text-danger disabled:opacity-40">{t("Remove subject")}</button> : null}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => nextCharacter && onChange(updateShot(draft, shotIndex, { subjects: [...shot.subjects, { entityId: nextCharacter.entityId, action: "", expression: null, framingRole: "secondary" }] }))} disabled={disabled || nextCharacter === null || shot.subjects.length >= 20} className="mt-3 min-h-9 rounded-md border border-line px-2 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40">{t("Add subject")}</button>
      </div>

      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="block text-xs font-semibold text-ink" htmlFor={`storyboard-shot-location-${shotIndex}`}>{t("Location")}</label>
          <select id={`storyboard-shot-location-${shotIndex}`} value={shot.locationEntityId ?? ""} onChange={(event) => onChange(updateShot(draft, shotIndex, { locationEntityId: event.target.value || null }))} disabled={disabled} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink">
            <option value="">{t("No location")}</option>{locationEntities.map((entity) => <option key={entity.entityId} value={entity.entityId}>{entityLabel(entity)}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-semibold text-ink" htmlFor={`storyboard-shot-duration-${shotIndex}`}>{t("Duration seconds")} <span className="font-normal text-ink-faint">{t("optional")}</span></label>
          <input id={`storyboard-shot-duration-${shotIndex}`} type="number" min="0.1" max="60" step="0.1" value={shot.durationSeconds ?? ""} onChange={(event) => onChange(updateShot(draft, shotIndex, { durationSeconds: event.target.value ? Number(event.target.value) : null }))} disabled={disabled} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink" />
        </div>
      </div>
      <fieldset className="mt-4 min-w-0">
        <legend className="text-xs font-semibold text-ink">{t("Props · Snapshot Props only")}</legend>
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {propEntities.length === 0 ? <p className="text-xs text-ink-faint">{t("No included Props.")}</p> : propEntities.map((entity) => {
            const checked = shot.propEntityIds.includes(entity.entityId);
            return <label key={entity.entityId} className="flex min-w-0 items-start gap-2 rounded-md border border-line bg-surface-raised px-3 py-2 text-xs text-ink"><input type="checkbox" checked={checked} onChange={(event) => onChange(updateShot(draft, shotIndex, { propEntityIds: event.target.checked ? [...shot.propEntityIds, entity.entityId] : shot.propEntityIds.filter((id) => id !== entity.entityId) }))} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-accent" /><span className="min-w-0 break-words">{entityLabel(entity)}</span></label>;
          })}
        </div>
      </fieldset>

      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0"><label className="block text-xs font-semibold text-ink" htmlFor={`storyboard-shot-framing-${shotIndex}`}>{t("Framing")} <span className="font-normal text-ink-faint">{t("optional")}</span></label><input id={`storyboard-shot-framing-${shotIndex}`} value={shot.framing ?? ""} onChange={(event) => onChange(updateShot(draft, shotIndex, { framing: event.target.value || null }))} disabled={disabled} maxLength={500} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink" placeholder={t("e.g. medium two-shot")} /></div>
        <div className="min-w-0"><label className="block text-xs font-semibold text-ink" htmlFor={`storyboard-shot-camera-${shotIndex}`}>{t("Camera motion")} <span className="font-normal text-ink-faint">{t("optional")}</span></label><input id={`storyboard-shot-camera-${shotIndex}`} value={shot.cameraMotion ?? ""} onChange={(event) => onChange(updateShot(draft, shotIndex, { cameraMotion: event.target.value || null }))} disabled={disabled} maxLength={500} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink" placeholder={t("e.g. slow push-in")} /></div>
      </div>
      <label className="mt-4 block text-xs font-semibold text-ink" htmlFor={`storyboard-shot-lens-${shotIndex}`}>{t("Lens")} <span className="font-normal text-ink-faint">{t("optional")}</span></label>
      <input id={`storyboard-shot-lens-${shotIndex}`} value={shot.lens ?? ""} onChange={(event) => onChange(updateShot(draft, shotIndex, { lens: event.target.value || null }))} disabled={disabled} maxLength={200} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink" placeholder={t("e.g. 50mm")} />

      <CompilationPreview
        projectId={projectId}
        snapshot={snapshot}
        storyboardId={storyboardId}
        shotSpecId={shotSpecId}
        shot={shot}
        shotIndex={shotIndex}
        boardStatus={boardStatus}
        boardDirty={boardDirty}
        onCompileResult={onCompileResult}
        renderGenerationPanel={renderGenerationPanel}
      />
    </li>
  );
}

export function StoryboardEditor({ projectId, snapshot, state, selectionValid, onNew, onDraftChange, onLoad, onSave, onApprove, onReload, onCompileResult, renderGenerationPanel }: StoryboardEditorProps) {
  const { t } = useI18n();
  const draft = state?.draft ?? null;
  const characterEntities = characters(snapshot);
  const selectedBoard = state?.list.find((board) => board.id === state.selectedStoryboardId) ?? null;
  const selectedBoardIsEditable = selectedBoard?.status !== "superseded";
  const canEdit = Boolean(snapshot && selectionValid && draft && selectedBoardIsEditable && !state?.saving && !state?.approving);
  const draftIsValid = Boolean(draft?.title.trim() && draft.shots.length >= 1 && draft.shots.length <= 100
    && new Set(draft.shots.map((shot) => shot.ordinal)).size === draft.shots.length
    && draft.shots.every((shot) => shotSpecContentSchema.safeParse(shot).success));
  const canSave = Boolean(canEdit && state?.dirty && draftIsValid);

  if (!snapshot || snapshot.purpose !== "storyboard") {
    return <section className="mt-6 rounded-lg border border-line bg-surface p-4" data-testid="storyboard-editor"><p className="text-sm font-semibold text-ink">{t("Storyboard Editor")}</p><p className="mt-2 text-xs leading-5 text-ink-faint">{t("Choose the Storyboard purpose and load a Context Snapshot to edit immutable ShotSpecs.")}</p></section>;
  }

  return (
    <section className="mt-6 min-w-0 rounded-lg border border-accent/30 bg-accent/5 p-4" aria-labelledby="storyboard-editor-heading" data-testid="storyboard-editor">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">{t("Phase 5A")}</p><h5 id="storyboard-editor-heading" className="mt-2 break-words text-sm font-semibold text-ink">{t("Storyboard Editor / Inspector")}</h5><p className="mt-1 max-w-[62ch] text-xs leading-5 text-ink-muted">{t("This editor consumes only the selected immutable Context Snapshot. Characters, Locations, and Props below are constrained to its included entities.")}</p></div>
        <div className="flex shrink-0 flex-wrap gap-2"><span className="rounded border border-accent/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">{t("Snapshot-bound")}</span><span className="rounded border border-line px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{t("No in-place Shot edits")}</span></div>
      </div>
      <p className="mt-4 break-all font-mono text-[10px] text-ink-faint" data-testid="storyboard-context-snapshot-id">{t("Context Snapshot")} · {snapshot.id}</p>

      {!selectionValid ? <p role="alert" className="mt-4 border-l-2 border-danger pl-3 text-xs leading-5 text-danger" data-testid="storyboard-selection-error">{t("This Snapshot no longer matches the selected Scene revision. Select a current loaded Snapshot before saving a Storyboard.")}</p> : null}
      {state?.error ? <p role="alert" className="mt-4 break-words border-l-2 border-danger pl-3 text-xs leading-5 text-danger">{t("Storyboard error")}: {state.error}</p> : null}
      {state?.loading ? <p className="mt-4 text-xs text-accent" aria-live="polite">{t("Loading Storyboards for this Snapshot…")}</p> : null}

      <div className="mt-5 min-w-0 rounded-md border border-line bg-surface p-3" data-testid="storyboard-list">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold text-ink">{t("Saved boards")}</p><p className="mt-1 text-[11px] text-ink-faint">{t("{count} versions for this Context Snapshot", { count: state?.list.length ?? 0 })}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={onReload} disabled={!selectionValid || state?.loading || state?.saving || state?.approving} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"><ArrowClockwise size={13} aria-hidden="true" /> {t("Reload")}</button><button type="button" onClick={onNew} disabled={!selectionValid || state?.saving || state?.approving} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"><Plus size={13} aria-hidden="true" /> {t("New board")}</button></div></div>
        {state?.list.length ? <ul className="mt-3 space-y-2">{state.list.map((board) => <li key={board.id} className={`flex min-w-0 flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${board.id === state.selectedStoryboardId ? "border-accent bg-accent/5" : "border-line bg-surface-raised"}`}><button type="button" onClick={() => onLoad(board.id)} disabled={!selectionValid || state.loading || state.saving || state.approving} className="min-h-9 min-w-0 flex-1 break-words text-left text-xs font-semibold text-ink hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">{board.title} <span className="font-normal text-ink-faint">· v{board.version}</span></button><span className={`rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${board.status === "approved" ? "border-success/40 text-success" : board.status === "superseded" ? "border-line text-ink-faint" : "border-accent/40 text-accent"}`}>{t(board.status)}</span></li>)}</ul> : <p className="mt-3 border-l-2 border-line pl-3 text-xs leading-5 text-ink-faint">{t("No Storyboard versions yet. Start a manual board from this Snapshot.")}</p>}
      </div>

      {draft ? <div className="mt-5 min-w-0 rounded-md border border-line bg-surface p-4" data-testid="storyboard-draft-form">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">{selectedBoard ? t("{status} board · edit as replacement", { status: t(selectedBoard.status) }) : t("New draft")}</p><p className="mt-1 text-xs leading-5 text-ink-muted">{selectedBoard ? t("Saving sends supersedesStoryboardId={id} with expectedSupersededVersion={version}.", { id: selectedBoard.id, version: selectedBoard.version }) : t("Saving creates a draft Storyboard and immutable ShotSpecs.")}</p></div>{state?.dirty ? <span className="rounded border border-accent/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">{t("Unsaved local edits")}</span> : <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-success"><Check size={13} aria-hidden="true" /> {t("Saved")}</span>}</div>
        <label className="mt-4 block text-xs font-semibold text-ink" htmlFor="storyboard-title">{t("Storyboard title")}</label><input id="storyboard-title" data-testid="storyboard-title" value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} disabled={!canEdit} maxLength={300} className="mt-2 min-h-10 w-full min-w-0 rounded-md border border-line bg-surface-raised px-3 text-sm text-ink" />
        <div className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold text-ink">{t("ShotSpecs ({count})", { count: draft.shots.length })}</p><p className="mt-1 text-[11px] text-ink-faint">{t("At least one Shot with one included Character is required.")}</p></div><button type="button" onClick={() => onDraftChange({ ...draft, shots: [...draft.shots, { ordinal: draft.shots.length + 1, narrativePurpose: "", subjects: [{ entityId: characterEntities[0]?.entityId ?? "", action: "", expression: null, framingRole: "primary" }], locationEntityId: null, propEntityIds: [], framing: null, cameraMotion: null, lens: null, durationSeconds: null, dialogueLineIds: [], continuityConstraints: [], negativeConstraints: [] }] })} disabled={!canEdit || characterEntities.length === 0 || draft.shots.length >= 100} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-line px-2 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"><Plus size={13} aria-hidden="true" /> {t("Add shot")}</button></div>
        {characterEntities.length === 0 ? <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-xs leading-5 text-danger">{t("This Snapshot includes no Character. Add or confirm a Character, build a new Snapshot, then create a Storyboard.")}</p> : null}
        <ol className="mt-3 min-w-0 space-y-4" aria-label={t("Storyboard shots")}>{draft.shots.map((_, index) => {
          const persistedShot = selectedBoard?.shots[index] ?? null;
          return <StoryboardShotEditor key={`${index}-${selectedBoard?.id ?? "draft"}-${persistedShot?.id ?? "new"}`} projectId={projectId} draft={draft} shotIndex={index} snapshot={snapshot} onChange={onDraftChange} disabled={!canEdit} boardStatus={selectedBoard?.status ?? "draft"} boardDirty={Boolean(state?.dirty)} storyboardId={selectedBoard?.id ?? null} shotSpecId={persistedShot?.id ?? null} onRemove={() => onDraftChange({ ...draft, shots: draft.shots.filter((__, shotIndex) => shotIndex !== index).map((shot, shotIndex) => ({ ...shot, ordinal: shotIndex + 1 })) })} onCompileResult={onCompileResult} renderGenerationPanel={renderGenerationPanel} />;
        })}</ol>
        <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2"><button type="button" onClick={onSave} disabled={!canSave} className="inline-flex min-h-10 items-center rounded-md bg-accent px-3 text-xs font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-45" data-testid="storyboard-save">{state?.saving ? t("Saving draft…") : selectedBoard?.status === "superseded" ? t("Superseded version") : selectedBoard ? t("Save new version") : t("Save draft")}</button>{selectedBoard?.status === "draft" ? <button type="button" onClick={onApprove} disabled={Boolean(state?.approving || state?.saving || state?.dirty) || !selectionValid} className="inline-flex min-h-10 items-center rounded-md border border-success px-3 text-xs font-semibold text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-45" data-testid="storyboard-approve">{state?.approving ? t("Approving…") : t("Approve draft")}</button> : null}{selectedBoard?.status === "approved" ? <span className="text-xs font-semibold text-success">{t("Approved · edit creates a replacement version.")}</span> : null}{selectedBoard?.status === "superseded" ? <span className="text-xs text-ink-faint">{t("Historical version · read-only. Start a new board to reuse its ideas.")}</span> : null}<span className="text-[11px] text-ink-faint">{state?.saving || state?.approving ? t("Waiting for the CAS-safe Storyboard operation…") : ""}</span></div>
      </div> : <p className="mt-5 text-xs text-ink-faint">{t("Preparing a local Storyboard draft…")}</p>}
    </section>
  );
}
