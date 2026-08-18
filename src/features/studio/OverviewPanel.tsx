"use client";

import { useEffect, useState } from "react";
import {
  Images,
  ListNumbers,
  Notebook,
  PaintBrush,
  Palette,
  Sparkle,
  TreeStructure,
  UsersThree,
} from "@phosphor-icons/react";
import type { ComicsStylePresetId, StudioProject } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import {
  countStoryTree,
  getStudioStyle,
  getStudioTree,
  listStudioEntities,
  saveStudioStyle,
  type StudioStyleView,
} from "./api";
import type { StudioSection } from "./sections";

export function OverviewPanel({
  project,
  onOpenSection,
}: {
  project: StudioProject;
  onOpenSection: (section: StudioSection) => void;
}) {
  const { t, formatNumber } = useI18n();
  const [counts, setCounts] = useState<{
    volumes: number;
    chapters: number;
    scenes: number;
    characters: number;
    locations: number;
    props: number;
    costumes: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [styleView, setStyleView] = useState<StudioStyleView | null>(null);
  const [styleBusy, setStyleBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void Promise.all([
        getStudioTree(project.id),
        listStudioEntities(project.id, "character"),
        listStudioEntities(project.id, "location"),
        listStudioEntities(project.id, "prop"),
        listStudioEntities(project.id, "costume"),
        getStudioStyle(project.id),
      ])
        .then(([tree, characters, locations, props, costumes, nextStyle]) => {
          if (cancelled) {
            return;
          }
          setCounts({
            ...countStoryTree(tree),
            characters: characters.length,
            locations: locations.length,
            props: props.length,
            costumes: costumes.length,
          });
          setStyleView(nextStyle);
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
  }, [project.id, t]);

  const structureItems = counts
    ? [
        { label: t("Volumes"), value: counts.volumes },
        { label: t("Chapters"), value: counts.chapters },
        { label: t("Scenes"), value: counts.scenes },
      ]
    : [];

  const bibleItems = counts
    ? [
        { label: t("Characters"), value: counts.characters },
        { label: t("Locations"), value: counts.locations },
        { label: t("Props"), value: counts.props },
        { label: t("Costumes"), value: counts.costumes },
      ]
    : [];

  const currentPreset = styleView?.presets.find(
    (preset) => preset.id === (styleView.style.presetId ?? "sequential-ink"),
  ) ?? styleView?.presets[0];

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-8 sm:px-8">
      {/* Header section */}
      <div className="border-b border-line pb-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Overview")}</p>
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{project.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span className="font-semibold text-ink">{t("Project folder")}:</span>
          <code className="rounded bg-surface-muted px-2 py-0.5 font-mono text-ink-muted">{project.id}</code>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/* Comics style art direction card */}
      <div className="mt-8 rounded-2xl border border-line bg-surface-raised p-5 shadow-xs sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Palette size={22} weight="duotone" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">
                {t("Comics style")}
              </h2>
              <p className="text-xs text-ink-muted">{t("The drawing style used when generating comics pages.")}</p>
            </div>
          </div>
          {styleBusy ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
              <Sparkle size={13} className="animate-spin" />
              {t("Saving")}
            </span>
          ) : null}
        </div>

        {/* 1. Visual Drawing Style (Full width top) */}
        <div className="mt-5">
          <label htmlFor="comics-style" className="block text-sm font-semibold text-ink">
            {t("Comics style preset")}
          </label>
          <select
            id="comics-style"
            data-comics-style="true"
            disabled={styleBusy || !styleView}
            value={styleView?.style.presetId ?? "sequential-ink"}
            onChange={(event) => {
              const presetId = event.target.value as ComicsStylePresetId;
              const currentLettering = styleView?.style.lettering ?? "model";
              const currentCompose = styleView?.style.compose ?? "page";
              const currentLayout = styleView?.style.layout ?? "auto";
              setStyleBusy(true);
              void saveStudioStyle(project.id, {
                presetId,
                lettering: currentLettering,
                compose: currentCompose,
                layout: currentLayout,
              })
                .then((next) => {
                  setStyleView(next);
                  setError("");
                })
                .catch((cause) => {
                  setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
                })
                .finally(() => {
                  setStyleBusy(false);
                });
            }}
            className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-4 focus:ring-accent/15"
          >
            {(styleView?.presets ?? []).map((preset) => (
              <option key={preset.id} value={preset.id}>
                {t(preset.label)}
              </option>
            ))}
          </select>
          {currentPreset?.visual ? (
            <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-line/70 bg-surface px-3.5 py-2 text-xs text-ink-muted">
              <PaintBrush size={15} weight="regular" className="mt-0.5 shrink-0 text-accent" />
              <p className="leading-relaxed">
                <span className="font-semibold text-ink">{t("Prompt directive")}: </span>
                {currentPreset.visual}
              </p>
            </div>
          ) : null}
        </div>

        {/* 2-Column Grid for compose, layout, and lettering */}
        <div className="mt-5 border-t border-line/70 pt-5 grid gap-5 sm:grid-cols-2">
          {/* Generation Unit / Compose Mode */}
          <div>
            <label htmlFor="compose-mode" className="block text-sm font-semibold text-ink">
              {t("Generation method")}
            </label>
            <select
              id="compose-mode"
              data-compose-mode="true"
              disabled={styleBusy || !styleView}
              value={styleView?.style.compose ?? "page"}
              onChange={(event) => {
                const compose = event.target.value as "page" | "panels";
                const currentPresetId = (styleView?.style.presetId ?? "sequential-ink") as ComicsStylePresetId;
                const currentLettering = styleView?.style.lettering ?? "model";
                const currentLayout = styleView?.style.layout ?? "auto";
                setStyleBusy(true);
                void saveStudioStyle(project.id, {
                  presetId: currentPresetId,
                  lettering: currentLettering,
                  compose,
                  layout: currentLayout,
                })
                  .then((next) => {
                    setStyleView(next);
                    setError("");
                  })
                  .catch((cause) => {
                    setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
                  })
                  .finally(() => {
                    setStyleBusy(false);
                  });
              }}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-4 focus:ring-accent/15"
            >
              <option value="page">{t("Full page at once")}</option>
              <option value="panels">{t("Panel by panel compose")}</option>
            </select>
            <p className="mt-1.5 text-xs leading-normal text-ink-muted">
              {t("Choose whether AI renders full pages at once or stitches individual panels.")}
            </p>
          </div>

          {/* Page Layout */}
          <div>
            <label htmlFor="page-layout" className="block text-sm font-semibold text-ink">
              {t("Page layout")}
            </label>
            <select
              id="page-layout"
              data-page-layout="true"
              disabled={styleBusy || !styleView}
              value={styleView?.style.layout ?? "auto"}
              onChange={(event) => {
                const layout = event.target.value as "2" | "3" | "4" | "auto" | "marvel";
                const currentPresetId = (styleView?.style.presetId ?? "sequential-ink") as ComicsStylePresetId;
                const currentLettering = styleView?.style.lettering ?? "model";
                const currentCompose = styleView?.style.compose ?? "page";
                setStyleBusy(true);
                void saveStudioStyle(project.id, {
                  presetId: currentPresetId,
                  lettering: currentLettering,
                  compose: currentCompose,
                  layout,
                })
                  .then((next) => {
                    setStyleView(next);
                    setError("");
                  })
                  .catch((cause) => {
                    setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
                  })
                  .finally(() => {
                    setStyleBusy(false);
                  });
              }}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-4 focus:ring-accent/15"
            >
              <option value="auto">{t("Director decides")}</option>
              <option value="2">{t("2 panels")}</option>
              <option value="3">{t("3 panels")}</option>
              <option value="4">{t("4 panels")}</option>
              <option value="marvel">{t("Marvel irregular")}</option>
            </select>
            <p className="mt-1.5 text-xs leading-normal text-ink-muted">
              {t("Set fixed panel count per page, director-driven pacing, or dynamic Marvel irregular framing.")}
            </p>
          </div>

          {/* Lettering Mode Selection (Spans full width across columns) */}
          <div className="sm:col-span-2">
            <label htmlFor="lettering-mode" className="block text-sm font-semibold text-ink">
              {t("Page lettering")}
            </label>
            <select
              id="lettering-mode"
              data-lettering-mode="true"
              disabled={styleBusy || !styleView}
              value={styleView?.style.lettering ?? "model"}
              onChange={(event) => {
                const lettering = event.target.value as "model" | "overlay";
                const currentPresetId = (styleView?.style.presetId ?? "sequential-ink") as ComicsStylePresetId;
                const currentCompose = styleView?.style.compose ?? "page";
                const currentLayout = styleView?.style.layout ?? "auto";
                setStyleBusy(true);
                void saveStudioStyle(project.id, {
                  presetId: currentPresetId,
                  lettering,
                  compose: currentCompose,
                  layout: currentLayout,
                })
                  .then((next) => {
                    setStyleView(next);
                    setError("");
                  })
                  .catch((cause) => {
                    setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
                  })
                  .finally(() => {
                    setStyleBusy(false);
                  });
              }}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-4 focus:ring-accent/15"
            >
              <option value="model">{t("AI model lettering (draw text in image)")}</option>
              <option value="overlay">{t("Late lettering overlay (clean typography on top)")}</option>
            </select>
            <p className="mt-1.5 text-xs leading-normal text-ink-muted">
              {t("Choose whether AI draws text directly into the panels or overlays typography cleanly.")}
            </p>
          </div>
        </div>
      </div>

      {/* Story statistics in clean thematic groupings */}
      <div className="mt-8 space-y-6">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {t("Story structure")}
          </h2>
          <dl className="mt-3 grid gap-3 grid-cols-3">
            {counts
              ? structureItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border border-line bg-surface-raised px-4 py-3.5 transition-shadow hover:shadow-xs"
                  >
                    <dt className="text-xs font-medium text-ink-muted">{item.label}</dt>
                    <dd className="mt-1.5 text-2xl font-bold tracking-tight text-ink">{formatNumber(item.value)}</dd>
                  </div>
                ))
              : [1, 2, 3].map((key) => (
                  <div key={key} className="h-20 animate-pulse rounded-xl border border-line bg-surface-muted" />
                ))}
          </dl>
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {t("Continuity & world bible")}
          </h2>
          <dl className="mt-3 grid gap-3 grid-cols-2 sm:grid-cols-4">
            {counts
              ? bibleItems.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border border-line bg-surface-raised px-4 py-3.5 transition-shadow hover:shadow-xs"
                  >
                    <dt className="text-xs font-medium text-ink-muted">{item.label}</dt>
                    <dd className="mt-1.5 text-2xl font-bold tracking-tight text-ink">{formatNumber(item.value)}</dd>
                  </div>
                ))
              : [1, 2, 3, 4].map((key) => (
                  <div key={key} className="h-20 animate-pulse rounded-xl border border-line bg-surface-muted" />
                ))}
          </dl>
        </div>
      </div>

      {/* Studio Workspace launchpad */}
      <div className="mt-10 border-t border-line pt-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
          {t("Open studio workspace")}
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <button
            type="button"
            onClick={() => onOpenSection("story")}
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-accent px-4 py-3 text-center text-sm font-semibold text-on-accent shadow-xs transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"
          >
            <Notebook size={20} weight="bold" />
            <span>{t("Story")}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenSection("outline")}
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface-raised px-4 py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-surface-muted active:translate-y-px"
          >
            <ListNumbers size={20} weight="regular" className="text-ink-muted" />
            <span>{t("Story outline")}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenSection("entities")}
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface-raised px-4 py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-surface-muted active:translate-y-px"
          >
            <UsersThree size={20} weight="regular" className="text-ink-muted" />
            <span>{t("Entities")}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenSection("workflow")}
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface-raised px-4 py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-surface-muted active:translate-y-px"
          >
            <TreeStructure size={20} weight="regular" className="text-ink-muted" />
            <span>{t("Workflow")}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenSection("outputs")}
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border border-line bg-surface-raised px-4 py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-surface-muted active:translate-y-px"
          >
            <Images size={20} weight="regular" className="text-ink-muted" />
            <span>{t("Outputs")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

