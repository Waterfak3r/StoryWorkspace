"use client";

import * as React from "react";
import { ArrowCounterClockwise, Check, Copy, FilmScript } from "@phosphor-icons/react";
import type { Adaptation } from "@/domain/adaptation";
import { adaptationConflictDraft, adaptationStatusLabel } from "./adaptation-workspace-helpers";
import { useAdaptationAutosave } from "./useAdaptationAutosave";

export type AdaptationWorkspaceHandle = {
  flush: () => Promise<boolean>;
};

type AdaptationWorkspaceProps = {
  projectId: string;
  adaptation: Adaptation;
  onAdaptationChanged: (adaptation: Adaptation) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export const AdaptationWorkspace = React.forwardRef<AdaptationWorkspaceHandle, AdaptationWorkspaceProps>(function AdaptationWorkspace({
  projectId,
  adaptation,
  onAdaptationChanged,
  onDirtyChange,
}, ref) {
  const autosave = useAdaptationAutosave({ projectId, adaptation, onAdaptationChanged });
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [keepLocalPending, setKeepLocalPending] = React.useState(false);

  React.useImperativeHandle(ref, () => ({ flush: autosave.flush }), [autosave.flush]);

  React.useEffect(() => {
    const status = autosave.state?.status;
    onDirtyChange?.(status === "dirty" || status === "saving" || status === "failed" || status === "conflict");
  }, [autosave.state, onDirtyChange]);

  if (autosave.loading || !autosave.state) {
    return (
      <section aria-label="Loading adaptation editor" className="max-w-[900px] animate-pulse">
        <div className="h-4 w-36 rounded bg-surface-muted" />
        <div className="mt-4 h-12 w-full rounded-lg bg-surface-muted" />
        <div className="mt-5 h-[min(52vh,560px)] w-full rounded-xl bg-surface-muted" />
      </section>
    );
  }

  const state = autosave.state;
  const localDraft = adaptationConflictDraft(state.draft, state.recoveryDraft);
  const serverAdaptation = state.serverAdaptation;
  const conflict = state.status === "conflict" && serverAdaptation !== null;
  const editable = !conflict && !keepLocalPending;

  async function handleCopy() {
    setCopyError(null);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(localDraft.body);
      setNotice("Draft copied.");
    } catch {
      setCopyError("Copy failed. Select the text and copy it manually.");
    }
  }

  function handleUseServer() {
    if (autosave.useServerVersion()) {
      setNotice("Server version restored.");
      setCopyError(null);
    }
  }

  async function handleKeepLocal() {
    if (keepLocalPending) return;
    setKeepLocalPending(true);
    setCopyError(null);
    setNotice(null);
    try {
      const saved = await autosave.keepMyDraft();
      if (saved) {
        setNotice("Local draft saved.");
      }
    } finally {
      setKeepLocalPending(false);
    }
  }

  return (
    <section aria-labelledby="adaptation-workspace-heading" className="min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-ink-faint"><FilmScript size={18} weight="regular" aria-hidden="true" /> Adaptation editor</div>
          <h2 id="adaptation-workspace-heading" className="mt-3 max-w-[30ch] text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">Adaptation draft</h2>
          <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-muted">Screenplay scene format with plain Markdown and autosave.</p>
        </div>
        <span aria-live="polite" className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${state.status === "saved" ? "border-success/30 bg-success/10 text-success" : state.status === "conflict" || state.status === "failed" ? "border-danger/30 bg-danger/10 text-danger" : "border-accent/30 bg-accent-soft text-accent-strong"}`}>
          {state.status === "saved" ? <Check size={15} weight="regular" aria-hidden="true" /> : null}
          {adaptationStatusLabel(state.status)}
        </span>
      </header>

      {state.recoverySource === "session" && state.status === "dirty" ? <p role="status" aria-live="polite" className="mt-5 border-l-2 border-accent pl-3 text-sm leading-6 text-ink-muted">A local draft was recovered for this adaptation. It will save after you pause.</p> : null}
      {state.error && state.status === "failed" ? (
        <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-l-2 border-danger pl-3 text-sm text-danger">
          <span>{state.error.message}</span>
          <button type="button" onClick={() => { void autosave.retry(); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-danger/30 px-3 font-semibold transition-colors hover:bg-danger/10"><ArrowCounterClockwise size={16} weight="regular" aria-hidden="true" /> Retry</button>
        </div>
      ) : null}
      {notice ? <p role="status" aria-live="polite" className="mt-5 border-l-2 border-success pl-3 text-sm text-success">{notice}</p> : null}
      {copyError ? <p role="alert" className="mt-5 border-l-2 border-danger pl-3 text-sm text-danger">{copyError}</p> : null}

      {conflict && serverAdaptation ? (
        <section aria-labelledby="adaptation-conflict-heading" className="mt-8 max-w-[900px] border border-danger/30 bg-surface-raised p-5 sm:p-6">
          <h3 id="adaptation-conflict-heading" className="text-lg font-semibold text-ink">Review both adaptation drafts</h3>
            <p className="mt-2 text-sm leading-6 text-ink-muted">The server has a newer version. Choose which draft should remain before editing again.</p>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold text-ink">Your draft</h4>
                <dl className="mt-2 space-y-3 border border-line bg-canvas p-4 text-sm leading-6">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Title</dt>
                    <dd className="mt-1 break-words text-ink">{localDraft.title || "Untitled adaptation"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Body</dt>
                    <dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-ink">{localDraft.body || "No body text"}</dd>
                  </div>
                </dl>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-ink">Server version</h4>
                <dl className="mt-2 space-y-3 border border-line bg-canvas p-4 text-sm leading-6">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Title</dt>
                    <dd className="mt-1 break-words text-ink">{serverAdaptation.title || "Untitled adaptation"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Body</dt>
                    <dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-ink">{serverAdaptation.body || "No body text"}</dd>
                  </div>
                </dl>
              </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={handleUseServer} disabled={keepLocalPending} className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50">Use server version</button>
            <button type="button" onClick={() => { void handleKeepLocal(); }} disabled={keepLocalPending} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">{keepLocalPending ? "Saving local draft" : "Keep my draft"}</button>
            <button type="button" onClick={() => { void handleCopy(); }} disabled={keepLocalPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"><Copy size={16} weight="regular" aria-hidden="true" /> Copy my draft</button>
          </div>
        </section>
      ) : (
        <div className="mt-8 max-w-[900px]">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)]">
            <div>
              <label htmlFor="adaptation-title" className="text-sm font-semibold text-ink">Title</label>
              <input id="adaptation-title" value={state.draft.title} maxLength={160} disabled={!editable} onChange={(event) => autosave.edit({ title: event.target.value })} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-base text-ink shadow-sm transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">Format</p>
              <p className="mt-2 flex min-h-11 items-center rounded-lg border border-line bg-surface-muted px-3 text-sm text-ink-muted">Screenplay scene</p>
            </div>
          </div>
          <div className="mt-8 max-w-[78ch]">
            <label htmlFor="adaptation-body" className="text-sm font-semibold text-ink">Markdown body</label>
            <textarea id="adaptation-body" value={state.draft.body} maxLength={100000} disabled={!editable} onChange={(event) => autosave.edit({ body: event.target.value })} spellCheck={true} className="mt-2 min-h-[min(62vh,720px)] w-full resize-y rounded-xl border border-line bg-surface-raised px-4 py-4 text-[1.02rem] leading-8 text-ink shadow-sm transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" />
            <p className="mt-2 text-xs text-ink-faint">Plain Markdown is preserved as you write. {state.draft.body.length}/100000 characters</p>
          </div>
        </div>
      )}
    </section>
  );
});
