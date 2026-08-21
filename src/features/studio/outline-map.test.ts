import { describe, expect, it } from "vitest";

import { applyMapPan, entityTrajectory, isInteractivePanTarget } from "./outline-map";

const times = [
  { id: "volume-01", kind: "volume" as const, volumeId: "volume-01", chapterId: null },
  { id: "volume-01-chapter-01", kind: "chapter" as const, volumeId: "volume-01", chapterId: "chapter-01" },
  { id: "volume-01-chapter-02", kind: "chapter" as const, volumeId: "volume-01", chapterId: "chapter-02" },
  { id: "volume-02", kind: "volume" as const, volumeId: "volume-02", chapterId: null },
  { id: "volume-02-chapter-01", kind: "chapter" as const, volumeId: "volume-02", chapterId: "chapter-01" },
];

const events = [
  { id: "event-watch", volumeId: "volume-01", chapterId: "chapter-01" },
  { id: "event-storm", volumeId: "volume-01", chapterId: "chapter-02" },
  { id: "event-later", volumeId: "volume-02", chapterId: "chapter-01" },
];

describe("entityTrajectory", () => {
  it("maps an entity to the events and time nodes it participates in", () => {
    const trajectory = entityTrajectory({
      appearanceEventIds: ["event-watch", "event-later", "missing-event"],
      events,
      times,
    });

    expect(trajectory.eventIds).toEqual(["event-watch", "event-later"]);
    expect(trajectory.timeIds).toEqual([
      "volume-01",
      "volume-01-chapter-01",
      "volume-02",
      "volume-02-chapter-01",
    ]);
    expect(trajectory.eventIds).not.toContain("event-storm");
    expect(trajectory.timeIds).not.toContain("volume-01-chapter-02");
  });

  it("returns empty ids when the entity has no appearances", () => {
    expect(
      entityTrajectory({
        appearanceEventIds: [],
        events,
        times,
      }),
    ).toEqual({ eventIds: [], timeIds: [] });
  });
});

describe("applyMapPan", () => {
  it("applies a pointer delta and stays consistent on a second drag", () => {
    const afterFirst = applyMapPan({ x: 12, y: -4 }, { x: 40, y: 18 });
    expect(afterFirst).toEqual({ x: 52, y: 14 });

    const afterSecond = applyMapPan(afterFirst, { x: -15, y: 6 });
    expect(afterSecond).toEqual({ x: 37, y: 20 });
    expect(applyMapPan(afterFirst, { x: -15, y: 6 })).toEqual(afterSecond);
  });
});

describe("isInteractivePanTarget", () => {
  it("treats buttons as non-pan targets so node clicks stay selections", () => {
    const button = { closest: (selector: string) => (selector.includes("button") ? button : null) };
    expect(isInteractivePanTarget(button as unknown as Element)).toBe(true);
    expect(isInteractivePanTarget(null)).toBe(false);
  });
});
