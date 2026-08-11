"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, DownloadSimple, X } from "@phosphor-icons/react";
import { WorkspaceApiError, downloadProjectMarkdown } from "./workspace-api";
import { exportPreviewSections, type ExportPreviewCounts } from "./export-preview-helpers";

type ExportProjectDialogProps = {
  projectId: string;
  projectTitle: string;
  counts: ExportPreviewCounts;
  bibleDirty: boolean;
  outlineDirty: boolean;
  flushActiveDocument: () => Promise<boolean>;
  disabled?: boolean;
};

const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

function exportError(value: unknown, fallback: string) {
  return value instanceof WorkspaceApiError
    ? value
    : new WorkspaceApiError(0, { code: "NETWORK_ERROR", message: fallback, retryable: true });
}

export function ExportProjectDialog({
  projectId,
  projectTitle,
  counts,
  bibleDirty,
  outlineDirty,
  flushActiveDocument,
  disabled = false,
}: ExportProjectDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [downloadPending, setDownloadPending] = React.useState(false);
  const [error, setError] = React.useState<WorkspaceApiError | null>(null);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const exportTriggerRef = React.useRef<HTMLButtonElement>(null);
  const downloadPendingRef = React.useRef(false);
  const idPrefix = React.useId().replaceAll(":", "");
  const headingId = `${idPrefix}-export-heading`;
  const descriptionId = `${idPrefix}-export-description`;
  const sections = exportPreviewSections(counts);

  const close = React.useCallback(() => {
    if (downloadPendingRef.current) {
      return;
    }
    setOpen(false);
    setError(null);
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
      if (document.activeElement !== closeButtonRef.current) {
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      }
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, [close, open]);

  async function prepareExport() {
    if (opening || downloadPending || disabled) {
      return;
    }
    setError(null);
    if (bibleDirty || outlineDirty) {
      setError(new WorkspaceApiError(409, {
        code: "EDIT_CONFLICT",
        message: "Save or discard the open story bible and outline changes before exporting.",
        retryable: false,
      }));
      return;
    }
    setOpening(true);
    try {
      if (!(await flushActiveDocument())) {
        setError(new WorkspaceApiError(409, {
          code: "EDIT_CONFLICT",
          message: "Save the active draft before exporting.",
          retryable: false,
        }));
        return;
      }
      setOpen(true);
    } catch (value) {
      setError(exportError(value, "The active draft could not be saved. Try exporting again."));
    } finally {
      setOpening(false);
    }
  }

  async function handleDownload() {
    if (downloadPending) {
      return;
    }
    let shouldClose = false;
    downloadPendingRef.current = true;
    setDownloadPending(true);
    setError(null);
    try {
      if (bibleDirty || outlineDirty || !(await flushActiveDocument())) {
        throw new WorkspaceApiError(409, {
          code: "EDIT_CONFLICT",
          message: "Save the active draft and resolve open form changes before downloading.",
          retryable: false,
        });
      }
      const result = await downloadProjectMarkdown(projectId);
      const objectUrl = URL.createObjectURL(result.blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = result.filename;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
      shouldClose = true;
    } catch (value) {
      setError(exportError(value, "The Markdown export could not be downloaded. Try again."));
    } finally {
      downloadPendingRef.current = false;
      setDownloadPending(false);
      if (shouldClose) {
        setOpen(false);
        window.requestAnimationFrame(() => exportTriggerRef.current?.focus());
      }
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-2">
        <button ref={exportTriggerRef} type="button" onClick={() => { void prepareExport(); }} disabled={disabled || opening || downloadPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 text-sm font-semibold text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">
          <DownloadSimple size={18} weight="regular" aria-hidden="true" />
          {opening ? "Preparing export" : "Export Markdown"}
        </button>
        {!open && error ? <p role="alert" className="max-w-[28ch] text-right text-xs leading-5 text-danger">{error.message}</p> : null}
      </div>

      {open && portalTarget ? createPortal((
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/35 p-3 sm:items-center sm:p-6">
          <button type="button" tabIndex={-1} aria-label="Close export preview" onClick={close} disabled={downloadPending} data-export-backdrop="true" className="absolute inset-0 cursor-default" />
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId} className="relative flex max-h-[min(88dvh,720px)] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">Project export</p>
                <h2 id={headingId} className="mt-2 text-xl font-semibold tracking-[-0.025em] text-ink">Preview Markdown</h2>
                <p id={descriptionId} className="mt-2 text-sm leading-6 text-ink-muted">Review the records included in this deterministic project download.</p>
              </div>
              <button ref={closeButtonRef} type="button" onClick={close} disabled={downloadPending} aria-label="Close export preview" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"><X size={18} weight="regular" aria-hidden="true" /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="border-l-2 border-accent pl-4">
                <p className="text-sm font-semibold text-ink">{projectTitle}</p>
                <p className="mt-1 text-xs text-ink-faint">Markdown attachment with LF line endings</p>
              </div>
              <dl className="mt-6 divide-y divide-line border-y border-line">
                {sections.map((section) => (
                  <div key={section.id} className="flex min-h-12 items-center justify-between gap-4 py-3 text-sm">
                    <dt className="text-ink-muted">{section.label}</dt>
                    <dd className="font-mono text-xs text-ink">{section.count}</dd>
                  </div>
                ))}
              </dl>
              {error ? <p role="alert" className="mt-5 border-l-2 border-danger pl-3 text-sm leading-6 text-danger">{error.message}</p> : null}
            </div>

            <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4 sm:px-6">
              <button type="button" onClick={close} disabled={downloadPending} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => { void handleDownload(); }} disabled={downloadPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60">
                {downloadPending ? <ArrowCounterClockwise size={17} weight="regular" className="animate-spin" aria-hidden="true" /> : <DownloadSimple size={17} weight="regular" aria-hidden="true" />}
                {downloadPending ? "Downloading" : error ? "Try download again" : "Download Markdown"}
              </button>
            </footer>
          </div>
        </div>
      ), portalTarget) : null}
    </>
  );
}
