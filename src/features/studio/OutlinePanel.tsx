"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  ListNumbers,
  MapPin,
  Package,
  Quotes,
  Sparkle,
  TreeStructure,
  TShirt,
  User,
  Users,
  X,
} from "@phosphor-icons/react";
import type {
  StudioEntityKind,
  StudioStoryOutline,
  StudioStoryTimelineEntity,
  StudioStoryTimelineEvent,
} from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { getStudioOutline } from "./api";

function entityKindIcon(kind: StudioEntityKind, isSelected: boolean) {
  switch (kind) {
    case "character":
      return <User size={14} weight={isSelected ? "bold" : "regular"} />;
    case "location":
      return <MapPin size={14} weight={isSelected ? "bold" : "regular"} />;
    case "prop":
      return <Package size={14} weight={isSelected ? "bold" : "regular"} />;
    case "costume":
      return <TShirt size={14} weight={isSelected ? "bold" : "regular"} />;
    default:
      return <Sparkle size={14} weight={isSelected ? "bold" : "regular"} />;
  }
}

function entityKindLabel(kind: StudioEntityKind): string {
  switch (kind) {
    case "character":
      return "Character";
    case "location":
      return "Location";
    case "prop":
      return "Prop";
    case "costume":
      return "Costume";
    default:
      return "Entity";
  }
}

export function OutlinePanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [outline, setOutline] = useState<StudioStoryOutline | null>(null);
  const [error, setError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

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

  const selectedEntity = useMemo(() => {
    if (!outline || !selectedEntityId) {
      return null;
    }
    return outline.timeline.entities.find((item) => item.id === selectedEntityId) ?? null;
  }, [outline, selectedEntityId]);

  const selected = useMemo(() => {
    if (!outline || selectedEntity) {
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
  }, [outline, selectedEventId, selectedEntity]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-8" data-story-outline="true">
      {/* Header section */}
      <div className="border-b border-line pb-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Story outline")}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {outline?.title ?? t("Story outline")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {t("Connected narrative beat chain and character continuity matrix across scenes.")}
            </p>
          </div>
          {outline ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink shadow-2xs">
                <ListNumbers size={14} className="text-accent" />
                <span>{outline.timeline.events.length}</span>
                <span className="font-normal text-ink-muted">{t("Beats")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink shadow-2xs">
                <TreeStructure size={14} className="text-accent" />
                <span>{outline.timeline.entities.length}</span>
                <span className="font-normal text-ink-muted">{t("Entities")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink shadow-2xs">
                <Users size={14} className="text-accent" />
                <span>{outline.timeline.characters.length}</span>
                <span className="font-normal text-ink-muted">{t("Characters")}</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {!outline && !error ? (
        <div className="mt-8 space-y-4">
          <div className="h-36 animate-pulse rounded-2xl border border-line bg-surface-muted" />
          <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface-muted" />
        </div>
      ) : null}

      {outline ? (
        <OutlineTimeline
          outline={outline}
          selectedEventId={selectedEntity ? null : selected?.event.id ?? null}
          selectedEntityId={selectedEntity?.id ?? null}
          onSelectEvent={(eventId) => {
            setSelectedEntityId(null);
            setSelectedEventId(eventId);
          }}
          onSelectEntity={(entityId) => {
            setSelectedEventId(null);
            setSelectedEntityId(entityId);
          }}
        />
      ) : null}

      {/* Selected Entity Inspector */}
      {outline && selectedEntity ? (
        <EntityInspector
          outline={outline}
          entity={selectedEntity}
          onSelectEvent={(eventId) => {
            setSelectedEntityId(null);
            setSelectedEventId(eventId);
          }}
          onDeselect={() => setSelectedEntityId(null)}
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
              <span className="inline-flex items-center justify-center rounded-lg bg-accent px-3 py-1 text-xs font-bold text-on-accent shadow-2xs">
                {t("Beat {n}", { n: selected.event.sequence + 1 })}
              </span>
              <h2 className="text-lg font-bold tracking-tight text-ink">{selected.event.title}</h2>
            </div>
            {selected.scene.environment ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink shadow-2xs">
                <MapPin size={14} className="text-accent" />
                {selected.scene.environment.name}
              </span>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {selected.scene.intent.trim() ? (
              <div className="rounded-xl border border-line/70 bg-surface p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
                  <Quotes size={15} className="text-accent" />
                  <span>{t("Dramatic intent")}</span>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-ink">{selected.scene.intent}</p>
              </div>
            ) : null}

            {selected.event.participantIds.length > 0 ? (
              <div className="rounded-xl border border-line/70 bg-surface p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
                  <Users size={15} className="text-accent" />
                  <span>{t("Characters present")}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {selected.event.participantIds.map((charId) => {
                    const char = outline?.timeline.characters.find((c) => c.id === charId);
                    return (
                      <span
                        key={charId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-accent/25 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-ink"
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
          {outline ? <EventStateChanges outline={outline} eventId={selected.event.id} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function OutlineTimeline({
  outline,
  selectedEventId,
  selectedEntityId,
  onSelectEvent,
  onSelectEntity,
}: {
  outline: StudioStoryOutline;
  selectedEventId: string | null;
  selectedEntityId: string | null;
  onSelectEvent: (eventId: string) => void;
  onSelectEntity: (entityId: string) => void;
}) {
  const { t } = useI18n();
  const { events, characters, intersections, connections, entities } = outline.timeline;
  const [kindFilter, setKindFilter] = useState<string>("all");

  const present = new Set(intersections.map((hit) => `${hit.characterId}:${hit.eventId}`));
  const linked = new Set(connections.map((link) => `${link.fromEventId}->${link.toEventId}`));

  const kindsPresent = useMemo(() => {
    const set = new Set<StudioEntityKind>();
    for (const item of entities) {
      set.add(item.kind);
    }
    return Array.from(set);
  }, [entities]);

  const filteredEntities = useMemo(() => {
    if (kindFilter === "all") {
      return entities;
    }
    return entities.filter((item) => item.kind === kindFilter);
  }, [entities, kindFilter]);

  const selectedEntity = useMemo(() => {
    if (!selectedEntityId) {
      return null;
    }
    return entities.find((item) => item.id === selectedEntityId) ?? null;
  }, [entities, selectedEntityId]);

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
          {/* Living Story Entity Index / Reusable Units Map */}
          {entities.length > 0 ? (
            <div className="border-b border-line bg-surface/40">
              {/* Shelf Top Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 text-accent">
                    <TreeStructure size={14} />
                  </span>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">
                      {t("Living story entities")}
                    </h2>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                      {entities.length}
                    </span>
                  </div>
                </div>

                {/* Filter controls */}
                {kindsPresent.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setKindFilter("all")}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        kindFilter === "all"
                          ? "bg-ink text-canvas shadow-2xs"
                          : "bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink"
                      }`}
                    >
                      {t("All kinds")} ({entities.length})
                    </button>
                    {kindsPresent.map((kind) => {
                      const count = entities.filter((item) => item.kind === kind).length;
                      return (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setKindFilter(kind)}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            kindFilter === kind
                              ? "bg-ink text-canvas shadow-2xs"
                              : "bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink"
                          }`}
                        >
                          {t(entityKindLabel(kind))} ({count})
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* Entity Tokens Grid */}
              <div className="flex flex-wrap gap-2.5 p-4 sm:p-5">
                {filteredEntities.map((entity) => {
                  const isSelected = selectedEntityId === entity.id;
                  const appearanceCount = entity.appearanceEventIds.length;

                  return (
                    <button
                      key={entity.id}
                      type="button"
                      data-outline-entity={entity.id}
                      onClick={() => onSelectEntity(entity.id)}
                      className={`group relative inline-flex items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition-all duration-150 ${
                        isSelected
                          ? "border-accent bg-accent-soft/90 text-ink shadow-xs ring-2 ring-accent/30 scale-[1.01]"
                          : "border-line bg-surface text-ink hover:border-accent/40 hover:bg-surface-muted/60 shadow-2xs"
                      }`}
                    >
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                          isSelected
                            ? "bg-accent text-on-accent shadow-2xs"
                            : "bg-surface-muted text-ink-muted group-hover:bg-accent-soft group-hover:text-accent"
                        }`}
                      >
                        {entityKindIcon(entity.kind, isSelected)}
                      </div>

                      <div className="min-w-0 pr-1">
                        <span className="block truncate text-xs font-bold text-ink">{entity.name}</span>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                          <span className="font-semibold uppercase tracking-wider text-ink-faint">
                            {t(entityKindLabel(entity.kind))}
                          </span>
                          <span className="text-ink-faint/50">·</span>
                          <span
                            className={`font-semibold ${
                              isSelected ? "text-accent" : "text-ink-muted"
                            }`}
                          >
                            {appearanceCount} {appearanceCount === 1 ? t("beat") : t("beats")}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Narrative Beat Chain Track */}
          <div className="border-b border-line bg-surface/20 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <ListNumbers size={13} />
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink">
                  {t("Narrative sequence")}
                </span>
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                  {events.length} {t("Beats")}
                </span>
              </div>
              <span className="hidden text-xs text-ink-faint sm:inline-block">
                {t("Sequential beat progression from scene to scene.")}
              </span>
            </div>

            <ol
              className="flex min-w-max items-center gap-0 overflow-x-auto pb-2 pt-1"
              data-timeline-chain="true"
            >
              {events.map((event, index) => {
                const next = events[index + 1];
                const linkId = next ? `${event.id}->${next.id}` : "";
                const connected = next ? linked.has(linkId) : false;
                const isSelected = selectedEventId === event.id;
                const participantCount = intersections.filter((hit) => hit.eventId === event.id).length;
                const isEntityInEvent = selectedEntity
                  ? selectedEntity.appearanceEventIds.includes(event.id)
                  : false;

                return (
                  <li key={event.id} className="flex min-w-48 items-center">
                    <button
                      type="button"
                      data-timeline-event={event.id}
                      data-timeline-sequence={event.sequence}
                      onClick={() => onSelectEvent(event.id)}
                      className={`group relative flex min-w-44 flex-col rounded-xl border p-3.5 text-left transition-all duration-150 ${
                        isSelected
                          ? "border-accent bg-accent-soft/90 shadow-xs ring-2 ring-accent/30 scale-[1.01]"
                          : isEntityInEvent
                            ? "border-accent/60 bg-accent-soft/30 shadow-2xs ring-1 ring-accent/25 hover:border-accent"
                            : "border-line bg-surface-raised hover:border-accent/40 hover:bg-surface shadow-2xs"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isSelected
                              ? "bg-accent text-on-accent"
                              : "bg-surface-muted text-ink-muted"
                          }`}
                        >
                          {t("Beat")} {event.sequence + 1}
                        </span>
                        {participantCount > 0 ? (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-ink-muted">
                            <User size={12} className={isSelected ? "text-accent" : "text-ink-faint"} />
                            {participantCount}
                          </span>
                        ) : null}
                      </div>

                      <span className="mt-2 line-clamp-2 text-xs font-bold leading-snug text-ink">
                        {event.title}
                      </span>

                      {isEntityInEvent ? (
                        <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-accent">
                          <Sparkle size={10} weight="fill" />
                          <span>{t("Entity in beat")}</span>
                        </div>
                      ) : null}
                    </button>

                    {next ? (
                      <div className="flex items-center px-1.5">
                        <span
                          data-timeline-link={linkId}
                          data-connected={connected ? "true" : "false"}
                          className="h-0.5 min-w-8 flex-1 bg-accent/80 transition-colors relative after:content-[''] after:absolute after:right-0 after:top-1/2 after:-translate-y-1/2 after:w-1.5 after:h-1.5 after:rounded-full after:bg-accent"
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
            <div className="flex items-center justify-between border-b border-line bg-surface/50 px-5 py-3">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-accent" />
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-ink">
                  {t("Character presence")}
                </span>
              </div>
              <span className="text-xs text-ink-faint">{t("Who is in which event, in story order.")}</span>
            </div>

            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface">
                  <th className="sticky left-0 z-10 min-w-48 border-r border-line bg-surface px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-ink-muted shadow-xs">
                    <div className="flex items-center gap-2">
                      <Users size={15} className="text-accent" />
                      <span>{t("Characters")}</span>
                    </div>
                  </th>
                  {events.map((event) => {
                    const isSelected = selectedEventId === event.id;
                    return (
                      <th
                        key={event.id}
                        className={`min-w-44 border-r border-line/70 px-3.5 py-3 text-left font-normal transition-colors ${
                          isSelected ? "bg-accent-soft/30" : ""
                        }`}
                      >
                        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                          {t("Beat")} {event.sequence + 1}
                        </span>
                        <span className="mt-1 block truncate text-xs font-bold text-ink">{event.title}</span>
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
                    const isCharacterEntitySelected = selectedEntityId === character.id;

                    return (
                      <tr
                        key={character.id}
                        data-timeline-lane={character.id}
                        className={`border-b border-line/60 transition-colors hover:bg-surface-muted/40 ${
                          isCharacterEntitySelected
                            ? "bg-accent-soft/20"
                            : rowIndex % 2 === 0
                              ? "bg-surface-raised"
                              : "bg-surface/30"
                        }`}
                      >
                        <th
                          className={`sticky left-0 z-10 border-r border-line px-4 py-3.5 text-left font-semibold text-ink shadow-xs transition-colors ${
                            isCharacterEntitySelected
                              ? "bg-accent-soft/50 ring-2 ring-accent/30"
                              : "bg-surface-raised"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 truncate">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent ring-1 ring-accent/20">
                                {character.name.slice(0, 1).toUpperCase()}
                              </div>
                              <span className="truncate text-xs font-bold text-ink">{character.name}</span>
                            </div>
                            <span className="shrink-0 rounded-md bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-ink-muted">
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
                              className={`border-r border-line/50 px-3 py-3 text-center transition-colors ${
                                isSelected ? "bg-accent-soft/20" : ""
                              }`}
                            >
                              {hit ? (
                                <button
                                  type="button"
                                  aria-label={`${character.name} · ${event.title}`}
                                  onClick={() => onSelectEvent(event.id)}
                                  className="group inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-on-accent shadow-xs ring-4 ring-accent/15 transition-all hover:scale-110 active:scale-95"
                                >
                                  <User size={13} weight="bold" />
                                </button>
                              ) : (
                                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-line/70" aria-hidden="true" />
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

function EntityInspector({
  outline,
  entity,
  onSelectEvent,
  onDeselect,
}: {
  outline: StudioStoryOutline;
  entity: StudioStoryTimelineEntity;
  onSelectEvent: (eventId: string) => void;
  onDeselect: () => void;
}) {
  const { t } = useI18n();
  const appearances = entity.appearanceEventIds
    .map((eventId) => outline.timeline.events.find((event) => event.id === eventId))
    .filter((event): event is StudioStoryTimelineEvent => event !== undefined);

  const entityChanges = outline.timeline.stateChanges.filter(
    (change) => change.entityId === entity.id,
  );

  return (
    <div className="mt-8 rounded-2xl border border-accent/40 bg-surface-raised p-5 shadow-xs ring-1 ring-accent/20 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent shadow-xs">
            {entityKindIcon(entity.kind, true)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-ink">{entity.name}</h2>
              <span className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                {t(entityKindLabel(entity.kind))}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {appearances.length} {appearances.length === 1 ? t("beat") : t("beats")} {t("Appearances")}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDeselect}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:border-accent/40 hover:text-ink"
        >
          <X size={13} />
          <span>{t("Clear selection")}</span>
        </button>
      </div>

      {/* Details Grid */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* Visual Model Sheet */}
        {entity.visualBase.trim() ? (
          <div className="rounded-xl border border-line/70 bg-surface p-4">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
              <Sparkle size={15} className="text-accent" />
              <span>{t("Visual model sheet")}</span>
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-ink">{entity.visualBase}</p>
          </div>
        ) : null}

        {/* Core Narrative Identity */}
        {entity.description.trim() ? (
          <div className="rounded-xl border border-line/70 bg-surface p-4">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
              <Quotes size={15} className="text-accent" />
              <span>{t("Core identity")}</span>
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-ink">{entity.description}</p>
          </div>
        ) : null}
      </div>

      {/* Appearance Track Sequence */}
      <div className="mt-5 rounded-xl border border-line/70 bg-surface p-4" data-entity-appearances="true">
        <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-3">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
            <ListNumbers size={15} className="text-accent" />
            <span>{t("Appearances")}</span>
          </div>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
            {appearances.length} {t("Beats")}
          </span>
        </div>

        {appearances.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">{t("No appearances yet.")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {appearances.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onSelectEvent(event.id)}
                  className="group flex w-full items-center justify-between gap-3 rounded-lg border border-line/80 bg-surface-raised p-3 text-left transition-all hover:border-accent/40 hover:bg-surface hover:shadow-2xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="inline-flex shrink-0 items-center justify-center rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-on-accent shadow-2xs">
                      {t("Beat")} {event.sequence + 1}
                    </span>
                    <span className="truncate text-xs font-bold text-ink">{event.title}</span>
                  </div>
                  <span className="shrink-0 text-[11px] font-bold text-accent opacity-70 group-hover:opacity-100 transition-opacity">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* State Changes for this Entity */}
      {entityChanges.length > 0 ? (
        <div className="mt-4 rounded-xl border border-line/70 bg-surface p-4">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
            <CheckCircle size={15} className="text-accent" />
            <span>{t("State changes")}</span>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {entityChanges.map((change) => {
              const event = outline.timeline.events.find((e) => e.id === change.eventId);
              const detail = [change.condition, change.outfit].filter(Boolean).join(" · ");
              return (
                <li
                  key={`${change.entityId}:${change.eventId}:${change.truth}`}
                  className="flex flex-wrap items-center gap-2 text-xs text-ink"
                >
                  {event ? (
                    <span className="rounded bg-surface-muted px-1.5 py-0.5 font-bold text-ink-muted">
                      {t("Beat")} {event.sequence + 1}
                    </span>
                  ) : null}
                  <span className="font-semibold">{detail || t("State update")}</span>
                  <span className="text-[10px] font-medium text-ink-faint">({change.truth})</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function EventStateChanges({
  outline,
  eventId,
}: {
  outline: StudioStoryOutline;
  eventId: string;
}) {
  const { t } = useI18n();
  const changes = outline.timeline.stateChanges.filter((change) => change.eventId === eventId);
  if (changes.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-line/70 bg-surface p-4">
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
        <CheckCircle size={15} className="text-accent" />
        <span>{t("State changes")}</span>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {changes.map((change) => {
          const entity = outline.timeline.entities.find((item) => item.id === change.entityId);
          const detail = [change.condition, change.outfit].filter(Boolean).join(" · ");
          return (
            <li
              key={`${change.entityId}:${change.eventId}:${change.truth}`}
              className="flex flex-wrap items-center gap-2 text-xs text-ink"
            >
              <span className="font-bold text-ink">{entity?.name ?? change.entityId}</span>
              {detail ? <span className="text-ink-muted">· {detail}</span> : null}
              <span className="rounded bg-surface-muted px-1.5 py-0.2 text-[10px] font-semibold text-ink-faint">
                {change.truth}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function eventParticipants(
  event: StudioStoryTimelineEvent,
  characterIds: readonly string[],
): string[] {
  return event.participantIds.filter((id) => characterIds.includes(id));
}

