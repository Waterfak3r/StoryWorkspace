"use client";

import { useEffect, useState } from "react";
import type { StudioComicsBook } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { getStudioComics, studioImageUrl } from "./api";

export function OutputsPanel({ projectId, active = true }: { projectId: string; active?: boolean }) {
  const { t } = useI18n();
  const [book, setBook] = useState<StudioComicsBook | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void getStudioComics(projectId)
        .then((next) => {
          if (!cancelled) {
            setBook(next);
          }
        })
        .catch((cause) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : t("The workspace could not be loaded."));
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [projectId, t, active]);

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-10 sm:px-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Outputs")}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{t("Comics pages")}</h1>
      <p className="mt-3 text-sm text-ink-muted">{t("Each page is one comic image with consecutive story beats.")}</p>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {book === null ? (
        <div className="mt-8 space-y-3">
          {["one", "two"].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-xl border border-line bg-surface-muted" />
          ))}
        </div>
      ) : book.pages.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">{t("No comics pages yet.")}</p>
      ) : (
        <ol className="mt-8 space-y-8">
          {book.pages.map((page) => (
            <li
              key={`page-${page.index}`}
              data-testid="comics-page"
              className="rounded-xl border border-line bg-surface-raised px-4 py-4"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                {t("Page {n}", { n: page.index + 1 })}
              </p>
              <figure data-testid="comics-page-image" className="mt-3 overflow-hidden rounded-lg border border-line bg-surface-muted">
                <img
                  src={studioImageUrl(projectId, page.pageImage)}
                  alt={t("Page {n}", { n: page.index + 1 })}
                  className="w-full object-contain"
                />
              </figure>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-ink">
                {page.panels.map((panel) => (
                  <li key={`${panel.volumeId}-${panel.chapterId}-${panel.sceneId}-${panel.shotId}`} data-testid="comics-panel">
                    {panel.caption}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
