"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { StudioContextSnapshot, StudioScene, StudioShot, StudioShotStatus } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import {
  directStudioScene,
  generateStudioShot,
  getStudioContextSnapshot,
  listStudioShots,
  lockStudioShot,
  shotDraftFrom,
  shotDraftsEqual,
  StudioRequestError,
  studioImageUrl,
  updateStudioShot,
  type ScenePath,
  type ShotDraft,
} from "./api";
import { useDebouncedSave } from "./useDebouncedSave";

const fieldClassName =
  "w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15";

const statusLabel: Record<StudioShotStatus, "Awaiting run" | "Success" | "Failed" | "Locked"> = {
  pending: "Awaiting run",
  success: "Success",
  failed: "Failed",
  locked: "Locked",
};

export function ShotBoard({
  projectId,
  path,
  shots,
  flushRef,
  onBeforeDirector,
  onDirected,
  onShotSaved,
}: {
  projectId: string;
  path: ScenePath;
  shots: StudioShot[];
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  onBeforeDirector: () => Promise<boolean>;
  onDirected: (scene: StudioScene) => void;
  onShotSaved: (shot: StudioShot) => void;
}) {
  const { t } = useI18n();
  const [records, setRecords] = useState(shots);
  const [drafts, setDrafts] = useState<Record<string, ShotDraft>>(() => draftsFrom(shots));
  const [committed, setCommitted] = useState<Record<string, ShotDraft>>(() => draftsFrom(shots));
  const [directing, setDirecting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [locking, setLocking] = useState(false);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<StudioContextSnapshot | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState("");

  const recordsRef = useRef(records);
  const draftsRef = useRef(drafts);
  const committedRef = useRef(committed);
  const onShotSavedRef = useRef(onShotSaved);

  useEffect(() => {
    onShotSavedRef.current = onShotSaved;
  });

  useEffect(() => {
    recordsRef.current = records;
    draftsRef.current = drafts;
    committedRef.current = committed;
  }, [committed, drafts, records]);

  const dirty = records.some((shot) => {
    const draft = drafts[shot.id];
    const saved = committed[shot.id];
    return draft && saved ? !shotDraftsEqual(draft, saved) : false;
  });

  const persist = useCallback(async () => {
    const currentDrafts = draftsRef.current;
    const currentCommitted = committedRef.current;
    const currentRecords = recordsRef.current;
    const dirtyShots = currentRecords.filter((shot) => {
      const draft = currentDrafts[shot.id];
      const saved = currentCommitted[shot.id];
      return draft && saved ? !shotDraftsEqual(draft, saved) : false;
    });

    if (dirtyShots.length === 0) {
      return true;
    }

    try {
      const nextRecords = currentRecords.slice();
      const nextCommitted = { ...currentCommitted };
      for (const shot of dirtyShots) {
        const draft = currentDrafts[shot.id];
        if (!draft) {
          continue;
        }
        const saved = await updateStudioShot(projectId, path, shot.id, {
          ...draft,
          expectedUpdatedAt: shot.updatedAt,
        });
        const index = nextRecords.findIndex((item) => item.id === saved.id);
        if (index >= 0) {
          nextRecords[index] = saved;
        }
        nextCommitted[saved.id] = shotDraftFrom(saved);
        onShotSavedRef.current(saved);
      }
      recordsRef.current = nextRecords;
      committedRef.current = nextCommitted;
      setRecords(nextRecords);
      setCommitted(nextCommitted);
      setError("");
      return true;
    } catch (caught) {
      if (caught instanceof StudioRequestError && caught.code === "EDIT_CONFLICT") {
        setError(caught.message);
        return false;
      }
      setError(caught instanceof Error ? caught.message : t("The request could not be completed."));
      return false;
    }
  }, [path, projectId, t]);

  const isDirty = useCallback(() => {
    const currentDrafts = draftsRef.current;
    const currentCommitted = committedRef.current;
    return recordsRef.current.some((shot) => {
      const draft = currentDrafts[shot.id];
      const saved = currentCommitted[shot.id];
      return draft && saved ? !shotDraftsEqual(draft, saved) : false;
    });
  }, []);

  const revision = useMemo(
    () => records.map((shot) => JSON.stringify(drafts[shot.id] ?? shotDraftFrom(shot))).join("\n"),
    [drafts, records],
  );

  const flush = useDebouncedSave({
    revision,
    dirty,
    blocked: false,
    isDirty,
    save: persist,
  });

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) {
        flushRef.current = null;
      }
    };
  }, [flush, flushRef]);

  function updateDraft(shotId: string, patch: Partial<ShotDraft>) {
    const current = draftsRef.current[shotId];
    if (!current) {
      return;
    }
    const next = { ...draftsRef.current, [shotId]: { ...current, ...patch } };
    draftsRef.current = next;
    setDrafts(next);
  }

  async function runDirector() {
    const ok = await onBeforeDirector();
    if (!ok) {
      return;
    }
    setDirecting(true);
    try {
      const scene = await directStudioScene(projectId, path);
      onDirected(scene);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("The request could not be completed."));
    } finally {
      setDirecting(false);
    }
  }

  function replaceRecords(next: StudioShot[]) {
    recordsRef.current = next;
    setRecords(next);
    for (const shot of next) {
      onShotSavedRef.current(shot);
    }
  }

  async function generatePage() {
    const pageShot = recordsRef.current[0];
    if (!pageShot || generating || locking) {
      return;
    }
    const ok = await flush();
    if (!ok) {
      return;
    }
    setGenerating(true);
    try {
      const { shot } = await generateStudioShot(projectId, path, pageShot.id);
      let next: StudioShot[];
      try {
        next = await listStudioShots(projectId, path);
      } catch {
        next = applyGeneratedPage(recordsRef.current, shot);
      }
      replaceRecords(next);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("The request could not be completed."));
    } finally {
      setGenerating(false);
    }
  }

  async function togglePageLock() {
    const pageShot = recordsRef.current[0];
    if (!pageShot || generating || locking) {
      return;
    }
    const ok = await flush();
    if (!ok) {
      return;
    }
    const nextLocked = pageShot.status !== "locked";
    setLocking(true);
    try {
      const { shot } = await lockStudioShot(projectId, path, pageShot.id, nextLocked);
      replaceRecords(applyLockedShot(recordsRef.current, shot));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("The request could not be completed."));
    } finally {
      setLocking(false);
    }
  }

  async function inspect(shotId: string) {
    if (inspectingId === shotId && snapshot) {
      setInspectingId(null);
      setSnapshot(null);
      return;
    }
    const ok = await flush();
    if (!ok) {
      return;
    }
    setInspecting(true);
    try {
      const next = await getStudioContextSnapshot(projectId, path, shotId);
      setInspectingId(shotId);
      setSnapshot(next);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("The request could not be completed."));
    } finally {
      setInspecting(false);
    }
  }

  const pageShot = records[0];
  const pageImage = pageSelectedImage(records);
  const pageImageUrl = pageImage ? studioImageUrl(projectId, pageImage) : "";
  const pageLocked = pageShot?.status === "locked";
  const pageBusy = generating || locking;

  return (
    <section className="space-y-4 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{t("Shots")}</h2>
        {records.length === 0 ? (
          <button
            type="button"
            onClick={() => void runDirector()}
            disabled={directing}
            className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
          >
            {directing ? t("Directing") : t("Run director")}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void generatePage()}
              disabled={pageBusy || pageLocked}
              className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating ? t("Generating comic page") : t("Generate comic page")}
            </button>
            {pageImage || pageLocked ? (
              <button
                type="button"
                onClick={() => void togglePageLock()}
                disabled={pageBusy}
                className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {locking
                  ? pageLocked
                    ? t("Unlocking")
                    : t("Locking")
                  : pageLocked
                    ? t("Unlock")
                    : t("Lock")}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {records.length === 0 ? (
        <p className="text-xs text-ink-faint">{t("No shots yet. Run the director to split this scene.")}</p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <ol className="min-w-0 flex-1 space-y-4">
          {records.map((shot) => {
            const draft = drafts[shot.id] ?? shotDraftFrom(shot);
            const saved = committed[shot.id] ?? shotDraftFrom(shot);
            const shotDirty = !shotDraftsEqual(draft, saved);
            const open = inspectingId === shot.id && snapshot;
            return (
              <li key={shot.id} className="rounded-xl border border-line bg-surface-muted/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs font-semibold text-ink">{shot.id}</p>
                  <span className="text-xs text-ink-faint">{t(statusLabel[shot.status])}</span>
                </div>
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <label htmlFor={`${shot.id}-purpose`} className="block text-xs font-semibold text-ink">
                      {t("Shot purpose")}
                    </label>
                    <input
                      id={`${shot.id}-purpose`}
                      value={draft.purpose}
                      onChange={(event) => updateDraft(shot.id, { purpose: event.target.value })}
                      onBlur={() => void flush()}
                      className={`${fieldClassName} min-h-10`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`${shot.id}-action`} className="block text-xs font-semibold text-ink">
                      {t("Shot action")}
                    </label>
                    <textarea
                      id={`${shot.id}-action`}
                      value={draft.action}
                      onChange={(event) => updateDraft(shot.id, { action: event.target.value })}
                      onBlur={() => void flush()}
                      rows={3}
                      className={`${fieldClassName} resize-y py-2 leading-5`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor={`${shot.id}-camera`} className="block text-xs font-semibold text-ink">
                      {t("Shot camera")}
                    </label>
                    <input
                      id={`${shot.id}-camera`}
                      value={draft.camera}
                      onChange={(event) => updateDraft(shot.id, { camera: event.target.value })}
                      onBlur={() => void flush()}
                      className={`${fieldClassName} min-h-10`}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => void inspect(shot.id)}
                    disabled={inspecting}
                    className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
                  >
                    {open ? t("Hide context") : t("Inspect context")}
                  </button>
                  <p className="text-xs text-ink-faint" aria-live="polite">
                    {shotDirty ? t("Saving") : t("Saved")}
                  </p>
                </div>
                {open ? (
                  <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-[11px] leading-5 text-ink">
                    {JSON.stringify(snapshot, null, 2)}
                  </pre>
                ) : null}
              </li>
            );
          })}
          </ol>
          {pageImageUrl ? (
            <figure className="w-full shrink-0 lg:max-w-sm lg:w-[42%]">
              <img
                src={pageImageUrl}
                alt={t("Generated comic page")}
                className="w-full rounded-lg border border-line bg-surface-muted object-contain"
              />
            </figure>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function pageSelectedImage(shots: readonly StudioShot[]): string | null {
  for (const shot of shots) {
    if (shot.selected_image) {
      return shot.selected_image;
    }
  }
  return null;
}

export function applyGeneratedPage(records: StudioShot[], shot: StudioShot): StudioShot[] {
  return records.map((item) => {
    if (item.id === shot.id) {
      return shot;
    }
    if (shot.selected_image && item.selected_image === shot.selected_image) {
      return {
        ...item,
        selected_image: shot.selected_image,
        status: item.status === "locked" ? "locked" : shot.status,
      };
    }
    return item;
  });
}

export function applyLockedShot(records: StudioShot[], shot: StudioShot): StudioShot[] {
  return records.map((item) => (item.id === shot.id ? shot : item));
}

function draftsFrom(shots: StudioShot[]): Record<string, ShotDraft> {
  const drafts: Record<string, ShotDraft> = {};
  for (const shot of shots) {
    drafts[shot.id] = shotDraftFrom(shot);
  }
  return drafts;
}
