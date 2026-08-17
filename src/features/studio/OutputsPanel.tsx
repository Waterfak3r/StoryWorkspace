"use client";

import { useEffect, useState } from "react";
import {
  ChatCircleDots,
  Images,
} from "@phosphor-icons/react";
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
    <div className="mx-auto w-full max-w-[920px] px-5 py-8 sm:px-8">
      {/* Header section */}
      <div className="border-b border-line pb-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Outputs")}</p>
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{t("Comics pages")}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {t("Sequential comic pages composed from story beats, panel artwork, and dialogue lettering.")}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {book === null ? (
        <div className="mt-8 space-y-4">
          <div className="h-28 animate-pulse rounded-2xl border border-line bg-surface-muted" />
          <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface-muted" />
        </div>
      ) : book.pages.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface/50 p-10 text-center">
          <Images size={36} className="mx-auto text-ink-faint" />
          <p className="mt-3 text-sm font-medium text-ink-muted">{t("No comics pages yet.")}</p>
          <p className="mt-1 text-xs text-ink-faint">
            {t("Generate comic pages in the Story or Workflow panel to preview them here.")}
          </p>
        </div>
      ) : (
        <ol className="mt-8 space-y-10">
          {book.pages.map((page) => (
            <li
              key={`page-${page.index}`}
              data-testid="comics-page"
              className="rounded-2xl border border-line bg-surface-raised p-5 shadow-sm sm:p-6"
            >
              {/* Page metadata bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center justify-center rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-on-accent shadow-xs">
                    {t("Page {n}", { n: page.index + 1 })}
                  </span>
                  <span className="text-xs font-semibold text-ink">
                    {page.panels.length} {t("panels")}
                  </span>
                </div>
                {page.lettering.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
                    <ChatCircleDots size={14} className="text-accent" />
                    {page.lettering.length} {t("speech balloons")}
                  </span>
                ) : null}
              </div>

              {/* Comic Book Art Canvas with Speech Balloon Overlay */}
              <figure
                data-testid="comics-page-image"
                className="relative mt-4 overflow-hidden rounded-xl border-2 border-neutral-800 bg-neutral-950/5 shadow-md dark:border-neutral-700"
              >
                <img
                  src={studioImageUrl(projectId, page.pageImage)}
                  alt={t("Page {n}", { n: page.index + 1 })}
                  className="block w-full object-contain"
                />
                {page.lettering.length > 0 ? (
                  <ol
                    data-testid="comics-lettering"
                    className="pointer-events-none absolute inset-0 grid"
                    style={{ gridTemplateAreas: letteringGrid(page.panels.length) }}
                  >
                    {page.lettering.map((balloon) => (
                      <li
                        key={balloon.id}
                        data-testid="speech-balloon"
                        data-speaker={balloon.speaker}
                        data-shot={balloon.shotId}
                        className="flex items-start justify-center p-3 sm:p-4"
                        style={{ gridArea: `p${balloon.panelIndex}` }}
                      >
                        <span className="relative max-w-[85%] rounded-2xl border-2 border-neutral-900 bg-white/98 px-3 py-1.5 text-center shadow-md after:absolute after:-bottom-1.5 after:left-1/2 after:h-2.5 after:w-2.5 after:-translate-x-1/2 after:rotate-45 after:border-b-2 after:border-r-2 after:border-neutral-900 after:bg-white after:content-[''] dark:border-neutral-950">
                          <span className="mb-0.5 inline-block rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-accent">
                            {balloon.speaker}
                          </span>
                          <span className="block text-xs font-semibold leading-snug tracking-tight text-neutral-900">
                            {balloon.text}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </figure>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function letteringGrid(panelCount: number): string {
  if (panelCount <= 1) {
    return `"p0"`;
  }
  if (panelCount === 2) {
    return `"p0" "p1"`;
  }
  if (panelCount === 3) {
    return `"p0 p1" "p2 p2"`;
  }
  return `"p0 p1" "p2 p3"`;
}

