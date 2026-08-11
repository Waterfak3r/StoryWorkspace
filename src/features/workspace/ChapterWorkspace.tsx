"use client";

import * as React from "react";
import {
  ArrowCounterClockwise,
  Check,
  ClockCounterClockwise,
  Copy,
  FloppyDisk,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { AiAction, AiContext, AiGenerateResponse } from "@/domain/ai";
import type { Adaptation } from "@/domain/adaptation";
import { CHAPTER_BODY_MAX_LENGTH, type BibleEntry, type Chapter, type ChapterVersion, type OutlineNode } from "@/domain/narrative";
import type { ChapterAutosaveState, ChapterDraft } from "./chapter-autosave";
import { useChapterAutosave } from "./useChapterAutosave";
import { AiAssistant, type AiAcceptMode, type AiAssistantStatus } from "./AiAssistant";
import { canApplyCanonicalAiAcceptance, composeAiBody, resolveInsertCaret, selectionStillMatches, type AiSelectionSnapshot } from "./ai-editor-helpers";
import {
  chapterDraftFromCanonical,
  chapterStatusLabel,
  chapterVersionSourceLabel,
  conflictDraftFor,
  localConflictDraft,
  mergeChapterVersions,
} from "./chapter-workspace-helpers";
import {
  WorkspaceApiError,
  acceptAiDraft,
  createAiAdaptation,
  createManualChapterVersion,
  generateAiDraft,
  getChapter,
  listAdaptations,
  listChapterVersions,
  restoreChapterVersion,
} from "./workspace-api";

export type ChapterWorkspaceHandle = {
  flush: () => Promise<boolean>;
};

export type ChapterWorkspaceProps = {
  projectId: string;
  chapter: Chapter;
  bibleEntries: BibleEntry[];
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
  onChapterChanged: (chapter: Chapter) => void;
  onAdaptationCreated: (adaptation: Adaptation) => void;
};

type Operation = "snapshot" | "restore" | null;

const DRAWER_FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

function useResponsiveDrawerTrap({
  open,
  drawerRef,
  onEscape,
}: {
  open: boolean;
  drawerRef: React.RefObject<HTMLDivElement | null>;
  onEscape: () => void;
}) {
  React.useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(max-width: 1023px)");
    let cleanupTrap: (() => void) | null = null;

    const installTrap = () => {
      if (!media.matches || cleanupTrap) {
        return;
      }
      const previousActiveElement = document.activeElement as HTMLElement | null;
      const previousOverflow = document.body.style.overflow;
      const drawer = drawerRef.current;
      const firstFocusable = drawer?.querySelector<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR);
      firstFocusable?.focus();
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
          return;
        }
        if (event.key !== "Tab" || !drawer) {
          return;
        }
        const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR));
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
      document.addEventListener("keydown", onKeyDown);
      document.body.style.overflow = "hidden";
      cleanupTrap = () => {
        document.removeEventListener("keydown", onKeyDown);
        document.body.style.overflow = previousOverflow;
        previousActiveElement?.focus();
        cleanupTrap = null;
      };
    };

    const handleMediaChange = () => {
      if (media.matches) {
        installTrap();
      } else {
        cleanupTrap?.();
      }
    };

    media.addEventListener("change", handleMediaChange);
    handleMediaChange();
    return () => {
      media.removeEventListener("change", handleMediaChange);
      cleanupTrap?.();
    };
  }, [drawerRef, onEscape, open]);
}

function workspaceError(value: unknown, fallback: string) {
  return value instanceof WorkspaceApiError
    ? value
    : new WorkspaceApiError(0, { code: "INTERNAL_ERROR", message: fallback, retryable: true });
}

function formatVersionDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function versionExcerpt(value: string) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 140 ? `${singleLine.slice(0, 137)}...` : singleLine || "No body text";
}

function sortedOutlineNodes(nodes: OutlineNode[]) {
  return [...nodes].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

function versionsForChapter(versions: ChapterVersion[], chapterId: string) {
  return versions.filter((version) => version.chapterId === chapterId);
}

function statusTone(status: ChapterAutosaveState["status"]) {
  if (status === "saved") return "border-success/30 bg-success/10 text-success";
  if (status === "failed" || status === "conflict") return "border-danger/30 bg-danger/10 text-danger";
  if (status === "saving") return "border-line bg-surface-muted text-ink-muted";
  return "border-accent/30 bg-accent-soft text-accent-strong";
}

function LoadingState() {
  return (
    <section aria-label="Loading chapter" className="max-w-[780px] animate-pulse">
      <div className="h-3 w-28 rounded bg-surface-muted" />
      <div className="mt-5 h-10 w-3/4 rounded-lg bg-surface-muted" />
      <div className="mt-8 h-11 w-full rounded-lg bg-surface-muted" />
      <div className="mt-3 h-28 w-full rounded-lg bg-surface-muted" />
      <div className="mt-8 h-[52vh] min-h-[360px] w-full rounded-xl bg-surface-muted" />
    </section>
  );
}

function DraftFieldList({ draft, label }: { draft: ChapterDraft; label: string }) {
  return (
    <section aria-labelledby={`${label.toLowerCase().replace(/\s+/g, "-")}-draft-heading`} className="min-w-0">
      <h4 id={`${label.toLowerCase().replace(/\s+/g, "-")}-draft-heading`} className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{label}</h4>
      <dl className="mt-3 space-y-4 text-sm">
        <div>
          <dt className="text-xs font-semibold text-ink-faint">Title</dt>
          <dd className="mt-1 break-words text-ink">{draft.title || "Untitled"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-faint">Summary</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-ink-muted">{draft.summary || "No summary"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-faint">Body</dt>
          <dd className="mt-1 max-h-52 overflow-y-auto whitespace-pre-wrap break-words text-ink">{draft.body || "No body text"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-faint">Status</dt>
          <dd className="mt-1 text-ink">{draft.status}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-ink-faint">Outline link</dt>
          <dd className="mt-1 text-ink-muted">{draft.outlineNodeId ? "Linked to an outline node" : "Not linked"}</dd>
        </div>
      </dl>
    </section>
  );
}

function ConflictReview({
  state,
  onUseServer,
  onKeepLocal,
  onCopy,
  keepPending,
  copyError,
}: {
  state: ChapterAutosaveState;
  onUseServer: () => void;
  onKeepLocal: () => void;
  onCopy: () => void;
  keepPending: boolean;
  copyError: string | null;
}) {
  if (!state.serverChapter) {
    return null;
  }

  const localDraft = localConflictDraft(state.draft, state.recoveryDraft);
  const serverDraft = conflictDraftFor("server", state.draft, chapterDraftFromCanonical(state.serverChapter));

  return (
    <section aria-labelledby="chapter-conflict-heading" className="mt-8 border-y border-danger/30 bg-danger/5 px-4 py-5 sm:px-6">
      <div className="flex items-start gap-3">
        <WarningCircle size={20} weight="regular" className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div>
          <h2 id="chapter-conflict-heading" className="text-base font-semibold text-ink">Review the two chapter versions</h2>
          <p className="mt-1 max-w-[70ch] text-sm leading-6 text-ink-muted">Your local draft is kept. Review both complete versions before choosing which one should continue.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 border-t border-danger/20 pt-6 lg:grid-cols-2">
        <DraftFieldList draft={localDraft} label="Your draft" />
        <DraftFieldList draft={serverDraft} label="Server version" />
      </div>

      {state.error ? <p role="alert" className="mt-5 text-sm text-danger">{state.error.message}</p> : null}
      {copyError ? <p role="alert" className="mt-2 text-sm text-danger">{copyError}</p> : null}
      {keepPending ? <p role="status" aria-live="polite" className="mt-5 text-sm text-ink-muted">Creating a backup and saving your local draft.</p> : null}
      <div className="mt-6 flex flex-wrap gap-3 border-t border-danger/20 pt-5">
        <button type="button" onClick={onUseServer} disabled={keepPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60">
          <Check size={17} weight="regular" aria-hidden="true" /> Use server version
        </button>
        <button type="button" onClick={onKeepLocal} disabled={keepPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-4 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60">
          <ArrowCounterClockwise size={17} weight="regular" aria-hidden="true" /> {keepPending ? "Saving local draft" : "Keep my draft"}
        </button>
        <button type="button" onClick={onCopy} disabled={keepPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60">
          <Copy size={17} weight="regular" aria-hidden="true" /> Copy my draft
        </button>
      </div>
    </section>
  );
}

function HistoryPanel({
  versions,
  loading,
  error,
  operation,
  onRestore,
  onClose,
  onRetry,
  keepLocalPending,
  title = "History",
  headingId,
}: {
  versions: ChapterVersion[];
  loading: boolean;
  error: WorkspaceApiError | null;
  operation: Operation;
  onRestore: (version: ChapterVersion) => void;
  onClose?: () => void;
  onRetry?: () => void;
  keepLocalPending: boolean;
  title?: string;
  headingId?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-5 py-5">
        <div className="mt-2 flex items-center justify-between gap-3">
          <h2 id={headingId} className="text-lg font-semibold tracking-[-0.02em] text-ink">{title}</h2>
          {onClose ? <button type="button" onClick={onClose} aria-label="Close chapter history" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink"><X size={18} weight="regular" aria-hidden="true" /></button> : null}
        </div>
        <p className="mt-1 text-sm leading-5 text-ink-muted">Snapshots preserve a point in the manuscript.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {loading ? (
          <div role="status" aria-label="Loading chapter history" className="space-y-3">
            <div className="h-20 rounded-lg bg-surface-muted" />
            <div className="h-20 rounded-lg bg-surface-muted" />
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="space-y-3 text-sm leading-6 text-danger">
            <p>{error.message}</p>
            {onRetry ? <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-danger/30 px-3 font-semibold hover:bg-danger/10"><ArrowCounterClockwise size={16} weight="regular" aria-hidden="true" /> Retry</button> : null}
          </div>
        ) : null}
        {!loading && !error && versions.length === 0 ? (
          <div className="border-l-2 border-line pl-4">
            <p className="text-sm font-semibold text-ink">No snapshots yet</p>
            <p className="mt-2 text-sm leading-6 text-ink-muted">Create a manual snapshot before a major revision.</p>
          </div>
        ) : null}
        {!loading && !error && versions.length > 0 ? (
          <ol className="space-y-5">
            {versions.map((version) => (
              <li key={version.id} className="border-b border-line pb-5 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{chapterVersionSourceLabel(version.source)}</p>
                    <p className="mt-1 text-xs text-ink-faint">{formatVersionDate(version.createdAt)}</p>
                  </div>
                  <button type="button" onClick={() => onRestore(version)} disabled={operation !== null || keepLocalPending} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Restore ${chapterVersionSourceLabel(version.source)} from ${formatVersionDate(version.createdAt)}`}>
                    <ArrowCounterClockwise size={17} weight="regular" aria-hidden="true" />
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink-muted">{versionExcerpt(version.body)}</p>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

export const ChapterWorkspace = React.forwardRef<ChapterWorkspaceHandle, ChapterWorkspaceProps>(function ChapterWorkspace({
  projectId,
  chapter,
  bibleEntries,
  outlineNodes,
  chapters,
  onChapterChanged,
  onAdaptationCreated,
}, ref) {
  const autosave = useChapterAutosave({ projectId, chapter, onChapterChanged });
  const [historyResult, setHistoryResult] = React.useState<{
    chapterId: string;
    loading: boolean;
    versions: ChapterVersion[];
    error: WorkspaceApiError | null;
  }>({ chapterId: "", loading: true, versions: [], error: null });
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyRetryKey, setHistoryRetryKey] = React.useState(0);
  const [operation, setOperation] = React.useState<Operation>(null);
  const [keepLocalPending, setKeepLocalPending] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<WorkspaceApiError | null>(null);
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const historyDrawerRef = React.useRef<HTMLDivElement>(null);
  const aiDrawerRef = React.useRef<HTMLDivElement>(null);
  const operationRef = React.useRef<Operation>(null);
  const keepLocalPendingRef = React.useRef(false);
  const aiAcceptPendingRef = React.useRef(false);
  const adaptationSavePendingRef = React.useRef(false);
  const autosaveFlush = autosave.flush;
  const bodyTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const bodyEditorTouchedRef = React.useRef(false);
  const aiAbortRef = React.useRef<AbortController | null>(null);
  const aiCurrentSelectionRef = React.useRef<AiSelectionSnapshot | null>(null);
  const aiGenerationSelectionRef = React.useRef<AiSelectionSnapshot | null>(null);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiAction, setAiAction] = React.useState<AiAction>("brainstorm");
  const [aiInstruction, setAiInstruction] = React.useState("");
  const [aiContext, setAiContext] = React.useState<AiContext>({ bibleEntryIds: [], outlineNodeIds: [], chapterIds: [] });
  const [aiResult, setAiResult] = React.useState<AiGenerateResponse | null>(null);
  const [aiStatus, setAiStatus] = React.useState<AiAssistantStatus>("idle");
  const [aiError, setAiError] = React.useState<WorkspaceApiError | null>(null);
  const [aiCurrentSelection, setAiCurrentSelection] = React.useState<AiSelectionSnapshot | null>(null);
  const [aiSelection, setAiSelection] = React.useState<AiSelectionSnapshot | null>(null);
  const [aiAcceptPending, setAiAcceptPending] = React.useState(false);
  const [adaptationSavePending, setAdaptationSavePending] = React.useState(false);
  const [adaptationSaved, setAdaptationSaved] = React.useState(false);

  const guardedFlush = React.useCallback(() => {
    if (operationRef.current !== null || keepLocalPendingRef.current || aiAcceptPendingRef.current || adaptationSavePendingRef.current) {
      return Promise.resolve(false);
    }
    return autosaveFlush();
  }, [autosaveFlush]);

  const resetOperation = React.useCallback(() => {
    operationRef.current = null;
    setOperation(null);
  }, []);

  React.useImperativeHandle(ref, () => ({ flush: guardedFlush }), [guardedFlush]);

  function captureCurrentSelection() {
    const textarea = bodyTextareaRef.current;
    const current = autosave.getState();
    if (!textarea || !current) {
      return null;
    }
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const snapshot: AiSelectionSnapshot = {
      start,
      end,
      text: current.draft.body.slice(start, end),
      editSequence: current.editSequence,
    };
    aiCurrentSelectionRef.current = snapshot;
    setAiCurrentSelection(snapshot);
    return snapshot;
  }

  function handleAiContextToggle(group: keyof AiContext, id: string, checked: boolean) {
    if (aiStatus === "generating" || aiStatus === "accepting") {
      return;
    }
    setAiContext((current) => {
      const nextIds = checked
        ? [...current[group], id]
        : current[group].filter((item) => item !== id);
      return { ...current, [group]: nextIds } as AiContext;
    });
  }

  async function handleAiGenerate() {
    const currentState = autosave.getState();
    if (
      aiStatus === "generating" ||
      aiStatus === "accepting" ||
      operationRef.current !== null ||
      keepLocalPendingRef.current ||
      aiAcceptPendingRef.current ||
      adaptationSavePendingRef.current ||
      currentState?.status === "conflict"
    ) {
      return;
    }
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const capturedSelection = captureCurrentSelection();
    setAiStatus("generating");
    setAiError(null);
    setAdaptationSaved(false);
    try {
      const flushed = await autosave.flush();
      if (!flushed) {
        setAiError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Save the chapter before generating a draft.", retryable: false }));
        setAiStatus("error");
        return;
      }
      if (controller.signal.aborted) {
        return;
      }
      const response = await generateAiDraft({
        projectId,
        targetChapterId: chapter.id,
        action: aiAction,
        instruction: aiInstruction,
        context: aiContext,
        selectedProse: capturedSelection?.text || undefined,
      }, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setAiResult(response);
      const generationSelection = capturedSelection ? { ...capturedSelection } : null;
      aiGenerationSelectionRef.current = generationSelection;
      setAiSelection(generationSelection);
      setAiStatus("idle");
      setAiError(null);
    } catch (value) {
      const error = workspaceError(value, "The AI draft could not be generated. Try again.");
      if (error.code === "AI_CANCELLED") {
        setAiStatus("idle");
        return;
      }
      setAiError(error);
      setAiStatus("error");
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
      }
    }
  }

  function handleAiCancel() {
    aiAbortRef.current?.abort();
    setAiStatus("idle");
    setAiError(null);
  }

  async function handleSaveAdaptation() {
    const result = aiResult;
    if (
      !result
      || result.generation.action !== "adapt"
      || adaptationSavePendingRef.current
      || aiAcceptPendingRef.current
      || operationRef.current !== null
      || keepLocalPendingRef.current
      || result.generation.acceptedVersionId !== null
      || adaptationSaved
    ) {
      return;
    }

    adaptationSavePendingRef.current = true;
    setAdaptationSavePending(true);
    setAiError(null);
    try {
      const flushed = await autosave.flush();
      if (!flushed) {
        setAiError(new WorkspaceApiError(409, {
          code: "EDIT_CONFLICT",
          message: "Save the chapter before saving this adaptation.",
          retryable: false,
        }));
        return;
      }

      const latest = autosave.getState();
      const title = (latest?.draft.title.trim() || chapter.title.trim() || "Untitled adaptation").slice(0, 160);
      try {
        const created = await createAiAdaptation(projectId, {
          origin: "ai",
          format: "screenplay_scene",
          title,
          generationId: result.generation.id,
        });
        setAdaptationSaved(true);
        setNotice("AI draft saved as an adaptation.");
        onAdaptationCreated(created);
        return;
      } catch (value) {
        const error = workspaceError(value, "The adaptation could not be saved. Try again.");
        if (error.code === "AI_GENERATION_ALREADY_CONSUMED" && error.consumedBy === "chapter") {
          setAiError(new WorkspaceApiError(error.status, {
            code: error.code,
            message: "This AI draft was already accepted into the chapter. It cannot also become an adaptation.",
            retryable: false,
            consumedBy: "chapter",
            details: error.details,
          }));
          return;
        }

        const currentAdaptation = error.currentAdaptation?.sourceGenerationId === result.generation.id
          ? error.currentAdaptation
          : null;
        const canonical = currentAdaptation ?? await (async () => {
          try {
            const records = await listAdaptations(projectId);
            return records.find((adaptation) => adaptation.sourceGenerationId === result.generation.id) ?? null;
          } catch {
            return null;
          }
        })();
        if (canonical) {
          setAdaptationSaved(true);
          setNotice("AI draft was already saved as an adaptation. The existing draft is open.");
          onAdaptationCreated(canonical);
          return;
        }
        throw error;
      }
    } catch (value) {
      setAiError(workspaceError(value, "The adaptation could not be saved. Try again."));
    } finally {
      adaptationSavePendingRef.current = false;
      setAdaptationSavePending(false);
    }
  }

  const requestAiClose = React.useCallback(() => {
    if (aiAcceptPendingRef.current || adaptationSavePendingRef.current) {
      return;
    }
    setAiOpen(false);
  }, []);

  function handleAiInsert() {
    const current = autosave.getState();
    const caret = resolveInsertCaret(
      current?.draft.body.length ?? 0,
      bodyTextareaRef.current?.selectionStart,
      bodyEditorTouchedRef.current,
    );
    void handleAiAccept("insert", caret);
  }

  function handleAiReplace() {
    void handleAiAccept("replace");
  }

  async function refreshChapterHistory() {
    try {
      const records = await listChapterVersions(chapter.id);
      setHistoryResult((current) => ({
        chapterId: chapter.id,
        loading: false,
        versions: mergeChapterVersions(
          records.filter((record) => record.chapterId === chapter.id),
          versionsForChapter(current.versions, chapter.id),
        ),
        error: null,
      }));
    } catch (value) {
      setHistoryResult((current) => ({
        chapterId: chapter.id,
        loading: false,
        versions: versionsForChapter(current.versions, chapter.id),
        error: workspaceError(value, "Chapter history could not be refreshed. Try again."),
      }));
    }
  }

  async function reconcileLostAiAcceptance(submittedBody: string, localDraft: ChapterDraft) {
    let canonical: Chapter;
    try {
      canonical = await getChapter(chapter.id);
    } catch (value) {
      const error = workspaceError(value, "The AI acceptance may have completed. Reload the chapter before trying again.");
      setAiError(new WorkspaceApiError(error.status, {
        code: "AI_ACCEPT_RECONCILIATION_FAILED",
        message: "The AI acceptance may have completed. Reload the chapter before trying again.",
        retryable: true,
        details: { cause: error.details, originalCode: error.code },
      }));
      setAiStatus("error");
      return;
    }

    await refreshChapterHistory();
    // Only apply a canonical chapter as a successful reconciliation when its
    // body is exactly the body submitted by this acceptance attempt. If the
    // server has a different body, keep the local pre-acceptance draft alive
    // so the autosave conflict surface can present both versions.
    const applied = canonical.body === submittedBody
      ? autosave.applyCanonicalChapter(canonical)
      : false;
    if (canApplyCanonicalAiAcceptance(canonical.body, submittedBody, applied)) {
      setAiError(null);
      setNotice("This AI draft was already accepted. The canonical chapter is loaded.");
      setAiStatus("accepted");
      return;
    }

    autosave.reportExternalConflict(canonical, localDraft);
    setAiError(new WorkspaceApiError(409, {
      code: "AI_GENERATION_ALREADY_ACCEPTED",
      message: "This AI draft was already accepted. Review the canonical chapter and your draft.",
      retryable: false,
      currentChapter: canonical,
    }));
    setAiStatus("accepted");
  }

  async function handleAiAccept(mode: AiAcceptMode, insertionCaret?: number) {
    const result = aiResult;
    const currentState = autosave.getState();
    if (
      !result ||
      aiAcceptPendingRef.current ||
      adaptationSavePendingRef.current ||
      operationRef.current !== null ||
      keepLocalPendingRef.current ||
      currentState?.status === "conflict" ||
      result.generation.acceptedVersionId !== null
    ) {
      return;
    }
    aiAcceptPendingRef.current = true;
    setAiAcceptPending(true);
    setAiStatus("accepting");
    setAiError(null);
    let localDraft: ChapterDraft | null = null;
    let submittedBody: string | null = null;
    try {
      const flushed = await autosave.flush();
      if (!flushed) {
        setAiError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Save the chapter before accepting this draft.", retryable: false }));
        setAiStatus("error");
        return;
      }
      const current = autosave.getState();
      if (!current || current.status !== "saved") {
        setAiError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "The chapter is not ready for acceptance. Review the current save state.", retryable: false }));
        setAiStatus("error");
        return;
      }
      const preAcceptanceDraft = { ...current.draft };
      const caret = insertionCaret ?? current.draft.body.length;
      const selection = aiGenerationSelectionRef.current;
      const body = composeAiBody(current.draft.body, result.generation.generatedMarkdown, mode, selection, caret, current.editSequence);
      if (body === null) {
        setAiError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "The captured selection changed. Select the text again before accepting a replacement.", retryable: false }));
        setAiStatus("error");
        return;
      }
      if (body.length > CHAPTER_BODY_MAX_LENGTH) {
        setAiError(new WorkspaceApiError(400, {
          code: "AI_BODY_TOO_LONG",
          message: `The accepted chapter would exceed ${CHAPTER_BODY_MAX_LENGTH} characters. Shorten the draft or remove manuscript text before trying again.`,
          retryable: false,
        }));
        setAiStatus("error");
        return;
      }
      localDraft = preAcceptanceDraft;
      submittedBody = body;
      const accepted = await acceptAiDraft(chapter.id, {
        generationId: result.generation.id,
        body,
        baseUpdatedAt: current.acknowledgedUpdatedAt,
      });
      setHistoryResult((history) => ({
        chapterId: chapter.id,
        loading: false,
        versions: mergeChapterVersions(versionsForChapter(history.versions, chapter.id), [accepted.version]),
        error: null,
      }));
      setAiResult({ ...result, generation: accepted.generation });
      if (!autosave.applyCanonicalChapter(accepted.chapter)) {
        autosave.reportExternalConflict(accepted.chapter, preAcceptanceDraft);
        setAiError(new WorkspaceApiError(409, { code: "AI_GENERATION_ACCEPTED", message: "The AI draft was accepted on the server. Review the canonical chapter before continuing.", retryable: false, currentChapter: accepted.chapter }));
        setAiStatus("accepted");
        return;
      }
      setAiStatus("accepted");
    } catch (value) {
      const error = workspaceError(value, "The AI draft could not be accepted. Your manuscript is unchanged.");
      if (error.code === "AI_GENERATION_ALREADY_ACCEPTED" && submittedBody && localDraft) {
        await reconcileLostAiAcceptance(submittedBody, localDraft);
        return;
      }
      if (error.code === "AI_GENERATION_ALREADY_CONSUMED" && error.consumedBy === "adaptation") {
        setAiError(new WorkspaceApiError(error.status, {
          code: error.code,
          message: "This AI draft is already saved as an adaptation. Open it from Adaptations instead of inserting it into the chapter.",
          retryable: false,
          consumedBy: "adaptation",
          currentAdaptation: error.currentAdaptation ?? undefined,
          details: error.details,
        }));
        setAiStatus("error");
        return;
      }
      if (error.code === "EDIT_CONFLICT" && error.currentChapter && localDraft) {
        autosave.reportExternalConflict(error.currentChapter, localDraft);
      }
      setAiError(error);
      setAiStatus("error");
    } finally {
      aiAcceptPendingRef.current = false;
      setAiAcceptPending(false);
    }
  }

  async function handleAiCopy() {
    if (!aiResult) {
      return;
    }
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard is unavailable");
      }
      await navigator.clipboard.writeText(aiResult.generation.generatedMarkdown);
    } catch {
      setAiError(new WorkspaceApiError(0, { code: "COPY_FAILED", message: "Copy failed. Select the draft text and copy it manually.", retryable: false }));
    }
  }

  function handleAiDismiss() {
    if (aiAcceptPendingRef.current || adaptationSavePendingRef.current) {
      return;
    }
    setAiResult(null);
    aiGenerationSelectionRef.current = null;
    setAiSelection(null);
    setAiError(null);
    setAiStatus("idle");
    setAdaptationSaved(false);
  }

  React.useEffect(() => {
    let active = true;
    void listChapterVersions(chapter.id)
      .then((records) => {
        if (active) {
          setHistoryResult((current) => ({
            chapterId: chapter.id,
            loading: false,
            versions: mergeChapterVersions(
              records.filter((record) => record.chapterId === chapter.id),
              versionsForChapter(current.versions, chapter.id),
            ),
            error: null,
          }));
        }
      })
      .catch((value: unknown) => {
        if (active) {
          setHistoryResult((current) => ({
            chapterId: chapter.id,
            loading: false,
            versions: versionsForChapter(current.versions, chapter.id),
            error: workspaceError(value, "Chapter history could not be loaded. Try again."),
          }));
        }
      })
    return () => {
      active = false;
    };
  }, [chapter.id, historyRetryKey]);

  React.useEffect(() => () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
  }, []);

  const closeHistory = React.useCallback(() => {
    setHistoryOpen(false);
  }, []);
  useResponsiveDrawerTrap({ open: historyOpen, drawerRef: historyDrawerRef, onEscape: closeHistory });
  useResponsiveDrawerTrap({ open: aiOpen, drawerRef: aiDrawerRef, onEscape: requestAiClose });

  function edit(field: keyof ChapterDraft, value: string | null) {
    if (aiAcceptPendingRef.current) {
      return;
    }
    autosave.edit({ [field]: value } as Partial<ChapterDraft>);
    setNotice(null);
    setActionError(null);
    setCopyError(null);
  }

  async function handleSnapshot() {
    if (operationRef.current !== null || keepLocalPendingRef.current || aiAcceptPendingRef.current) {
      return;
    }
    operationRef.current = "snapshot";
    setOperation("snapshot");
    setActionError(null);
    setNotice(null);
    try {
      const flushed = await autosave.flush();
      if (!flushed) {
        setActionError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Save the current draft before creating a snapshot.", retryable: false }));
        return;
      }
      const version = await createManualChapterVersion(chapter.id);
      setHistoryResult((current) => ({
        chapterId: chapter.id,
        loading: false,
        versions: mergeChapterVersions(versionsForChapter(current.versions, chapter.id), [version]),
        error: null,
      }));
      setNotice("Snapshot saved.");
    } catch (value) {
      setActionError(workspaceError(value, "The snapshot could not be created. Try again."));
    } finally {
      resetOperation();
    }
  }

  async function handleRestore(version: ChapterVersion) {
    if (operationRef.current !== null || keepLocalPendingRef.current || aiAcceptPendingRef.current) {
      return;
    }
    operationRef.current = "restore";
    setOperation("restore");
    setActionError(null);
    setNotice(null);
    try {
      const flushed = await autosave.flush();
      if (!flushed) {
        setActionError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Save the current draft before restoring a version.", retryable: false }));
        return;
      }
      if (typeof window !== "undefined" && !window.confirm("Restore this version? A backup of the current body will be kept.")) {
        return;
      }
      const currentState = autosave.getState();
      if (!currentState || currentState.status !== "saved") {
        setActionError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "The chapter changed while restore was waiting. Try again.", retryable: false }));
        return;
      }
      const result = await restoreChapterVersion(chapter.id, {
        versionId: version.id,
        baseUpdatedAt: currentState.acknowledgedUpdatedAt,
      });
      if (!autosave.applyCanonicalChapter(result.chapter)) {
        setActionError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "The chapter changed before the restored version could be applied. Try again.", retryable: false }));
        return;
      }
      setHistoryResult((current) => ({
        chapterId: chapter.id,
        loading: false,
        versions: mergeChapterVersions(versionsForChapter(current.versions, chapter.id), [result.backupVersion, result.restoredVersion]),
        error: null,
      }));
      setNotice("Version restored. The previous body is kept as a backup.");
    } catch (value) {
      setActionError(workspaceError(value, "The version could not be restored. Your draft is still here."));
    } finally {
      resetOperation();
    }
  }

  function handleUseServer() {
    setActionError(null);
    setNotice(null);
    if (!autosave.useServerVersion()) {
      setActionError(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "The server version is no longer available. Try again.", retryable: false }));
    } else {
      setNotice("Server version selected.");
    }
  }

  async function handleKeepLocal() {
    if (keepLocalPendingRef.current || operationRef.current !== null || aiAcceptPendingRef.current) {
      return;
    }
    setActionError(null);
    setNotice(null);
    keepLocalPendingRef.current = true;
    setKeepLocalPending(true);
    try {
      const kept = await autosave.keepMyDraft();
      if (kept) {
        setNotice("Your draft is saved.");
      } else if (autosave.getState()?.error) {
        setActionError(autosave.getState()?.error ?? null);
      }
    } finally {
      keepLocalPendingRef.current = false;
      setKeepLocalPending(false);
    }
  }

  async function handleCopy() {
    setCopyError(null);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard is unavailable");
      }
      const currentState = autosave.getState();
      await navigator.clipboard.writeText(localConflictDraft(currentState?.draft ?? chapterDraftFromCanonical(chapter), currentState?.recoveryDraft ?? null).body);
      setNotice("Draft copied.");
    } catch {
      setCopyError("Copy failed. Select the body text and copy it manually.");
    }
  }

  if (autosave.loading || !autosave.state) {
    return <LoadingState />;
  }

  const state = autosave.state;
  const outlineOptions = sortedOutlineNodes(outlineNodes);
  const actionBusy = operation !== null;
  const historyLoading = historyResult.chapterId !== chapter.id || historyResult.loading;
  const versions = historyResult.chapterId === chapter.id ? historyResult.versions : [];
  const historyError = historyResult.chapterId === chapter.id ? historyResult.error : null;
  const aiReplaceSelectionEnabled = selectionStillMatches(state.draft.body, state.editSequence, aiSelection);
  const aiSelectedProseIncluded = Boolean(aiCurrentSelection?.text);
  function retryHistory() {
    setHistoryResult((current) => ({ ...current, loading: true, error: null }));
    setHistoryRetryKey((current) => current + 1);
  }

  function renderAiAssistant(onClose?: () => void) {
    return (
      <AiAssistant
        action={aiAction}
        instruction={aiInstruction}
        context={aiContext}
        bibleEntries={bibleEntries}
        outlineNodes={outlineNodes}
        chapters={chapters}
        result={aiResult}
        status={aiStatus}
        error={aiError}
        selectedProseIncluded={aiSelectedProseIncluded}
        replaceSelectionEnabled={aiReplaceSelectionEnabled}
        onActionChange={setAiAction}
        onInstructionChange={setAiInstruction}
        onContextToggle={handleAiContextToggle}
        onGenerate={() => { void handleAiGenerate(); }}
        onCancel={handleAiCancel}
        onInsert={handleAiInsert}
        onReplace={handleAiReplace}
        onCopy={() => { void handleAiCopy(); }}
        onDismiss={handleAiDismiss}
        onSaveAdaptation={() => { void handleSaveAdaptation(); }}
        adaptationSavePending={adaptationSavePending}
        adaptationSaved={adaptationSaved}
        onClose={onClose}
        closeDisabled={aiAcceptPending || adaptationSavePending}
      />
    );
  }

  return (
    <>
      <div className="flex min-w-0 gap-8">
        <section aria-labelledby="chapter-workspace-heading" className="min-w-0 flex-1">
          <header className="border-b border-line pb-6">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-ink-faint"><FloppyDisk size={18} weight="regular" aria-hidden="true" /> Chapter editor</div>
                <h2 id="chapter-workspace-heading" className="mt-3 max-w-[30ch] text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">Chapter draft</h2>
                <p className="mt-3 max-w-[62ch] text-sm leading-6 text-ink-muted">Plain Markdown is preserved while autosave keeps the latest complete draft.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span aria-live="polite" className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${statusTone(state.status)}`}>
                  {state.status === "saved" ? <Check size={15} weight="regular" aria-hidden="true" /> : null}
                  {chapterStatusLabel(state.status)}
                </span>
                <button type="button" onClick={() => { setHistoryOpen(true); setAiOpen(false); }} disabled={aiAcceptPending || adaptationSavePending} aria-expanded={historyOpen} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 text-sm font-semibold text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">
                  <ClockCounterClockwise size={18} weight="regular" aria-hidden="true" /> History
                </button>
                <button type="button" onClick={() => { setAiOpen(true); setHistoryOpen(false); }} disabled={aiAcceptPending || adaptationSavePending} aria-expanded={aiOpen} aria-label="Open AI assist" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 text-sm font-semibold text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">
                  AI assist
                </button>
              </div>
            </div>
          </header>

          {state.recoverySource === "session" && state.status === "dirty" ? <p role="status" className="mt-5 border-l-2 border-accent pl-3 text-sm leading-6 text-ink-muted">A local draft was recovered for this chapter. It will save after you pause.</p> : null}
          {state.error && state.status === "failed" ? (
            <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-l-2 border-danger pl-3 text-sm text-danger">
              <span>{state.error.message}</span>
              <button type="button" onClick={() => { void autosave.retry(); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-danger/30 px-3 font-semibold transition-colors hover:bg-danger/10"><ArrowCounterClockwise size={16} weight="regular" aria-hidden="true" /> Retry</button>
            </div>
          ) : null}
          {notice ? <p aria-live="polite" className="mt-5 border-l-2 border-success pl-3 text-sm text-success">{notice}</p> : null}
          {actionError ? <p role="alert" className="mt-5 border-l-2 border-danger pl-3 text-sm text-danger">{actionError.message}</p> : null}

          {state.serverChapter ? (
            <ConflictReview state={state} onUseServer={handleUseServer} onKeepLocal={() => { void handleKeepLocal(); }} onCopy={() => { void handleCopy(); }} keepPending={keepLocalPending || actionBusy} copyError={copyError} />
          ) : (
          <div className="mt-8 max-w-[780px]">
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)]">
              <div>
                <label htmlFor="chapter-title" className="text-sm font-semibold text-ink">Title</label>
                <input id="chapter-title" value={state.draft.title} disabled={aiAcceptPending} onChange={(event) => edit("title", event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-base text-ink shadow-sm transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" />
              </div>
              <div>
                <label htmlFor="chapter-status" className="text-sm font-semibold text-ink">Status</label>
                <select id="chapter-status" value={state.draft.status} disabled={aiAcceptPending} onChange={(event) => edit("status", event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60">
                  <option value="planned">Planned</option>
                  <option value="draft">Draft</option>
                  <option value="revised">Revised</option>
                  <option value="final">Final</option>
                </select>
              </div>
            </div>

            <div className="mt-5">
              <label htmlFor="chapter-summary" className="text-sm font-semibold text-ink">Summary</label>
              <textarea id="chapter-summary" value={state.draft.summary} disabled={aiAcceptPending} onChange={(event) => edit("summary", event.target.value)} rows={3} className="mt-2 min-h-20 w-full resize-y rounded-lg border border-line bg-surface-raised px-3 py-3 text-sm leading-6 text-ink shadow-sm transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" />
            </div>

            <div className="mt-5">
              <label htmlFor="chapter-outline" className="text-sm font-semibold text-ink">Outline link</label>
              <select id="chapter-outline" value={state.draft.outlineNodeId ?? ""} disabled={aiAcceptPending} onChange={(event) => edit("outlineNodeId", event.target.value || null)} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink shadow-sm transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60">
                <option value="">Not linked</option>
                {outlineOptions.map((node) => <option key={node.id} value={node.id}>{node.title} ({node.kind})</option>)}
              </select>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-line py-4">
              <p className="text-xs leading-5 text-ink-faint">Autosave keeps the latest complete draft. Manual snapshots appear in History.</p>
              <button type="button" onClick={() => { void handleSnapshot(); }} disabled={actionBusy || keepLocalPending || aiAcceptPending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-4 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">
                <FloppyDisk size={17} weight="regular" aria-hidden="true" /> {operation === "snapshot" ? "Saving snapshot" : "Save snapshot"}
              </button>
            </div>

            <div className="mt-8 max-w-[78ch]">
              <label htmlFor="chapter-body" className="text-sm font-semibold text-ink">Markdown body</label>
              <textarea id="chapter-body" ref={bodyTextareaRef} value={state.draft.body} disabled={aiAcceptPending} onFocus={() => { bodyEditorTouchedRef.current = true; }} onSelect={() => { captureCurrentSelection(); }} onChange={(event) => edit("body", event.target.value)} spellCheck={true} className="mt-2 min-h-[min(62vh,720px)] w-full resize-y rounded-xl border border-line bg-surface-raised px-4 py-4 text-[1.02rem] leading-8 text-ink shadow-sm transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" />
              <p className="mt-2 text-xs text-ink-faint">Plain Markdown is preserved as you write.</p>
            </div>
          </div>
          )}
        </section>

        {historyOpen ? (
          <aside aria-label="Chapter history" className="hidden w-[340px] shrink-0 border-l border-line bg-surface lg:flex">
            <HistoryPanel versions={versions} loading={historyLoading} error={historyError} operation={operation} keepLocalPending={keepLocalPending || aiAcceptPending} onRestore={(version) => { void handleRestore(version); }} onClose={() => setHistoryOpen(false)} onRetry={retryHistory} />
          </aside>
        ) : null}
        {aiOpen ? (
          <aside aria-label="AI assist" className="hidden w-[350px] shrink-0 border-l border-line bg-surface lg:flex">
            {renderAiAssistant(requestAiClose)}
          </aside>
        ) : null}
      </div>

      {historyOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close chapter history" onClick={() => setHistoryOpen(false)} className="absolute inset-0 bg-ink/35" />
          <div id="chapter-history-drawer" ref={historyDrawerRef} role="dialog" aria-modal="true" aria-labelledby="chapter-history-drawer-heading" className="relative ml-auto flex h-full w-[min(92vw,380px)] flex-col bg-surface shadow-xl">
            <HistoryPanel title="Chapter history" headingId="chapter-history-drawer-heading" versions={versions} loading={historyLoading} error={historyError} operation={operation} keepLocalPending={keepLocalPending || aiAcceptPending} onRestore={(version) => { void handleRestore(version); }} onClose={() => setHistoryOpen(false)} onRetry={retryHistory} />
          </div>
        </div>
      ) : null}

      {aiOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close AI assist" onClick={requestAiClose} disabled={aiAcceptPending} className="absolute inset-0 bg-ink/35 disabled:cursor-default" />
          <div ref={aiDrawerRef} role="dialog" aria-modal="true" aria-label="AI assist" className="relative ml-auto flex h-full w-[min(94vw,420px)] flex-col bg-surface shadow-xl">
            {renderAiAssistant(requestAiClose)}
          </div>
        </div>
      ) : null}
    </>
  );
});

ChapterWorkspace.displayName = "ChapterWorkspace";
