"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  ChatCircleDots,
  Images,
} from "@phosphor-icons/react";
import type { StudioComicsBook } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { getStudioComics, getStudioStyle, studioImageUrl, type StudioStyleView } from "./api";

export function OutputsPanel({ projectId, active = true }: { projectId: string; active?: boolean }) {
  const { t } = useI18n();
  const [book, setBook] = useState<StudioComicsBook | null>(null);
  const [styleView, setStyleView] = useState<StudioStyleView | null>(null);
  const [error, setError] = useState("");
  const [pageCursor, setPageCursor] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void Promise.all([getStudioComics(projectId), getStudioStyle(projectId)])
        .then(([nextBook, nextStyle]) => {
          if (!cancelled) {
            setBook(nextBook);
            setStyleView(nextStyle);
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

  const isOverlayMode = styleView?.style.lettering === "overlay";

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
          {(() => {
            const page = book.pages[Math.min(pageCursor, book.pages.length - 1)] ?? book.pages[0]!;
            return (
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
                  {styleView?.style.compose === "panels" ? (
                    <span
                      data-compose-badge="panels"
                      className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent"
                    >
                      {t("Panel by panel composite")}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pageCursor <= 0}
                    onClick={() => setPageCursor((cursor) => Math.max(0, cursor - 1))}
                    className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink disabled:opacity-40"
                  >
                    {t("Previous")}
                  </button>
                  <span className="text-xs text-ink-muted">
                    {pageCursor + 1}/{book.pages.length}
                  </span>
                  <button
                    type="button"
                    disabled={pageCursor >= book.pages.length - 1}
                    onClick={() => setPageCursor((cursor) => Math.min(book.pages.length - 1, cursor + 1))}
                    className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink disabled:opacity-40"
                  >
                    {t("Next")}
                  </button>
                {page.lettering.length > 0 && isOverlayMode ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-muted">
                    <ChatCircleDots size={14} className="text-accent" />
                    {page.lettering.length} {t("speech balloons & narration")}
                  </span>
                ) : null}
                </div>
              </div>

              {/* Comic Book Art Canvas with Quad-Anchored Speech Balloon & Narration Overlay */}
              <figure
                data-testid="comics-page-image"
                className="relative mt-4 overflow-hidden rounded-xl border-2 border-neutral-800 bg-neutral-950/5 shadow-md dark:border-neutral-700"
              >
                <img
                  src={studioImageUrl(projectId, page.pageImage)}
                  alt={t("Page {n}", { n: page.index + 1 })}
                  className="block w-full object-contain"
                  loading="eager"
                />

                {/* Only render lettering layer when overlay mode is enabled */}
                {isOverlayMode && page.lettering.length > 0 ? (
                  <div
                    data-testid="comics-lettering"
                    className="pointer-events-none absolute inset-0"
                  >
                    {page.lettering.map((balloon) => {
                      const kind = balloon.kind ?? "speech";
                      const isNarration = kind === "narration";
                      const anchor = balloon.anchor ?? (isNarration ? "tl" : "tr");
                      const boundsStyle = panelBoundsStyle(balloon.panelIndex, page.panels.length);
                      const anchorClass = anchorPositionClass(anchor);

                      return (
                        <div
                          key={balloon.id}
                          style={boundsStyle}
                          className="absolute pointer-events-none p-2 sm:p-3"
                        >
                          <div className={`relative w-full h-full flex ${anchorClass}`}>
                            {isNarration ? (
                              /* Narration Box: Top/Bottom rectangular ink banner, no tail */
                              <div
                                data-testid="speech-balloon"
                                data-balloon-kind="narration"
                                data-speaker={balloon.speaker || "Narrator"}
                                data-shot={balloon.shotId}
                                className="relative max-w-[90%] rounded-lg border-2 border-neutral-900 bg-amber-50/98 dark:bg-neutral-900/98 dark:border-neutral-600 px-3 py-1.5 shadow-md"
                              >
                                <span className="mb-0.5 inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.2 text-[8px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300">
                                  <BookOpen size={9} weight="bold" />
                                  {t("Narration")}
                                </span>
                                <span className="block text-[11px] font-bold leading-tight font-serif italic text-neutral-900 dark:text-neutral-100">
                                  {balloon.text}
                                </span>
                              </div>
                            ) : (
                              /* Speech Balloon: Rounded bubble with directional tail */
                              <div
                                data-testid="speech-balloon"
                                data-balloon-kind="speech"
                                data-speaker={balloon.speaker}
                                data-shot={balloon.shotId}
                                className={`relative max-w-[85%] rounded-2xl border-2 border-neutral-900 bg-white/98 dark:bg-neutral-900/98 dark:border-neutral-500 px-3.5 py-1.5 shadow-md ${speechTailClass(
                                  anchor,
                                )}`}
                              >
                                {balloon.speaker ? (
                                  <span className="mb-0.5 inline-block rounded bg-accent/10 px-1.5 py-0.2 text-[9px] font-black uppercase tracking-wider text-accent">
                                    {balloon.speaker}
                                  </span>
                                ) : null}
                                <span className="block text-xs font-semibold leading-snug tracking-tight text-neutral-900 dark:text-neutral-100">
                                  {balloon.text}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </figure>
            </li>
            );
          })()}
        </ol>
      )}
    </div>
  );
}

function panelBoundsStyle(panelIndex: number, totalPanels: number): React.CSSProperties {
  if (totalPanels <= 1) {
    return { top: "0%", left: "0%", width: "100%", height: "100%" };
  }
  if (totalPanels === 2) {
    return {
      top: panelIndex === 0 ? "0%" : "50%",
      left: "0%",
      width: "100%",
      height: "50%",
    };
  }
  if (totalPanels === 3) {
    if (panelIndex === 0) return { top: "0%", left: "0%", width: "50%", height: "50%" };
    if (panelIndex === 1) return { top: "0%", left: "50%", width: "50%", height: "50%" };
    return { top: "50%", left: "0%", width: "100%", height: "50%" };
  }
  const row = Math.floor(panelIndex / 2);
  const col = panelIndex % 2;
  return {
    top: `${row * 50}%`,
    left: `${col * 50}%`,
    width: "50%",
    height: "50%",
  };
}

function anchorPositionClass(anchor: string): string {
  switch (anchor) {
    case "tl":
      return "items-start justify-start text-left";
    case "bl":
      return "items-end justify-start text-left";
    case "br":
      return "items-end justify-end text-right";
    case "tr":
    default:
      return "items-start justify-end text-right";
  }
}

function speechTailClass(anchor: string): string {
  switch (anchor) {
    case "tl":
      return "after:absolute after:-bottom-1.5 after:left-3 after:h-2.5 after:w-2.5 after:rotate-45 after:border-b-2 after:border-r-2 after:border-neutral-900 after:bg-white dark:after:bg-neutral-900 dark:after:border-neutral-500 after:content-['']";
    case "bl":
      return "after:absolute after:-top-1.5 after:left-3 after:h-2.5 after:w-2.5 after:rotate-45 after:border-t-2 after:border-l-2 after:border-neutral-900 after:bg-white dark:after:bg-neutral-900 dark:after:border-neutral-500 after:content-['']";
    case "br":
      return "after:absolute after:-top-1.5 after:right-3 after:h-2.5 after:w-2.5 after:rotate-45 after:border-t-2 after:border-r-2 after:border-neutral-900 after:bg-white dark:after:bg-neutral-900 dark:after:border-neutral-500 after:content-['']";
    case "tr":
    default:
      return "after:absolute after:-bottom-1.5 after:right-3 after:h-2.5 after:w-2.5 after:rotate-45 after:border-b-2 after:border-r-2 after:border-neutral-900 after:bg-white dark:after:bg-neutral-900 dark:after:border-neutral-500 after:content-['']";
  }
}
