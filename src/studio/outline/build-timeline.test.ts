import { describe, expect, it } from "vitest";

import { buildStoryTimeline, timelineEventId } from "./build-timeline";

describe("buildStoryTimeline", () => {
  it("gives colliding per-chapter scene ids distinct event ids and intersections", () => {
    const sue = { id: "character-01", name: "Sue" };
    const doctor = { id: "character-03", name: "Doctor" };
    const timeline = buildStoryTimeline({
      characters: [sue, doctor],
      events: [
        {
          title: "A studio in Greenwich Village",
          volumeId: "volume-01",
          chapterId: "chapter-01",
          sceneId: "scene-02",
          summary: "Introduce the artists.",
          participantIds: [sue.id],
        },
        {
          title: "The last leaf stays",
          volumeId: "volume-01",
          chapterId: "chapter-03",
          sceneId: "scene-02",
          summary: "Behrman's masterpiece.",
          participantIds: [sue.id, doctor.id],
        },
      ],
    });

    expect(timeline.events.map((event) => event.id)).toEqual([
      "volume-01-chapter-01-scene-02",
      "volume-01-chapter-03-scene-02",
    ]);
    expect(new Set(timeline.events.map((event) => event.id)).size).toBe(2);
    expect(timeline.events[0]?.sceneId).toBe("scene-02");
    expect(timeline.events[1]?.sceneId).toBe("scene-02");
    expect(timeline.events[0]?.participantIds).toEqual([sue.id]);
    expect(timeline.events[1]?.participantIds).toEqual([sue.id, doctor.id]);
    expect(timeline.intersections).toEqual([
      { characterId: sue.id, eventId: "volume-01-chapter-01-scene-02" },
      { characterId: sue.id, eventId: "volume-01-chapter-03-scene-02" },
      { characterId: doctor.id, eventId: "volume-01-chapter-03-scene-02" },
    ]);
    expect(timeline.events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(timeline.connections).toEqual([
      {
        fromEventId: "volume-01-chapter-01-scene-02",
        toEventId: "volume-01-chapter-03-scene-02",
      },
    ]);
    expect(timeline.connections[0]?.fromEventId).toBe(timeline.events[0]?.id);
    expect(timeline.connections[0]?.toEventId).toBe(timeline.events[1]?.id);
  });

  it("builds volume and chapter times with containments and avoids event id collisions", () => {
    const sue = { id: "character-01", name: "Sue" };
    const collidingVolumeId = "volume-01-chapter-01-scene-01";
    const timeline = buildStoryTimeline({
      characters: [sue],
      volumes: [
        {
          id: "volume-01",
          title: "Book One",
          chapters: [
            { id: "chapter-01", title: "Opening" },
            { id: "chapter-02", title: "Turn" },
          ],
        },
        {
          id: "volume-02",
          title: "Book Two",
          chapters: [{ id: "chapter-01", title: "Later" }],
        },
        {
          id: collidingVolumeId,
          title: "Colliding volume",
          chapters: [],
        },
      ],
      events: [
        {
          title: "First",
          volumeId: "volume-01",
          chapterId: "chapter-01",
          sceneId: "scene-01",
          summary: "A",
          participantIds: [sue.id],
        },
        {
          title: "Second",
          volumeId: "volume-01",
          chapterId: "chapter-02",
          sceneId: "scene-01",
          summary: "B",
          participantIds: [sue.id],
        },
        {
          title: "Third",
          volumeId: "volume-02",
          chapterId: "chapter-01",
          sceneId: "scene-01",
          summary: "C",
          participantIds: [sue.id],
        },
      ],
    });

    const volumeTimes = timeline.times.filter((time) => time.kind === "volume");
    const chapterTimes = timeline.times.filter((time) => time.kind === "chapter");
    expect(volumeTimes).toHaveLength(3);
    expect(chapterTimes).toHaveLength(3);
    expect(timeline.times.map((time) => time.kind)).toEqual([
      "volume",
      "chapter",
      "chapter",
      "volume",
      "chapter",
      "volume",
    ]);

    const volumeToChapter = timeline.containments.filter((edge) => edge.toTimeId);
    const chapterToEvent = timeline.containments.filter((edge) => edge.toEventId);
    expect(volumeToChapter).toHaveLength(3);
    expect(chapterToEvent).toHaveLength(3);

    for (const volumeTime of volumeTimes) {
      expect(volumeTime.chapterId).toBeNull();
      expect(volumeTime.parentTimeId).toBeNull();
    }
    for (const chapterTime of chapterTimes) {
      const parent = volumeTimes.find((time) => time.id === chapterTime.parentTimeId);
      expect(parent?.kind).toBe("volume");
      expect(parent?.volumeId).toBe(chapterTime.volumeId);
      expect(
        volumeToChapter.some(
          (edge) => edge.fromTimeId === parent!.id && edge.toTimeId === chapterTime.id,
        ),
      ).toBe(true);
    }

    for (const event of timeline.events) {
      const edge = chapterToEvent.find((item) => item.toEventId === event.id);
      expect(edge).toBeDefined();
      const chapterTime = chapterTimes.find((time) => time.id === edge!.fromTimeId);
      expect(chapterTime?.volumeId).toBe(event.volumeId);
      expect(chapterTime?.chapterId).toBe(event.chapterId);
    }

    const collidingVolume = volumeTimes.find((time) => time.volumeId === collidingVolumeId);
    expect(collidingVolume?.id).toBe(`time-${collidingVolumeId}`);
    expect(timeline.events.some((event) => event.id === collidingVolumeId)).toBe(true);
    expect(timeline.events.some((event) => event.id === collidingVolume?.id)).toBe(false);

    const timeIds = timeline.times.map((time) => time.id);
    const eventIds = timeline.events.map((event) => event.id);
    expect(new Set([...timeIds, ...eventIds]).size).toBe(timeIds.length + eventIds.length);
  });
});

describe("timelineEventId", () => {
  it("joins volume, chapter, and scene into a slug", () => {
    expect(
      timelineEventId({ volumeId: "volume-01", chapterId: "chapter-01", sceneId: "scene-02" }),
    ).toBe("volume-01-chapter-01-scene-02");
  });
});
