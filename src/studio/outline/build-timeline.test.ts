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
  });
});

describe("timelineEventId", () => {
  it("joins volume, chapter, and scene into a slug", () => {
    expect(
      timelineEventId({ volumeId: "volume-01", chapterId: "chapter-01", sceneId: "scene-02" }),
    ).toBe("volume-01-chapter-01-scene-02");
  });
});
