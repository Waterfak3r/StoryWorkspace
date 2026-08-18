"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CaretDown,
  CaretRight,
  CheckCircle,
  Clock,
  Compass,
  Lightning,
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
      return <User size={13} weight={isSelected ? "bold" : "regular"} />;
    case "location":
      return <MapPin size={13} weight={isSelected ? "bold" : "regular"} />;
    case "prop":
      return <Package size={13} weight={isSelected ? "bold" : "regular"} />;
    case "costume":
      return <TShirt size={13} weight={isSelected ? "bold" : "regular"} />;
    default:
      return <Sparkle size={13} weight={isSelected ? "bold" : "regular"} />;
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

  const times = outline?.timeline.times ?? [];

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-8" data-story-outline="true">
      {/* Header section */}
      <div className="border-b border-line pb-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-accent animate-pulse" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Story outline")}</p>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {outline?.title ?? t("Story outline")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {t("Time-spined mindmap connecting narrative beats and living entities across chapters.")}
            </p>
          </div>
          {outline ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink shadow-2xs">
                <Clock size={14} className="text-accent" />
                <span>{times.length}</span>
                <span className="font-normal text-ink-muted">{t("Time nodes")}</span>
              </span>
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
          <div className="h-28 animate-pulse rounded-2xl border border-line bg-surface-muted" />
          <div className="h-72 animate-pulse rounded-2xl border border-line bg-surface-muted" />
        </div>
      ) : null}

      {outline ? (
        <OutlineMindmap
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

function OutlineMindmap({
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
  onSelectEntity: (entityId: string | null) => void;
}) {
  const { t } = useI18n();
  const { times, events, entities, stateChanges } = outline.timeline;

  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});

  const toggleChapter = (chapterTimeId: string) => {
    setCollapsedChapters((prev) => ({
      ...prev,
      [chapterTimeId]: !prev[chapterTimeId],
    }));
  };

  const volumeTimes = useMemo(() => times.filter((time) => time.kind === "volume"), [times]);

  const selectedEntityObj = useMemo(() => {
    if (!selectedEntityId) return null;
    return entities.find((e) => e.id === selectedEntityId) ?? null;
  }, [entities, selectedEntityId]);

  return (
    <div
      className="mt-8 rounded-2xl border border-line bg-surface-raised p-4 sm:p-8 shadow-xs overflow-x-auto"
      data-outline-map="true"
      data-outline-timeline="true"
    >
      {/* Top Map Toolbar / Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/80 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Compass size={16} weight="bold" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-ink">{t("Story mindmap")}</h2>
            <p className="text-[11px] text-ink-muted">
              {selectedEntityId
                ? t("Highlighting {name}", { name: selectedEntityObj?.name ?? selectedEntityId })
                : t("Click an entity to highlight its trajectory across the story.")}
            </p>
          </div>
        </div>

        {/* Action Controls & Legend */}
        <div className="flex flex-wrap items-center gap-2">
          {selectedEntityId ? (
            <button
              type="button"
              onClick={() => onSelectEntity(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent transition-colors hover:bg-accent hover:text-on-accent"
            >
              <X size={12} weight="bold" />
              <span>{t("Clear selection")}</span>
            </button>
          ) : null}

          {/* Node Legend Pills */}
          <div className="hidden lg:flex items-center gap-2 rounded-xl border border-line/60 bg-surface/60 px-3 py-1 text-[11px] text-ink-muted">
            <span className="font-semibold text-ink-faint mr-1">{t("Legend")}:</span>
            <span className="inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 font-semibold text-ink">
              <Clock size={11} className="text-accent" />
              {t("Time spine")}
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 font-semibold text-ink">
              <ListNumbers size={11} className="text-accent" />
              {t("Plot events")}
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 font-semibold text-ink">
              <TreeStructure size={11} className="text-accent" />
              {t("Living entities")}
            </span>
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
              <Lightning size={11} weight="fill" />
              {t("State change")}
            </span>
          </div>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <TreeStructure size={36} className="text-ink-faint" />
          <p className="mt-3 text-sm font-medium text-ink-muted">{t("No events on the timeline yet.")}</p>
        </div>
      ) : (
        /* Mindmap Graph (Continuous Time Spine + Branching Event Pearls + Entity Twigs) */
        <div className="mt-8 space-y-10">
          {volumeTimes.map((volumeTime) => {
            const chapterTimes = times.filter(
              (time) => time.kind === "chapter" && time.parentTimeId === volumeTime.id,
            );

            return (
              <div key={volumeTime.id} className="relative">
                {/* 1. Volume Time Milestone (Major Spine Anchor) */}
                <div className="flex items-center gap-3">
                  <div
                    data-outline-time={volumeTime.id}
                    data-time-kind="volume"
                    className="inline-flex items-center gap-2.5 rounded-2xl border-2 border-accent/40 bg-surface-raised px-4 py-2.5 text-xs font-bold text-ink shadow-xs ring-4 ring-accent/10"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-on-accent text-xs font-black shadow-2xs">
                      V
                    </span>
                    <span className="text-sm font-extrabold tracking-wide">{volumeTime.title}</span>
                    <span className="ml-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-ink-muted">
                      {chapterTimes.length} {t("Chapters")}
                    </span>
                  </div>
                </div>

                {/* Continuous Vertical Axis Spine leading from Volume through Chapters */}
                <div className="relative mt-2 pl-3 sm:pl-4 space-y-8">
                  {chapterTimes.map((chapterTime) => {
                    const isCollapsed = Boolean(collapsedChapters[chapterTime.id]);
                    const chapterEvents = events.filter(
                      (ev) => ev.volumeId === chapterTime.volumeId && ev.chapterId === chapterTime.chapterId,
                    );

                    const containsEdgeId = `${volumeTime.id}->${chapterTime.id}`;

                    return (
                      <div key={chapterTime.id} className="relative">
                        {/* Continuous Vertical Axis Spine Connector (Volume -> Chapter) */}
                        <div
                          data-outline-edge={containsEdgeId}
                          data-edge-kind="contains"
                          className="flex items-center text-accent/60 mb-2"
                          aria-hidden="true"
                        >
                          <svg width="24" height="28" viewBox="0 0 24 28" fill="none" className="overflow-visible">
                            <line
                              x1="12"
                              y1="0"
                              x2="12"
                              y2="24"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeDasharray="4 3"
                            />
                            <circle cx="12" cy="24" r="3.5" fill="currentColor" />
                          </svg>
                        </div>

                        {/* 2. Chapter Time Anchor on the Spine */}
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => toggleChapter(chapterTime.id)}
                            data-outline-time={chapterTime.id}
                            data-time-kind="chapter"
                            className="group inline-flex items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-2 text-xs font-bold text-ink shadow-2xs hover:border-accent hover:bg-surface-raised transition-all"
                          >
                            <span className="text-ink-muted group-hover:text-accent transition-colors">
                              {isCollapsed ? <CaretRight size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
                            </span>
                            <span className="font-bold text-sm tracking-tight text-ink">{chapterTime.title}</span>
                            <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[10px] font-extrabold text-accent">
                              {chapterEvents.length} {t("Beats")}
                            </span>
                          </button>
                        </div>

                        {/* Branching Event Pearls & Entity Twigs */}
                        {!isCollapsed ? (
                          <div className="mt-4 space-y-4">
                            {chapterEvents.length === 0 ? (
                              <p className="py-2 pl-8 text-xs text-ink-faint italic">{t("No events in this chapter.")}</p>
                            ) : (
                              chapterEvents.map((event, eventIdx) => {
                                const isEventSelected = selectedEventId === event.id;
                                const isEntityParticipant = selectedEntityObj
                                  ? selectedEntityObj.appearanceEventIds.includes(event.id)
                                  : false;
                                const isDimmed =
                                  selectedEntityId && !isEntityParticipant && !isEventSelected;

                                const nextEvent = chapterEvents[eventIdx + 1];
                                const eventEntities = entities.filter((entity) =>
                                  entity.appearanceEventIds.includes(event.id),
                                );
                                const eventStateChanges = stateChanges.filter((sc) => sc.eventId === event.id);

                                const chapterToEventEdgeId = `${chapterTime.id}->${event.id}`;
                                const seqEdgeId = nextEvent ? `${event.id}->${nextEvent.id}` : "";

                                return (
                                  <div
                                    key={event.id}
                                    className={`relative transition-all duration-200 ${
                                      isDimmed ? "opacity-35 grayscale-[25%]" : "opacity-100"
                                    }`}
                                  >
                                    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                                      {/* Branching Containment Line from Chapter Spine to Event Pearl */}
                                      <div
                                        data-outline-edge={chapterToEventEdgeId}
                                        data-edge-kind="contains"
                                        className="shrink-0 hidden sm:flex items-center text-line"
                                        aria-hidden="true"
                                      >
                                        <svg width="28" height="24" viewBox="0 0 28 24" fill="none" className="overflow-visible">
                                          <path
                                            d="M 4 0 C 4 12, 12 12, 24 12"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            fill="none"
                                            strokeLinecap="round"
                                          />
                                          <circle cx="24" cy="12" r="3" fill="currentColor" />
                                        </svg>
                                      </div>

                                      {/* 3. Event Pearl Card */}
                                      <button
                                        type="button"
                                        data-outline-event={event.id}
                                        data-timeline-event={event.id}
                                        data-timeline-sequence={event.sequence}
                                        onClick={() => onSelectEvent(event.id)}
                                        className={`group relative flex w-full max-w-md flex-col rounded-2xl border p-4 text-left transition-all duration-150 shadow-2xs ${
                                          isEventSelected
                                            ? "border-accent bg-accent-soft/90 ring-2 ring-accent/40 shadow-xs scale-[1.01]"
                                            : isEntityParticipant
                                              ? "border-accent/80 bg-accent-soft/40 ring-2 ring-accent/30 hover:border-accent"
                                              : "border-line bg-surface hover:border-accent/40 hover:bg-surface-raised"
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <span
                                            className={`inline-flex rounded-lg px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                                              isEventSelected
                                                ? "bg-accent text-on-accent"
                                                : "bg-surface-muted text-ink-muted"
                                            }`}
                                          >
                                            {t("Beat {n}", { n: event.sequence + 1 })}
                                          </span>

                                          {eventEntities.length > 0 ? (
                                            <span className="flex items-center gap-1 text-[11px] font-semibold text-ink-muted">
                                              <Users size={12} className={isEventSelected ? "text-accent" : "text-ink-faint"} />
                                              <span>{eventEntities.length}</span>
                                            </span>
                                          ) : null}
                                        </div>

                                        <h3 className="mt-2 text-xs font-bold leading-snug text-ink">
                                          {event.title}
                                        </h3>

                                        {event.summary ? (
                                          <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">
                                            {event.summary}
                                          </p>
                                        ) : null}

                                        {isEntityParticipant ? (
                                          <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-accent">
                                            <Sparkle size={11} weight="fill" />
                                            <span>{t("Entity in beat")}</span>
                                          </div>
                                        ) : null}
                                      </button>

                                      {/* 4. Entity Leaves Sprouting Laterally from Event Pearl */}
                                      {eventEntities.length > 0 ? (
                                        <div className="flex flex-wrap items-center gap-2 pl-4 lg:pl-0">
                                          {eventEntities.map((entity) => {
                                            const isThisEntitySelected = selectedEntityId === entity.id;
                                            const participatesEdgeId = `${event.id}->${entity.id}`;
                                            const stateChange = eventStateChanges.find(
                                              (sc) => sc.entityId === entity.id,
                                            );

                                            return (
                                              <div key={entity.id} className="flex items-center gap-1.5">
                                                {/* Real Branching Line for Entity (Participates) */}
                                                <div
                                                  data-outline-edge={participatesEdgeId}
                                                  data-edge-kind="participates"
                                                  className={`shrink-0 flex items-center transition-colors duration-150 ${
                                                    isThisEntitySelected
                                                      ? "text-accent"
                                                      : isEventSelected
                                                        ? "text-accent/80"
                                                        : "text-line"
                                                  }`}
                                                  aria-hidden="true"
                                                >
                                                  <svg
                                                    width="24"
                                                    height="16"
                                                    viewBox="0 0 24 16"
                                                    fill="none"
                                                    className="overflow-visible"
                                                  >
                                                    <path
                                                      d="M 0 8 C 8 8, 12 8, 20 8"
                                                      stroke="currentColor"
                                                      strokeWidth={isThisEntitySelected ? "2.5" : "1.5"}
                                                      strokeLinecap="round"
                                                    />
                                                    <circle
                                                      cx="20"
                                                      cy="8"
                                                      r={isThisEntitySelected ? "3.5" : "2"}
                                                      fill="currentColor"
                                                    />
                                                  </svg>
                                                </div>

                                                {/* Entity Node Leaf */}
                                                <button
                                                  type="button"
                                                  data-outline-entity={entity.id}
                                                  onClick={() => onSelectEntity(entity.id)}
                                                  className={`group inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-xs transition-all duration-150 shadow-2xs ${
                                                    isThisEntitySelected
                                                      ? "border-accent bg-accent text-on-accent ring-2 ring-accent/40 scale-105 shadow-xs"
                                                      : "border-line bg-surface text-ink hover:border-accent/40 hover:bg-surface-muted"
                                                  }`}
                                                >
                                                  <span
                                                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
                                                      isThisEntitySelected
                                                        ? "bg-on-accent/20 text-on-accent"
                                                        : "bg-surface-muted text-ink-muted group-hover:text-accent"
                                                    }`}
                                                  >
                                                    {entityKindIcon(entity.kind, isThisEntitySelected)}
                                                  </span>
                                                  <span className="font-bold truncate max-w-[130px] sm:max-w-[180px]">
                                                    {entity.name}
                                                  </span>
                                                  <span
                                                    className={`rounded-full px-1.5 py-0.2 text-[9px] font-extrabold uppercase tracking-wider ${
                                                      isThisEntitySelected
                                                        ? "bg-on-accent/20 text-on-accent"
                                                        : "bg-surface-muted text-ink-faint"
                                                    }`}
                                                  >
                                                    {t(entityKindLabel(entity.kind))}
                                                  </span>
                                                </button>

                                                {/* Visible State Change Edge & Badge */}
                                                {stateChange ? (
                                                  <div
                                                    data-outline-edge={`${event.id}->${entity.id}`}
                                                    data-edge-kind="state"
                                                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300 shadow-2xs"
                                                    title={`${stateChange.condition || stateChange.outfit || "State change"} (${stateChange.truth})`}
                                                  >
                                                    <Lightning size={11} weight="fill" />
                                                    <span className="max-w-[90px] truncate">
                                                      {stateChange.condition || stateChange.outfit || t("State update")}
                                                    </span>
                                                    <span className="text-[8px] opacity-70">({stateChange.truth})</span>
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                    </div>

                                    {/* 5. Sequence Flow Edge Leading to Next Beat */}
                                    {nextEvent ? (
                                      <div
                                        data-outline-edge={seqEdgeId}
                                        data-edge-kind="sequence"
                                        className="my-1.5 flex items-center justify-start pl-8 text-accent/70"
                                        aria-hidden="true"
                                      >
                                        <div className="flex flex-col items-center">
                                          <div className="h-3.5 w-0.5 bg-accent/50" />
                                          <span className="text-[9px] font-mono leading-none">▼</span>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
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
                      {t("Beat {n}", { n: event.sequence + 1 })}
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
                      {t("Beat {n}", { n: event.sequence + 1 })}
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
              <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-ink-faint">
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
