"use client";

import { Trash, X } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { StudioEntity, StudioScene, StudioStoryTree } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import {
  createStudioChapter,
  createStudioScene,
  createStudioVolume,
  deleteStudioChapter,
  deleteStudioScene,
  deleteStudioVolume,
  firstStorySelection,
  getStudioScene,
  getStudioTree,
  listStudioEntities,
  readConflictScene,
  sceneDraftFrom,
  sceneDraftsEqual,
  storySelectionExists,
  StudioRequestError,
  updateStudioScene,
  type SceneDraft,
  type ScenePath,
  type StorySelection,
} from "./api";
import { ConflictBanner } from "./ConflictBanner";
import { PasteParsePanel } from "./PasteParsePanel";
import { ShotBoard } from "./ShotBoard";
import { useDebouncedSave } from "./useDebouncedSave";

const fieldClassName =
  "w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15";

const emptyDraft: SceneDraft = { title: "", script: "", intent: "" };

type DeleteTarget =
  | { kind: "volume"; volumeId: string; title: string }
  | { kind: "chapter"; volumeId: string; chapterId: string; title: string }
  | { kind: "scene"; volumeId: string; chapterId: string; sceneId: string; title: string };

export function StoryPanel({
  projectId,
  flushRef,
  active,
  onParseBusyChange,
}: {
  projectId: string;
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  active: boolean;
  onParseBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [tree, setTree] = useState<StudioStoryTree | null>(null);
  const [treeError, setTreeError] = useState("");
  const [selected, setSelected] = useState<StorySelection | null>(null);
  const [mutating, setMutating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const editorFlushRef = useRef<(() => Promise<boolean>) | null>(null);

  const flush = useCallback(async () => {
    if (!editorFlushRef.current) {
      return true;
    }
    return editorFlushRef.current();
  }, []);

  useEffect(() => {
    if (!active) return;
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) {
        flushRef.current = null;
      }
    };
  }, [active, flush, flushRef]);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void getStudioTree(projectId)
        .then((nextTree) => {
          if (cancelled) {
            return;
          }
          setTree(nextTree);
          setSelected((current) => {
            if (current && storySelectionExists(nextTree, current)) {
              return current;
            }
            return firstStorySelection(nextTree);
          });
        })
        .catch((error) => {
          if (!cancelled) {
            setTreeError(error instanceof Error ? error.message : t("The workspace could not be loaded."));
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [projectId, t]);

  async function selectNode(next: StorySelection) {
    if (selected && sameSelection(selected, next)) {
      return;
    }
    const ok = await flush();
    if (!ok) {
      return;
    }
    setSelected(next);
  }

  async function refreshTree(preferred?: StorySelection | null) {
    const nextTree = await getStudioTree(projectId);
    setTree(nextTree);
    setSelected((current) => {
      if (preferred && storySelectionExists(nextTree, preferred)) {
        return preferred;
      }
      if (current && storySelectionExists(nextTree, current)) {
        return current;
      }
      return firstStorySelection(nextTree);
    });
  }

  async function addVolume() {
    setMutating(true);
    try {
      await createStudioVolume(projectId);
      await refreshTree(selected);
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : t("The request could not be completed."));
    } finally {
      setMutating(false);
    }
  }

  async function addChapter() {
    const volumeId = selected?.volumeId ?? tree?.volumes[0]?.id;
    if (!volumeId) {
      return;
    }
    setMutating(true);
    try {
      await createStudioChapter(projectId, volumeId);
      await refreshTree(selected);
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : t("The request could not be completed."));
    } finally {
      setMutating(false);
    }
  }

  async function addScene() {
    if (!selected || selected.kind === "volume") {
      return;
    }
    const { volumeId, chapterId } = selected;
    setMutating(true);
    try {
      const created = await createStudioScene(projectId, volumeId, chapterId);
      const next: StorySelection = { kind: "scene", volumeId, chapterId, sceneId: created.id };
      const ok = await flush();
      if (!ok) {
        await refreshTree(selected);
        return;
      }
      await refreshTree(next);
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : t("The request could not be completed."));
    } finally {
      setMutating(false);
    }
  }

  function openDelete(target: DeleteTarget) {
    setTreeError("");
    setDeleteTarget(target);
  }

  function closeDeleteDialog() {
    if (mutating) {
      return;
    }
    setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    setMutating(true);
    try {
      if (!shouldSkipFlushForDelete(selected, deleteTarget)) {
        const ok = await flush();
        if (!ok) {
          return;
        }
      }

      if (deleteTarget.kind === "volume") {
        await deleteStudioVolume(projectId, deleteTarget.volumeId);
      } else if (deleteTarget.kind === "chapter") {
        await deleteStudioChapter(projectId, deleteTarget.volumeId, deleteTarget.chapterId);
      } else {
        await deleteStudioScene(
          projectId,
          deleteTarget.volumeId,
          deleteTarget.chapterId,
          deleteTarget.sceneId,
        );
      }

      setDeleteTarget(null);
      setTreeError("");
      await refreshTree();
    } catch (error) {
      setTreeError(error instanceof Error ? error.message : t("The request could not be completed."));
    } finally {
      setMutating(false);
    }
  }

  const parseTarget = parseTargetFromSelection(tree, selected);
  const hasVolume = Boolean(selected?.volumeId ?? tree?.volumes[0]);
  const canAddScene = selected !== null && selected.kind !== "volume";
  const deleteDescription = deleteTarget
    ? deleteTarget.kind === "volume"
      ? t("This will permanently delete this volume, including its chapters, scenes, shots, generated images, and workflow nodes.")
      : deleteTarget.kind === "chapter"
        ? t("This will permanently delete this chapter, including its scenes, shots, generated images, and workflow nodes.")
        : t("This will permanently delete this scene, including its shots, generated images, and workflow nodes.")
    : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="flex min-h-0 flex-col border-b border-line bg-surface lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={() => void addVolume()}
            disabled={mutating}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {t("Add volume")}
          </button>
          <button
            type="button"
            onClick={() => void addChapter()}
            disabled={mutating || !hasVolume}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {t("Add chapter")}
          </button>
          <button
            type="button"
            onClick={() => void addScene()}
            disabled={mutating || !canAddScene}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {t("Add scene")}
          </button>
        </div>
        <PasteParsePanel
          projectId={projectId}
          targetVolumeId={parseTarget.volumeId}
          targetChapterId={parseTarget.chapterId}
          targetVolumeTitle={parseTarget.volumeTitle}
          targetChapterTitle={parseTarget.chapterTitle}
          onBeforeMutate={flush}
          onProjectRecordsChanged={() => refreshTree(selected)}
          onParseBusyChange={onParseBusyChange}
        />
        <nav aria-label={t("Story")} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {treeError ? <p role="alert" className="px-2 text-sm text-danger">{treeError}</p> : null}
          {tree ? (
            <ol className="space-y-3">
              {tree.volumes.map((volume) => {
                const volumeTitle = volume.title || volume.id;
                const volumeActive = selected?.kind === "volume" && selected.volumeId === volume.id;
                return (
                  <li key={volume.id}>
                    <div className={`flex min-w-0 items-stretch rounded-lg ${volumeActive ? "bg-accent-soft" : ""}`}>
                      <button
                        type="button"
                        onClick={() => void selectNode({ kind: "volume", volumeId: volume.id })}
                        aria-pressed={volumeActive}
                        disabled={mutating}
                        className={treeSelectButtonClass(volumeActive)}
                      >
                        <span className="truncate">{volumeTitle}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openDelete({ kind: "volume", volumeId: volume.id, title: volumeTitle })}
                        disabled={mutating}
                        aria-label={t("Delete {title}", { title: volumeTitle })}
                        className={treeDeleteButtonClass()}
                      >
                        <Trash size={14} weight="regular" aria-hidden="true" />
                      </button>
                    </div>
                    <ol className="mt-1 space-y-2">
                      {volume.chapters.map((chapter) => {
                        const chapterTitle = chapter.title || chapter.id;
                        const chapterActive =
                          selected?.kind === "chapter"
                          && selected.volumeId === volume.id
                          && selected.chapterId === chapter.id;
                        return (
                          <li key={chapter.id} className="pl-2">
                            <div className={`flex min-w-0 items-stretch rounded-lg ${chapterActive ? "bg-accent-soft" : ""}`}>
                              <button
                                type="button"
                                onClick={() => void selectNode({
                                  kind: "chapter",
                                  volumeId: volume.id,
                                  chapterId: chapter.id,
                                })}
                                aria-pressed={chapterActive}
                                disabled={mutating}
                                className={treeSelectButtonClass(chapterActive)}
                              >
                                <span className="truncate">{chapterTitle}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openDelete({
                                  kind: "chapter",
                                  volumeId: volume.id,
                                  chapterId: chapter.id,
                                  title: chapterTitle,
                                })}
                                disabled={mutating}
                                aria-label={t("Delete {title}", { title: chapterTitle })}
                                className={treeDeleteButtonClass()}
                              >
                                <Trash size={14} weight="regular" aria-hidden="true" />
                              </button>
                            </div>
                            <ol className="mt-1 space-y-1">
                              {chapter.scenes.map((item) => {
                                const sceneTitle = item.title || item.id;
                                const path: StorySelection = {
                                  kind: "scene",
                                  volumeId: volume.id,
                                  chapterId: chapter.id,
                                  sceneId: item.id,
                                };
                                const active = selected !== null && sameSelection(selected, path);
                                return (
                                  <li key={item.id} className="pl-2">
                                    <div className={`flex min-w-0 items-stretch rounded-lg ${active ? "bg-accent-soft" : ""}`}>
                                      <button
                                        type="button"
                                        onClick={() => void selectNode(path)}
                                        aria-pressed={active}
                                        disabled={mutating}
                                        className={treeSelectButtonClass(active)}
                                      >
                                        <span className="truncate">{sceneTitle}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openDelete({
                                          kind: "scene",
                                          volumeId: volume.id,
                                          chapterId: chapter.id,
                                          sceneId: item.id,
                                          title: sceneTitle,
                                        })}
                                        disabled={mutating}
                                        aria-label={t("Delete {title}", { title: sceneTitle })}
                                        className={treeDeleteButtonClass()}
                                      >
                                        <Trash size={14} weight="regular" aria-hidden="true" />
                                      </button>
                                    </div>
                                  </li>
                                );
                              })}
                            </ol>
                          </li>
                        );
                      })}
                    </ol>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="space-y-2 px-2">
              <div className="h-4 w-24 animate-pulse rounded bg-surface-muted" />
              <div className="h-8 animate-pulse rounded bg-surface-muted" />
            </div>
          )}
        </nav>
      </aside>

      {selected?.kind === "scene" ? (
        <SceneEditor
          key={`${selected.volumeId}/${selected.chapterId}/${selected.sceneId}`}
          projectId={projectId}
          path={selected}
          flushRef={editorFlushRef}
          onSaved={(saved) => {
            setTree((currentTree) => currentTree ? replaceSceneTitle(currentTree, selected, saved.title) : currentTree);
          }}
        />
      ) : (
        <section className="flex min-h-0 min-w-0 flex-1 items-start px-5 py-6 sm:px-8">
          {selected && tree ? (
            <div className="space-y-2">
              <h1 className="text-lg font-semibold text-ink">{selectionTitle(tree, selected)}</h1>
              <p className="text-sm text-ink-muted">{t("Select a scene or add one in this chapter.")}</p>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">{t("Select a scene")}</p>
          )}
        </section>
      )}

      {deleteTarget ? (
        <ConfirmDeleteDialog
          title={t("Delete {title}?", { title: deleteTarget.title })}
          description={deleteDescription}
          confirming={mutating}
          onClose={closeDeleteDialog}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}

function ConfirmDeleteDialog({
  title,
  description,
  confirming,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const focusableSelector =
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]";
    const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!confirming) {
          onClose();
        }
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
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
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [confirming, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid min-h-[100dvh] place-items-center bg-ink/45 px-4 py-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !confirming) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-story-delete-dialog-title"
        aria-describedby="studio-story-delete-dialog-description"
        className="w-full max-w-lg rounded-xl border border-line bg-surface-raised p-6 shadow-[0_24px_80px_rgb(12_20_26_/_22%)]"
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 id="studio-story-delete-dialog-title" className="text-xl font-semibold tracking-[-0.02em] text-ink">
              {title}
            </h2>
            <p
              id="studio-story-delete-dialog-description"
              className="mt-2 max-w-[44ch] text-sm leading-6 text-ink-muted"
            >
              {description}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("Close dialog")}
            onClick={onClose}
            disabled={confirming}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60"
          >
            <X size={20} weight="regular" />
          </button>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="min-h-11 rounded-lg bg-danger px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-danger/90 disabled:opacity-60"
          >
            {t("Delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function shouldSkipFlushForDelete(selected: StorySelection | null, target: DeleteTarget): boolean {
  if (!selected) {
    return true;
  }

  if (target.kind === "volume") {
    return selected.volumeId === target.volumeId;
  }

  if (target.kind === "chapter") {
    if (selected.volumeId !== target.volumeId) {
      return false;
    }
    if (selected.kind === "volume") {
      return false;
    }
    return selected.chapterId === target.chapterId;
  }

  if (selected.kind !== "scene") {
    return false;
  }

  return (
    selected.volumeId === target.volumeId
    && selected.chapterId === target.chapterId
    && selected.sceneId === target.sceneId
  );
}

function SceneEditor({
  projectId,
  path,
  flushRef,
  onSaved,
}: {
  projectId: string;
  path: ScenePath;
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  onSaved: (scene: StudioScene) => void;
}) {
  const { t } = useI18n();
  const [scene, setScene] = useState<StudioScene | null>(null);
  const [draft, setDraft] = useState<SceneDraft>(emptyDraft);
  const [committed, setCommitted] = useState<SceneDraft>(emptyDraft);
  const [conflict, setConflict] = useState<StudioScene | null>(null);
  const [saveError, setSaveError] = useState("");
  const [sceneError, setSceneError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const sceneRef = useRef<StudioScene | null>(null);
  const draftRef = useRef<SceneDraft>(emptyDraft);
  const committedRef = useRef<SceneDraft>(emptyDraft);
  const conflictRef = useRef<StudioScene | null>(null);
  const onSavedRef = useRef(onSaved);

  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const dirty = scene !== null && !sceneDraftsEqual(draft, committed);
  const blocked = conflict !== null;

  const shotsFlushRef = useRef<(() => Promise<boolean>) | null>(null);

  const persist = useCallback(async () => {
    const current = sceneRef.current;
    const nextDraft = draftRef.current;
    if (!current) {
      return true;
    }
    if (conflictRef.current) {
      return false;
    }
    if (sceneDraftsEqual(nextDraft, committedRef.current)) {
      return true;
    }

    try {
      const saved = await updateStudioScene(projectId, path, {
        ...nextDraft,
        expectedUpdatedAt: current.updatedAt,
      });
      sceneRef.current = saved;
      committedRef.current = sceneDraftFrom(saved);
      setScene(saved);
      setCommitted(sceneDraftFrom(saved));
      setSaveError("");
      onSavedRef.current(saved);
      return true;
    } catch (error) {
      if (error instanceof StudioRequestError && error.code === "EDIT_CONFLICT") {
        const currentRecord = readConflictScene(error);
        if (currentRecord) {
          conflictRef.current = currentRecord;
          setConflict(currentRecord);
          return false;
        }
      }
      setSaveError(error instanceof Error ? error.message : t("The request could not be completed."));
      return false;
    }
  }, [path, projectId, t]);

  const isDirty = useCallback(() => {
    return sceneRef.current !== null && !sceneDraftsEqual(draftRef.current, committedRef.current);
  }, []);

  const flushScene = useDebouncedSave({
    revision: `${draft.title}\n${draft.script}\n${draft.intent}`,
    dirty,
    blocked,
    isDirty,
    save: persist,
  });

  const flush = useCallback(async () => {
    const sceneOk = await flushScene();
    if (!sceneOk) {
      return false;
    }
    if (!shotsFlushRef.current) {
      return true;
    }
    return shotsFlushRef.current();
  }, [flushScene]);

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) {
        flushRef.current = null;
      }
    };
  }, [flush, flushRef]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty() && !conflictRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void getStudioScene(projectId, path)
        .then((record) => {
          if (cancelled) {
            return;
          }
          const nextDraft = sceneDraftFrom(record);
          sceneRef.current = record;
          draftRef.current = nextDraft;
          committedRef.current = nextDraft;
          conflictRef.current = null;
          setScene(record);
          setDraft(nextDraft);
          setCommitted(nextDraft);
          setLoading(false);
        })
        .catch((error) => {
          if (!cancelled) {
            setSceneError(error instanceof Error ? error.message : t("The workspace could not be loaded."));
            setLoading(false);
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [path, projectId, t]);

  function updateDraft(patch: Partial<SceneDraft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
  }

  async function overwrite() {
    const current = conflictRef.current;
    if (!current) {
      return;
    }
    setBusy(true);
    try {
      const saved = await updateStudioScene(projectId, path, {
        ...draftRef.current,
        expectedUpdatedAt: current.updatedAt,
      });
      sceneRef.current = saved;
      committedRef.current = sceneDraftFrom(saved);
      conflictRef.current = null;
      setScene(saved);
      setCommitted(sceneDraftFrom(saved));
      setConflict(null);
      setSaveError("");
      onSavedRef.current(saved);
    } catch (error) {
      if (error instanceof StudioRequestError && error.code === "EDIT_CONFLICT") {
        const currentRecord = readConflictScene(error);
        if (currentRecord) {
          conflictRef.current = currentRecord;
          setConflict(currentRecord);
          return;
        }
      }
      setSaveError(error instanceof Error ? error.message : t("The request could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      const latest = await getStudioScene(projectId, path);
      const nextDraft = sceneDraftFrom(latest);
      sceneRef.current = latest;
      draftRef.current = nextDraft;
      committedRef.current = nextDraft;
      conflictRef.current = null;
      setScene(latest);
      setDraft(nextDraft);
      setCommitted(nextDraft);
      setConflict(null);
      setSaveError("");
    } catch {
      const current = conflictRef.current;
      if (current) {
        const nextDraft = sceneDraftFrom(current);
        sceneRef.current = current;
        draftRef.current = nextDraft;
        committedRef.current = nextDraft;
        conflictRef.current = null;
        setScene(current);
        setDraft(nextDraft);
        setCommitted(nextDraft);
        setConflict(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-line lg:border-b-0">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
          {loading ? (
            <div className="space-y-4">
              <div className="h-11 animate-pulse rounded-lg bg-surface-muted" />
              <div className="h-48 animate-pulse rounded-lg bg-surface-muted" />
            </div>
          ) : sceneError ? (
            <p role="alert" className="text-sm text-danger">{sceneError}</p>
          ) : scene ? (
            <div className="mx-auto flex max-w-[760px] flex-col gap-5">
              {conflict ? (
                <ConflictBanner
                  busy={busy}
                  onOverwrite={() => void overwrite()}
                  onDiscard={() => void discard()}
                  preview={
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("Scene title")}</p>
                        <p className="mt-1 whitespace-pre-wrap text-ink">{conflict.title}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("Script")}</p>
                        <p className="mt-1 whitespace-pre-wrap text-ink">{conflict.script}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("Intent")}</p>
                        <p className="mt-1 whitespace-pre-wrap text-ink">{conflict.intent}</p>
                      </div>
                    </div>
                  }
                />
              ) : null}
              {saveError ? <p role="alert" className="text-sm text-danger">{saveError}</p> : null}
              <div className="space-y-2">
                <label htmlFor="scene-title" className="block text-sm font-semibold text-ink">
                  {t("Scene title")}
                </label>
                <input
                  id="scene-title"
                  value={draft.title}
                  onChange={(event) => updateDraft({ title: event.target.value })}
                  onBlur={() => void flush()}
                  className={`${fieldClassName} min-h-11`}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="scene-script" className="block text-sm font-semibold text-ink">
                  {t("Script")}
                </label>
                <textarea
                  id="scene-script"
                  value={draft.script}
                  onChange={(event) => updateDraft({ script: event.target.value })}
                  onBlur={() => void flush()}
                  rows={16}
                  className={`${fieldClassName} resize-y py-3 leading-6`}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="scene-intent" className="block text-sm font-semibold text-ink">
                  {t("Intent")}
                </label>
                <textarea
                  id="scene-intent"
                  value={draft.intent}
                  onChange={(event) => updateDraft({ intent: event.target.value })}
                  onBlur={() => void flush()}
                  rows={5}
                  className={`${fieldClassName} resize-y py-3 leading-6`}
                />
              </div>
              <p
                className="text-xs text-ink-faint"
                aria-live="polite"
                data-save-state={conflict ? "conflict" : dirty ? "saving" : "saved"}
              >
                {conflict ? t("Unsaved changes") : dirty ? t("Saving") : t("Saved")}
              </p>
              <ShotBoard
                key={scene.shots.map((shot) => shot.id).join("/") || "empty"}
                projectId={projectId}
                path={path}
                shots={scene.shots}
                flushRef={shotsFlushRef}
                onBeforeDirector={flushScene}
                onDirected={(directed) => {
                  sceneRef.current = directed;
                  setScene(directed);
                }}
                onShotSaved={(saved) => {
                  const current = sceneRef.current;
                  if (!current) {
                    return;
                  }
                  const next = {
                    ...current,
                    shots: current.shots.map((item) => (item.id === saved.id ? saved : item)),
                  };
                  sceneRef.current = next;
                  setScene(next);
                }}
              />
            </div>
          ) : null}
        </div>
      </section>

      <aside className="bg-surface px-5 py-6 lg:w-64 lg:shrink-0 lg:border-l lg:border-line lg:px-4">
        <SceneEntityRail
          projectId={projectId}
          path={path}
          scene={scene}
          readScene={() => sceneRef.current}
          onBeforePatch={flush}
          onPatched={(saved) => {
            sceneRef.current = saved;
            setScene(saved);
            onSavedRef.current(saved);
          }}
        />
        <h2 className="mt-6 text-sm font-semibold text-ink">{t("Shots")}</h2>
        {scene?.shots.length ? (
          <ul className="mt-2 space-y-1 font-mono text-xs text-ink-muted">
            {scene.shots.map((shot) => (
              <li key={shot.id} className="flex items-center justify-between gap-2">
                <span>{shot.id}</span>
                <span className="text-ink-faint">
                  {t(
                    shot.status === "pending"
                      ? "Awaiting run"
                      : shot.status === "success"
                        ? "Success"
                        : shot.status === "failed"
                          ? "Failed"
                          : "Locked",
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-faint">{t("None")}</p>
        )}
      </aside>
    </>
  );
}

function sameSelection(left: StorySelection, right: StorySelection) {
  if (left.kind !== right.kind || left.volumeId !== right.volumeId) {
    return false;
  }
  if (left.kind === "volume" || right.kind === "volume") {
    return left.kind === "volume" && right.kind === "volume";
  }
  if (left.chapterId !== right.chapterId) {
    return false;
  }
  if (left.kind === "chapter" || right.kind === "chapter") {
    return left.kind === "chapter" && right.kind === "chapter";
  }
  return left.sceneId === right.sceneId;
}

function treeSelectButtonClass(active: boolean) {
  return `flex min-h-10 min-w-0 flex-1 items-center rounded-l-lg px-2 text-left text-sm transition-colors disabled:opacity-60 ${active ? "font-semibold text-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`;
}

function treeDeleteButtonClass() {
  return "inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-r-lg text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50";
}

function parseTargetFromSelection(
  tree: StudioStoryTree | null,
  selected: StorySelection | null,
): { volumeId: string | null; chapterId: string | null; volumeTitle: string; chapterTitle: string } {
  if (!tree) {
    return { volumeId: null, chapterId: null, volumeTitle: "", chapterTitle: "" };
  }

  if (selected?.kind === "volume") {
    const volume = tree.volumes.find((item) => item.id === selected.volumeId);
    const chapter = volume?.chapters[0];
    return {
      volumeId: volume?.id ?? selected.volumeId,
      chapterId: chapter?.id ?? null,
      volumeTitle: volume?.title || selected.volumeId,
      chapterTitle: chapter?.title || "",
    };
  }

  if (selected) {
    const volume = tree.volumes.find((item) => item.id === selected.volumeId);
    const chapter = volume?.chapters.find((item) => item.id === selected.chapterId);
    return {
      volumeId: selected.volumeId,
      chapterId: selected.chapterId,
      volumeTitle: volume?.title || selected.volumeId,
      chapterTitle: chapter?.title || selected.chapterId,
    };
  }

  const volume = tree.volumes[0];
  const chapter = volume?.chapters[0];
  return {
    volumeId: volume?.id ?? null,
    chapterId: chapter?.id ?? null,
    volumeTitle: volume?.title || "",
    chapterTitle: chapter?.title || "",
  };
}

function selectionTitle(tree: StudioStoryTree, selected: StorySelection): string {
  const volume = tree.volumes.find((item) => item.id === selected.volumeId);
  if (selected.kind === "volume") {
    return volume?.title || selected.volumeId;
  }
  const chapter = volume?.chapters.find((item) => item.id === selected.chapterId);
  if (selected.kind === "chapter") {
    return chapter?.title || selected.chapterId;
  }
  const scene = chapter?.scenes.find((item) => item.id === selected.sceneId);
  return scene?.title || selected.sceneId;
}

function matchesEntityQuery(name: string, query: string) {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

function entityLabel(entities: StudioEntity[], id: string) {
  return entities.find((item) => item.id === id)?.name || id;
}

function SceneEntityRail({
  projectId,
  path,
  scene,
  readScene,
  onBeforePatch,
  onPatched,
}: {
  projectId: string;
  path: ScenePath;
  scene: StudioScene | null;
  readScene: () => StudioScene | null;
  onBeforePatch: () => Promise<boolean>;
  onPatched: (scene: StudioScene) => void;
}) {
  const { t } = useI18n();
  const [characters, setCharacters] = useState<StudioEntity[]>([]);
  const [locations, setLocations] = useState<StudioEntity[]>([]);
  const [props, setProps] = useState<StudioEntity[]>([]);
  const [costumes, setCostumes] = useState<StudioEntity[]>([]);
  const [characterQuery, setCharacterQuery] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [propQuery, setPropQuery] = useState("");
  const [costumeQuery, setCostumeQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void Promise.all([
        listStudioEntities(projectId, "character"),
        listStudioEntities(projectId, "location"),
        listStudioEntities(projectId, "prop"),
        listStudioEntities(projectId, "costume"),
      ])
        .then(([nextCharacters, nextLocations, nextProps, nextCostumes]) => {
          if (!cancelled) {
            setCharacters(nextCharacters);
            setLocations(nextLocations);
            setProps(nextProps);
            setCostumes(nextCostumes);
          }
        })
        .catch((loadError) => {
          if (!cancelled) {
            setError(loadError instanceof Error ? loadError.message : t("The workspace could not be loaded."));
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [projectId, t]);

  async function patchLinks(patch: {
    characters?: string[];
    location?: string | null;
    props?: string[];
    costumes?: string[];
  }) {
    if (busy) {
      return;
    }
    const ok = await onBeforePatch();
    if (!ok) {
      return;
    }
    const current = readScene();
    if (!current) {
      return;
    }
    setBusy(true);
    try {
      const saved = await updateStudioScene(projectId, path, {
        ...patch,
        expectedUpdatedAt: current.updatedAt,
      });
      onPatched(saved);
      setError("");
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : t("The request could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  const unusedCharacters = characters.filter((entity) =>
    !scene?.characters.includes(entity.id) && matchesEntityQuery(entity.name, characterQuery),
  );
  const unusedLocations = locations.filter((entity) =>
    entity.id !== scene?.location && matchesEntityQuery(entity.name, locationQuery),
  );
  const unusedProps = props.filter((entity) =>
    !scene?.props.includes(entity.id) && matchesEntityQuery(entity.name, propQuery),
  );
  const unusedCostumes = costumes.filter((entity) =>
    !scene?.costumes.includes(entity.id) && matchesEntityQuery(entity.name, costumeQuery),
  );

  return (
    <>
      <h2 className="text-sm font-semibold text-ink">{t("Characters")}</h2>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
      {scene?.characters.length ? (
        <ul className="mt-2 space-y-2 text-sm text-ink">
          {scene.characters.map((id) => (
            <li key={id} className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate">{entityLabel(characters, id)}</span>
              <button
                type="button"
                onClick={() => void patchLinks({ characters: scene.characters.filter((item) => item !== id) })}
                disabled={busy}
                className="shrink-0 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-60"
              >
                {t("Remove from scene")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">{t("None")}</p>
      )}
      <div className="mt-3 space-y-2">
        <label htmlFor="search-characters" className="block text-xs font-semibold text-ink-muted">
          {t("Search characters")}
        </label>
        <input
          id="search-characters"
          value={characterQuery}
          onChange={(event) => setCharacterQuery(event.target.value)}
          autoComplete="off"
          className={`${fieldClassName} min-h-9`}
        />
        {unusedCharacters.length === 0 ? (
          <p className="text-xs text-ink-faint">{t("No matching entities")}</p>
        ) : (
          <ul className="space-y-1">
            {unusedCharacters.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  onClick={() => {
                    const current = readScene();
                    if (!current || current.characters.includes(entity.id)) {
                      return;
                    }
                    void patchLinks({ characters: [...current.characters, entity.id] });
                  }}
                  disabled={busy || !scene}
                  aria-label={`${t("Add to scene")}: ${entity.name}`}
                  className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60"
                >
                  <span className="truncate">{entity.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-ink">{t("Locations")}</h2>
      {scene?.location ? (
        <div className="mt-2 flex items-start justify-between gap-2 text-sm text-ink">
          <span className="min-w-0 truncate">{entityLabel(locations, scene.location)}</span>
          <button
            type="button"
            onClick={() => void patchLinks({ location: null })}
            disabled={busy}
            className="shrink-0 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-60"
          >
            {t("Remove from scene")}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">{t("None")}</p>
      )}
      <div className="mt-3 space-y-2">
        <label htmlFor="search-locations" className="block text-xs font-semibold text-ink-muted">
          {t("Search locations")}
        </label>
        <input
          id="search-locations"
          value={locationQuery}
          onChange={(event) => setLocationQuery(event.target.value)}
          autoComplete="off"
          className={`${fieldClassName} min-h-9`}
        />
        {unusedLocations.length === 0 ? (
          <p className="text-xs text-ink-faint">{t("No matching entities")}</p>
        ) : (
          <ul className="space-y-1">
            {unusedLocations.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  onClick={() => void patchLinks({ location: entity.id })}
                  disabled={busy || !scene}
                  aria-label={`${t("Add to scene")}: ${entity.name}`}
                  className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60"
                >
                  <span className="truncate">{entity.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-ink">{t("Props")}</h2>
      {scene?.props.length ? (
        <ul className="mt-2 space-y-2 text-sm text-ink">
          {scene.props.map((id) => (
            <li key={id} className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate">{entityLabel(props, id)}</span>
              <button
                type="button"
                onClick={() => void patchLinks({ props: scene.props.filter((item) => item !== id) })}
                disabled={busy}
                className="shrink-0 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-60"
              >
                {t("Remove from scene")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">{t("None")}</p>
      )}
      <div className="mt-3 space-y-2">
        <label htmlFor="search-props" className="block text-xs font-semibold text-ink-muted">
          {t("Search props")}
        </label>
        <input
          id="search-props"
          value={propQuery}
          onChange={(event) => setPropQuery(event.target.value)}
          autoComplete="off"
          className={`${fieldClassName} min-h-9`}
        />
        {unusedProps.length === 0 ? (
          <p className="text-xs text-ink-faint">{t("No matching entities")}</p>
        ) : (
          <ul className="space-y-1">
            {unusedProps.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  onClick={() => {
                    const current = readScene();
                    if (!current || current.props.includes(entity.id)) {
                      return;
                    }
                    void patchLinks({ props: [...current.props, entity.id] });
                  }}
                  disabled={busy || !scene}
                  aria-label={`${t("Add to scene")}: ${entity.name}`}
                  className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60"
                >
                  <span className="truncate">{entity.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-ink">{t("Costumes")}</h2>
      {scene?.costumes.length ? (
        <ul className="mt-2 space-y-2 text-sm text-ink">
          {scene.costumes.map((id) => (
            <li key={id} className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate">{entityLabel(costumes, id)}</span>
              <button
                type="button"
                onClick={() => void patchLinks({ costumes: scene.costumes.filter((item) => item !== id) })}
                disabled={busy}
                className="shrink-0 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-60"
              >
                {t("Remove from scene")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">{t("None")}</p>
      )}
      <div className="mt-3 space-y-2">
        <label htmlFor="search-costumes" className="block text-xs font-semibold text-ink-muted">
          {t("Search costumes")}
        </label>
        <input
          id="search-costumes"
          value={costumeQuery}
          onChange={(event) => setCostumeQuery(event.target.value)}
          autoComplete="off"
          className={`${fieldClassName} min-h-9`}
        />
        {unusedCostumes.length === 0 ? (
          <p className="text-xs text-ink-faint">{t("No matching entities")}</p>
        ) : (
          <ul className="space-y-1">
            {unusedCostumes.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  onClick={() => {
                    const current = readScene();
                    if (!current || current.costumes.includes(entity.id)) {
                      return;
                    }
                    void patchLinks({ costumes: [...current.costumes, entity.id] });
                  }}
                  disabled={busy || !scene}
                  aria-label={`${t("Add to scene")}: ${entity.name}`}
                  className="flex min-h-9 w-full items-center rounded-lg px-2 text-left text-xs text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60"
                >
                  <span className="truncate">{entity.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function replaceSceneTitle(tree: StudioStoryTree, path: ScenePath, title: string): StudioStoryTree {
  return {
    volumes: tree.volumes.map((volume) => {
      if (volume.id !== path.volumeId) {
        return volume;
      }
      return {
        ...volume,
        chapters: volume.chapters.map((chapter) => {
          if (chapter.id !== path.chapterId) {
            return chapter;
          }
          return {
            ...chapter,
            scenes: chapter.scenes.map((item) => item.id === path.sceneId ? { ...item, title } : item),
          };
        }),
      };
    }),
  };
}
