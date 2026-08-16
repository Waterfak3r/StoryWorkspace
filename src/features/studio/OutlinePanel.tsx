"use client";

import { useEffect, useState } from "react";
import type { StudioStoryOutline, StudioStoryOutlineScene } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { getStudioOutline } from "./api";

export function OutlinePanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [outline, setOutline] = useState<StudioStoryOutline | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void getStudioOutline(projectId)
        .then((next) => {
          if (!cancelled) {
            setOutline(next);
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
  }, [projectId, t]);

  return (
    <div className="mx-auto w-full max-w-[920px] px-5 py-8 sm:px-8" data-story-outline="true">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Story outline")}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">{outline?.title ?? t("Story outline")}</h1>
      <p className="mt-2 text-sm text-ink-muted">{t("A read-only map of plot, places, and entities for this project.")}</p>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {!outline && !error ? (
        <div className="mt-8 space-y-3">
          <div className="h-28 animate-pulse rounded-xl border border-line bg-surface-muted" />
          <div className="h-28 animate-pulse rounded-xl border border-line bg-surface-muted" />
        </div>
      ) : null}

      {outline ? (
        <div className="mt-8 space-y-8">
          {outline.volumes.map((volume) => (
            <section key={volume.id} className="space-y-4">
              <h2 className="text-lg font-semibold text-ink">{volume.title}</h2>
              {volume.chapters.map((chapter) => (
                <div key={chapter.id} className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-faint">{chapter.title}</h3>
                  {chapter.scenes.length === 0 ? (
                    <p className="text-sm text-ink-muted">{t("No scenes in this chapter.")}</p>
                  ) : (
                    chapter.scenes.map((scene) => <OutlineSceneCard key={scene.id} scene={scene} />)
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OutlineSceneCard({ scene }: { scene: StudioStoryOutlineScene }) {
  const { t } = useI18n();
  const plot = scene.plot.trim();
  const preview = plot.length > 360 ? `${plot.slice(0, 360).trim()}…` : plot;

  return (
    <article className="rounded-xl border border-line bg-surface-raised px-4 py-4" data-outline-scene={scene.id}>
      <h4 className="text-base font-semibold text-ink">{scene.title}</h4>
      {scene.intent.trim() ? (
        <p className="mt-1 text-sm text-ink-muted">
          <span className="font-semibold text-ink">{t("Plot")}</span>
          {` · ${scene.intent}`}
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-muted">{t("Plot")}</p>
      )}
      {preview ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">{preview}</p> : (
        <p className="mt-2 text-sm text-ink-faint">{t("No plot text yet.")}</p>
      )}
      <dl className="mt-3 space-y-1 text-sm">
        <div>
          <dt className="inline font-semibold text-ink">{t("Setting")}</dt>
          <dd className="ml-2 inline text-ink-muted">{scene.environment?.name ?? t("No setting linked")}</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">{t("Entities")}</dt>
          <dd className="ml-2 inline text-ink-muted">
            {scene.entities.length > 0 ? scene.entities.map((entity) => entity.name).join(" · ") : t("No entities linked")}
          </dd>
        </div>
      </dl>
      {scene.beats.length > 0 ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
          {scene.beats.map((beat) => (
            <li key={beat.id}>
              <span className="font-semibold text-ink">{beat.purpose}</span>
              {` — ${beat.action} (${beat.camera})`}
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}
