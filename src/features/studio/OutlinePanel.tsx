"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ListNumbers,
  MapPin,
  Quotes,
  User,
  Users,
} from "@phosphor-icons/react";
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
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-8" data-story-outline="true">
      {/* Header section */}
      <div className="border-b border-line pb-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Story outline")}</p>
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
          {outline?.title ?? t("Story outline")}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {t("Connected narrative beat chain and character continuity matrix across scenes.")}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {!outline && !error ? (
        <div className="mt-8 space-y-4">
          <div className="h-32 animate-pulse rounded-2xl border border-line bg-surface-muted" />
          <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface-muted" />
        </div>
      ) : null}

      {outline ? (
        <OutlineTimeline
          outline={outline}
          selectedEventId={selected?.event.id ?? null}
          onSelectEvent={setSelectedEventId}
        />
      ) : null}

      {/* Selected Beat Inspector */}
      {selected?.scene ? (
        <div
          className="mt-8 rounded-2xl border border-line bg-surface-raised p-5 shadow-xs sm:p-6"
          data-timeline-detail={selected.event.id}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-on-accent">
                {t("Beat {n}", { n: selected.event.sequence + 1 })}
              </span>
              <h2 className="text-lg font-bold tracking-tight text-ink">{selected.event.title}</h2>
            </div>
            {selected.scene.environment ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink">
                <MapPin size={14} className="text-accent" />
                {selected.scene.environment.name}
              </span>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {selected.scene.intent.trim() ? (
              <div className="rounded-xl border border-line/70 bg-surface p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  <Quotes size={15} className="text-accent" />
                  <span>{t("Dramatic intent")}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink">{selected.scene.intent}</p>
              </div>
            ) : null}

            {selected.event.participantIds.length > 0 ? (
              <div className="rounded-xl border border-line/70 bg-surface p-4">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  <Users size={15} className="text-accent" />
                  <span>{t("Characters present")}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {selected.event.participantIds.map((charId) => {
                    const char = outline?.timeline.characters.find((c) => c.id === charId);
                    return (
                      <span
                        key={charId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-accent/20 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-ink"
                      >
                        <User size={13} className="text-accent" />
                        {char?.name ?? charId}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
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
  const { events, characters, intersections, connections } = outline.timeline;
  const present = new Set(intersections.map((hit) => `${hit.characterId}:${hit.eventId}`));
  const linked = new Set(connections.map((link) => `${link.fromEventId}->${link.toEventId}`));

  return (
    <div
      className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-xs"
      data-outline-timeline="true"
    >
      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <ListNumbers size={32} className="text-ink-faint" />
          <p className="mt-3 text-sm font-medium text-ink-muted">{t("No events on the timeline yet.")}</p>
        </div>
      ) : (
        <div>
          {/* Narrative Beat Chain Track */}
          <div className="border-b border-line bg-surface/50 p-4">
            <div className="flex items-center gap-2 pb-3">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {t("Narrative sequence")}
              </span>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                {events.length} {t("Beats")}
              </span>
            </div>
            <ol
              className="flex min-w-max items-center gap-0 overflow-x-auto pb-2"
              data-timeline-chain="true"
            >
              {events.map((event, index) => {
                const next = events[index + 1];
                const linkId = next ? `${event.id}->${next.id}` : "";
                const connected = next ? linked.has(linkId) : false;
                const isSelected = selectedEventId === event.id;
                const participantCount = intersections.filter((hit) => hit.eventId === event.id).length;

                return (
                  <li key={event.id} className="flex min-w-44 items-center">
                    <button
                      type="button"
                      data-timeline-event={event.id}
                      data-timeline-sequence={event.sequence}
                      onClick={() => onSelectEvent(event.id)}
                      className={`group relative flex min-w-40 flex-col rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] ${
                        isSelected
                          ? "border-accent bg-accent-soft/80 shadow-xs ring-2 ring-accent/25"
                          : "border-line bg-surface hover:border-accent/40 hover:bg-surface-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isSelected ? "bg-accent text-on-accent" : "bg-surface-muted text-ink-faint"
                          }`}
                        >
                          {t("Beat")} {event.sequence + 1}
                        </span>
                        {participantCount > 0 ? (
                          <span className="flex items-center gap-1 text-[11px] font-medium text-ink-muted">
                            <User size={12} className={isSelected ? "text-accent" : "text-ink-faint"} />
                            {participantCount}
                          </span>
                        ) : null}
                      </div>
                      <span className="mt-2 line-clamp-2 text-xs font-semibold text-ink">{event.title}</span>
                    </button>
                    {next ? (
                      <div className="flex items-center">
                        <span
                          data-timeline-link={linkId}
                          data-connected={connected ? "true" : "false"}
                          className="mx-1 h-0.5 min-w-8 flex-1 bg-accent/80 transition-colors"
                          aria-hidden="true"
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Character Presence Continuity Matrix */}
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="sticky left-0 z-10 min-w-44 border-r border-line bg-surface px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-ink-muted shadow-xs">
                    <div className="flex items-center gap-2">
                      <Users size={16} className="text-accent" />
                      <span>{t("Characters")}</span>
                    </div>
                  </th>
                  {events.map((event) => {
                    const isSelected = selectedEventId === event.id;
                    return (
                      <th
                        key={event.id}
                        className={`min-w-40 border-r border-line/70 px-3 py-3 text-left font-normal transition-colors ${
                          isSelected ? "bg-accent-soft/30" : ""
                        }`}
                      >
                        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                          {t("Beat")} {event.sequence + 1}
                        </span>
                        <span className="mt-1 block truncate text-xs font-semibold text-ink">{event.title}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {characters.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-ink-faint" colSpan={events.length + 1}>
                      {t("No characters to plot yet.")}
                    </td>
                  </tr>
                ) : (
                  characters.map((character, rowIndex) => {
                    const characterBeatsCount = intersections.filter((hit) => hit.characterId === character.id).length;
                    return (
                      <tr
                        key={character.id}
                        data-timeline-lane={character.id}
                        className={`border-b border-line/60 transition-colors hover:bg-surface-muted/50 ${
                          rowIndex % 2 === 0 ? "bg-surface-raised" : "bg-surface/30"
                        }`}
                      >
                        <th className="sticky left-0 z-10 border-r border-line bg-surface-raised px-4 py-3.5 text-left font-semibold text-ink shadow-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 truncate">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">
                                {character.name.slice(0, 1).toUpperCase()}
                              </div>
                              <span className="truncate">{character.name}</span>
                            </div>
                            <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                              {characterBeatsCount}
                            </span>
                          </div>
                        </th>
                        {events.map((event) => {
                          const hit = present.has(`${character.id}:${event.id}`);
                          const isSelected = selectedEventId === event.id;
                          return (
                            <td
                              key={`${character.id}:${event.id}`}
                              data-timeline-cell={`${character.id}:${event.id}`}
                              data-present={hit ? "true" : "false"}
                              className={`border-r border-line/50 px-3 py-3.5 text-center transition-colors ${
                                isSelected ? "bg-accent-soft/20" : ""
                              }`}
                            >
                              {hit ? (
                                <button
                                  type="button"
                                  aria-label={`${character.name} · ${event.title}`}
                                  onClick={() => onSelectEvent(event.id)}
                                  className="group inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-on-accent shadow-xs ring-4 ring-accent/15 transition-transform hover:scale-110 active:scale-95"
                                >
                                  <User size={13} weight="bold" />
                                </button>
                              ) : (
                                <span className="inline-flex h-2 w-2 rounded-full bg-line/60" aria-hidden="true" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
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

