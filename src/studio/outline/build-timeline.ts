import { allocateUniqueSlug, isStudioSlug, slugifyTitle } from "../domain";
import type {
  StudioStoryTimeline,
  StudioStoryTimelineContainment,
  StudioStoryTimelineTime,
} from "../domain";

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

export type TimelineChapterInput = {
  id: string;
  title: string;
};

export type TimelineVolumeInput = {
  id: string;
  title: string;
  chapters: readonly TimelineChapterInput[];
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
  volumes?: readonly TimelineVolumeInput[];
  reservedIds?: readonly string[];
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

  for (const id of known) {
    taken.add(id);
  }
  for (const id of input.reservedIds ?? []) {
    taken.add(id);
  }

  const { times, containments } = assembleTimesAndContainments(input.volumes ?? [], events, taken);

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
    times,
    containments,
  };
}

function assembleTimesAndContainments(
  volumes: readonly TimelineVolumeInput[],
  events: readonly { id: string; volumeId: string; chapterId: string }[],
  taken: Set<string>,
): { times: StudioStoryTimelineTime[]; containments: StudioStoryTimelineContainment[] } {
  const times: StudioStoryTimelineTime[] = [];
  const containments: StudioStoryTimelineContainment[] = [];
  const chapterTimeByKey = new Map<string, string>();

  for (const volume of volumes) {
    const volumeTimeId = allocateTimeId(volume.id, taken);
    taken.add(volumeTimeId);
    times.push({
      id: volumeTimeId,
      kind: "volume",
      title: volume.title,
      volumeId: volume.id,
      chapterId: null,
      parentTimeId: null,
    });

    for (const chapter of volume.chapters) {
      const chapterTimeId = allocateTimeId(`${volume.id}-${chapter.id}`, taken);
      taken.add(chapterTimeId);
      chapterTimeByKey.set(chapterKey(volume.id, chapter.id), chapterTimeId);
      times.push({
        id: chapterTimeId,
        kind: "chapter",
        title: chapter.title,
        volumeId: volume.id,
        chapterId: chapter.id,
        parentTimeId: volumeTimeId,
      });
      containments.push({
        fromTimeId: volumeTimeId,
        toTimeId: chapterTimeId,
      });
    }
  }

  for (const event of events) {
    const chapterTimeId = chapterTimeByKey.get(chapterKey(event.volumeId, event.chapterId));
    if (!chapterTimeId) {
      continue;
    }
    containments.push({
      fromTimeId: chapterTimeId,
      toEventId: event.id,
    });
  }

  return { times, containments };
}

function allocateTimeId(preferred: string, taken: Set<string>): string {
  const base = isStudioSlug(preferred) ? preferred : slugifyTitle(preferred);
  if (!taken.has(base)) {
    return base;
  }
  const prefixedRaw = `time-${base}`;
  const prefixed = isStudioSlug(prefixedRaw) ? prefixedRaw : slugifyTitle(prefixedRaw);
  return allocateUniqueSlug(prefixed, (candidate) => taken.has(candidate));
}

function chapterKey(volumeId: string, chapterId: string): string {
  return `${volumeId}\0${chapterId}`;
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
