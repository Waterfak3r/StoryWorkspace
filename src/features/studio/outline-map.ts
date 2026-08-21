export type MapOffset = {
  x: number;
  y: number;
};

export type OutlineMapEvent = {
  id: string;
  volumeId: string;
  chapterId: string;
};

export type OutlineMapTime = {
  id: string;
  kind: "volume" | "chapter";
  volumeId: string;
  chapterId: string | null;
};

export type EntityTrajectory = {
  eventIds: string[];
  timeIds: string[];
};

export function applyMapPan(current: MapOffset, delta: MapOffset): MapOffset {
  return {
    x: current.x + delta.x,
    y: current.y + delta.y,
  };
}

export function entityTrajectory(input: {
  appearanceEventIds: readonly string[];
  events: readonly OutlineMapEvent[];
  times: readonly OutlineMapTime[];
}): EntityTrajectory {
  const appearances = new Set(input.appearanceEventIds);
  const eventIds: string[] = [];
  const timeIds = new Set<string>();

  for (const event of input.events) {
    if (!appearances.has(event.id)) {
      continue;
    }
    eventIds.push(event.id);
    for (const time of input.times) {
      if (time.kind === "volume" && time.volumeId === event.volumeId) {
        timeIds.add(time.id);
      }
      if (
        time.kind === "chapter"
        && time.volumeId === event.volumeId
        && time.chapterId === event.chapterId
      ) {
        timeIds.add(time.id);
      }
    }
  }

  return { eventIds, timeIds: [...timeIds] };
}

export function isInteractivePanTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object" || !("closest" in target)) {
    return false;
  }
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== "function") {
    return false;
  }
  return Boolean(closest.call(target, "button, a, input, textarea, select, [data-no-pan]"));
}
