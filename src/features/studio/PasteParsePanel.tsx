"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/features/i18n/LocaleProvider";
import type { StudioParseRun } from "@/studio/parse/schemas";
import {
  confirmStudioParseRun,
  listStudioParseRuns,
  parseStudioText,
  rejectStudioParseRun,
} from "./api";

const fieldClassName =
  "w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15";

export function PasteParsePanel({
  projectId,
  targetVolumeId,
  targetChapterId,
  targetVolumeTitle,
  targetChapterTitle,
  onBeforeMutate,
  onProjectRecordsChanged,
  onParseBusyChange,
}: {
  projectId: string;
  targetVolumeId: string | null;
  targetChapterId: string | null;
  targetVolumeTitle: string;
  targetChapterTitle: string;
  onBeforeMutate: () => Promise<boolean>;
  onProjectRecordsChanged: () => Promise<void> | void;
  onParseBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [runs, setRuns] = useState<StudioParseRun[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"parse" | "confirm" | "reject" | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void listStudioParseRuns(projectId)
        .then((nextRuns) => {
          if (!cancelled) {
            setRuns(nextRuns);
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

  useEffect(() => {
    onParseBusyChange?.(busy === "parse");
  }, [busy, onParseBusyChange]);

  useEffect(() => {
    return () => {
      onParseBusyChange?.(false);
    };
  }, [onParseBusyChange]);

  const pending = runs.filter((run) => run.status === "pending");

  async function parse() {
    const source = text.trim();
    if (!source || busy) {
      return;
    }
    setBusy("parse");
    onParseBusyChange?.(true);
    setError("");
    try {
      const run = await parseStudioText(projectId, source);
      setRuns((current) => {
        const others = current.filter((item) => item.id !== run.id);
        return [...others, run].sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
      });
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : t("The text could not be parsed."));
    } finally {
      setBusy(null);
      onParseBusyChange?.(false);
    }
  }

  async function confirm(runId: string) {
    if (busy) {
      return;
    }
    const ok = await onBeforeMutate();
    if (!ok) {
      return;
    }
    setBusy("confirm");
    setError("");
    try {
      const result = await confirmStudioParseRun(
        projectId,
        runId,
        targetVolumeId && targetChapterId
          ? { volumeId: targetVolumeId, chapterId: targetChapterId }
          : undefined,
      );
      setRuns((current) => current.map((item) => (item.id === result.run.id ? result.run : item)));
      await onProjectRecordsChanged();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : t("The request could not be completed."));
    } finally {
      setBusy(null);
    }
  }

  async function reject(runId: string) {
    if (busy) {
      return;
    }
    setBusy("reject");
    setError("");
    try {
      const run = await rejectStudioParseRun(projectId, runId);
      setRuns((current) => current.map((item) => (item.id === run.id ? run : item)));
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : t("The request could not be completed."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 border-b border-line px-4 py-3">
      <h2 className="text-sm font-semibold text-ink">{t("Paste & parse")}</h2>
      <div className="space-y-2">
        <label htmlFor="paste-parse-text" className="block text-xs font-semibold text-ink-muted">
          {t("Paste story text")}
        </label>
        <textarea
          id="paste-parse-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          className={`${fieldClassName} resize-y py-2 leading-5`}
        />
      </div>
      <button
        type="button"
        onClick={() => void parse()}
        disabled={busy !== null || text.trim() === ""}
        className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
      >
        {t(busy === "parse" ? "Parsing…" : "Parse")}
      </button>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <p className="text-xs text-ink-muted">
        {t("Confirm creates volumes and chapters from the story. The selected chapter is only used if the parse proposes a single chapter.")}
      </p>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("Pending proposals")}</h3>
        {pending.length === 0 ? (
          <p className="mt-2 text-xs text-ink-faint">{t("No pending proposals")}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {pending.map((run) => (
              <li key={run.id} className="rounded-lg border border-line bg-surface px-3 py-2">
                <p className="font-mono text-[11px] text-ink-faint">{run.id}</p>
                <p className="mt-2 text-xs font-semibold text-ink-muted">{t("Proposed scenes")}</p>
                <ul className="mt-1 space-y-1 text-sm text-ink">
                  {run.proposedScenes.map((scene) => (
                    <li key={scene.key} className="truncate">
                      {[scene.volumeName, scene.chapterName, scene.title].filter((part) => part && part.trim()).join(" / ")}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs font-semibold text-ink-muted">{t("Proposed entities")}</p>
                <ul className="mt-1 space-y-1 text-sm text-ink">
                  {run.proposedEntities.map((entity) => (
                    <li key={entity.key} className="truncate">
                      {entity.name} · {entity.kind}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void confirm(run.id)}
                    disabled={busy !== null}
                    className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
                  >
                    {t("Confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void reject(run.id)}
                    disabled={busy !== null}
                    className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
                  >
                    {t("Reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
