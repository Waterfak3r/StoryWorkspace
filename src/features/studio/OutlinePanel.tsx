"use client";

import { useEffect, useMemo, useState } from "react";
import type { StudioStoryOutline, StudioStoryTimelineEvent } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { getStudioOutline } from "./api";

export function OutlinePanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [outline, setOutline] = useState<StudioStoryOutline | null>(null);
  const [error, setError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

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

  const selected = useMemo(() => {
    if (!outline) {
      return null;
    }
    const event =
      outline.timeline.events.find((item) => item.id === selectedEventId) ?? outline.timeline.events[0] ?? null;
    if (!event) {
      return null;
    }
    const scene = outline.volumes
      .find((volume) => volume.id === event.volumeId)
      ?.chapters.find((chapter) => chapter.id === event.chapterId)
      ?.scenes.find((item) => item.id === event.sceneId);
    return { event, scene: scene ?? null };
  }, [outline, selectedEventId]);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 sm:px-8" data-story-outline="true">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Story outline")}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink">{outline?.title ?? t("Story outline")}</h1>
      <p className="mt-2 text-sm text-ink-muted">{t("Who is in which event, in story order.")}</p>

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
        <OutlineTimeline
          outline={outline}
          selectedEventId={selected?.event.id ?? null}
          onSelectEvent={setSelectedEventId}
        />
      ) : null}

      {selected?.scene ? (
        <div className="mt-6 rounded-xl border border-line bg-surface-raised px-4 py-4" data-timeline-detail={selected.event.id}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
            {t("Event {n}", { n: selected.event.sequence + 1 })}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">{selected.event.title}</h2>
          {selected.scene.intent.trim() ? <p className="mt-2 text-sm text-ink-muted">{selected.scene.intent}</p> : null}
          {selected.scene.environment ? (
            <p className="mt-2 text-sm text-ink-muted">
              <span className="font-semibold text-ink">{t("Setting")}</span>
              {` · ${selected.scene.environment.name}`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OutlineTimeline({
  outline,
  selectedEventId,
  onSelectEvent,
}: {
  outline: StudioStoryOutline;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}) {
  const { t } = useI18n();
  const { events, characters, intersections } = outline.timeline;
  const present = new Set(intersections.map((hit) => `${hit.characterId}:${hit.eventId}`));

  return (
    <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-surface-raised" data-outline-timeline="true">
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-muted">{t("No events on the timeline yet.")}</p>
      ) : (
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-36 border-b border-line bg-surface-raised px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                {t("Characters")}
              </th>
              {events.map((event) => (
                <th key={event.id} className="min-w-36 border-b border-line px-2 py-3 text-left font-normal">
                  <button
                    type="button"
                    data-timeline-event={event.id}
                    data-timeline-sequence={event.sequence}
                    onClick={() => onSelectEvent(event.id)}
                    className={`block w-full rounded-lg px-2 py-1 text-left transition-colors ${
                      selectedEventId === event.id ? "bg-surface-muted text-ink" : "text-ink-muted hover:bg-surface-muted"
                    }`}
                  >
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                      {event.sequence + 1}
                    </span>
                    <span className="mt-1 block font-semibold text-ink">{event.title}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {characters.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-sm text-ink-faint" colSpan={events.length + 1}>
                  {t("No characters to plot yet.")}
                </td>
              </tr>
            ) : (
              characters.map((character) => (
                <tr key={character.id} data-timeline-lane={character.id}>
                  <th className="sticky left-0 z-10 border-t border-line bg-surface-raised px-3 py-3 text-left font-semibold text-ink">
                    {character.name}
                  </th>
                  {events.map((event) => {
                    const hit = present.has(`${character.id}:${event.id}`);
                    return (
                      <td
                        key={`${character.id}:${event.id}`}
                        data-timeline-cell={`${character.id}:${event.id}`}
                        data-present={hit ? "true" : "false"}
                        className="border-t border-line px-2 py-3 text-center"
                      >
                        {hit ? (
                          <button
                            type="button"
                            aria-label={`${character.name} · ${event.title}`}
                            onClick={() => onSelectEvent(event.id)}
                            className="inline-flex h-3.5 w-3.5 rounded-full bg-accent"
                          />
                        ) : (
                          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-line" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function eventParticipants(
  event: StudioStoryTimelineEvent,
  characterIds: readonly string[],
): string[] {
  return event.participantIds.filter((id) => characterIds.includes(id));
}
