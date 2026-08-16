"use client";

import { useEffect, useState } from "react";
import type { StudioProject } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { countStoryTree, getStudioTree, listStudioEntities } from "./api";
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
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void Promise.all([
        getStudioTree(project.id),
        listStudioEntities(project.id, "character"),
        listStudioEntities(project.id, "location"),
      ])
        .then(([tree, characters, locations]) => {
          if (cancelled) {
            return;
          }
          setCounts({
            ...countStoryTree(tree),
            characters: characters.length,
            locations: locations.length,
          });
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

  const items = counts
    ? [
        { label: t("Volumes"), value: counts.volumes },
        { label: t("Chapters"), value: counts.chapters },
        { label: t("Scenes"), value: counts.scenes },
        { label: t("Characters"), value: counts.characters },
        { label: t("Locations"), value: counts.locations },
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-[780px] px-5 py-10 sm:px-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Overview")}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{project.title}</h1>
      <p className="mt-3 text-sm text-ink-muted">
        <span className="font-semibold text-ink">{t("Project folder")}</span>
        <span className="mt-1 block font-mono text-ink-faint">{project.id}</span>
      </p>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <dl className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {counts
          ? items.map((item) => (
              <div key={item.label} className="rounded-xl border border-line bg-surface-raised px-4 py-4">
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{item.label}</dt>
                <dd className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-ink">{formatNumber(item.value)}</dd>
              </div>
            ))
          : ["volumes", "chapters", "scenes", "characters", "locations"].map((key) => (
              <div key={key} className="h-24 animate-pulse rounded-xl border border-line bg-surface-muted" />
            ))}
      </dl>

      <div className="mt-8 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={() => onOpenSection("story")}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"
        >
          {t("Story")}
        </button>
        <button
          type="button"
          onClick={() => onOpenSection("entities")}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
        >
          {t("Entities")}
        </button>
        <button
          type="button"
          onClick={() => onOpenSection("workflow")}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
        >
          {t("Workflow")}
        </button>
        <button
          type="button"
          onClick={() => onOpenSection("outputs")}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
        >
          {t("Outputs")}
        </button>
      </div>
    </div>
  );
}
