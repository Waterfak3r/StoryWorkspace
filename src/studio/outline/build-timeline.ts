import { allocateUniqueSlug, isStudioSlug, slugifyTitle } from "../domain";
import type { StudioStoryTimeline } from "../domain";

export type TimelineCharacterInput = {
  id: string;
  name: string;
};

export type TimelineEventInput = {
  title: string;
  volumeId: string;
  chapterId: string;
  sceneId: string;
  summary: string;
  participantIds: readonly string[];
};

export function timelineEventId(input: {
  volumeId: string;
  chapterId: string;
  sceneId: string;
}): string {
  const joined = `${input.volumeId}-${input.chapterId}-${input.sceneId}`;
  return isStudioSlug(joined) ? joined : slugifyTitle(joined);
}

export function buildStoryTimeline(input: {
  characters: readonly TimelineCharacterInput[];
  events: readonly TimelineEventInput[];
}): StudioStoryTimeline {
  const known = new Set(input.characters.map((character) => character.id));
  const taken = new Set<string>();
  const events = input.events.map((event, sequence) => {
    const participantIds = uniqueIds(event.participantIds.filter((id) => known.has(id)));
    const id = allocateUniqueSlug(timelineEventId(event), (candidate) => taken.has(candidate));
    taken.add(id);
    return {
      id,
      sequence,
      title: event.title,
      volumeId: event.volumeId,
      chapterId: event.chapterId,
      sceneId: event.sceneId,
      summary: event.summary,
      participantIds,
    };
  });

  return {
    axis: "sequence",
    events,
    characters: input.characters.map((character) => ({ id: character.id, name: character.name })),
    intersections: events.flatMap((event) =>
      event.participantIds.map((characterId) => ({ characterId, eventId: event.id })),
    ),
    connections: events.slice(1).map((event, index) => ({
      fromEventId: events[index]!.id,
      toEventId: event.id,
    })),
    entities: [],
    stateChanges: [],
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(id);
  }
  return unique;
}
