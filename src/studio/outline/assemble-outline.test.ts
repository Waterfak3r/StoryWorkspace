import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { assembleStoryOutline } from "./assemble-outline";
import { createEntity, createProject, createScene, getWorkspaceRoot, readScene, updateScene, writeContentState } from "../fs";
import { ingestFixtureStory } from "../test-support/fixture-stories";

const previousWorkspaceRoot = process.env.STORY_WORKSPACE_ROOT;
const previousDbPath = process.env.STORY_WORKSPACE_DB_PATH;

let workspaceRoot = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-outline-"));
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  delete process.env.STORY_WORKSPACE_DB_PATH;
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  if (previousWorkspaceRoot === undefined) {
    delete process.env.STORY_WORKSPACE_ROOT;
  } else {
    process.env.STORY_WORKSPACE_ROOT = previousWorkspaceRoot;
  }
  if (previousDbPath === undefined) {
    delete process.env.STORY_WORKSPACE_DB_PATH;
  } else {
    process.env.STORY_WORKSPACE_DB_PATH = previousDbPath;
  }
});

describe("assembleStoryOutline", () => {
  it("lists every ingested scene with plot, setting, and entity names", async () => {
    const { project, confirmed } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const outline = assembleStoryOutline(project.id);

    expect(outline.title).toBe("The Last Leaf");
    expect(outline.projectId).toBe(project.id);

    const scenes = outline.volumes.flatMap((volume) => volume.chapters.flatMap((chapter) => chapter.scenes));
    const confirmedWithPlot = confirmed.scenes.filter((scene) => scene.script.trim().length > 0);
    for (const scene of confirmedWithPlot) {
      const row = scenes.find((item) => item.title === scene.title && item.plot.includes(scene.script.slice(0, 24)));
      expect(row).toBeDefined();
      expect(row!.intent.length + row!.plot.length).toBeGreaterThan(0);
    }

    const ivy = scenes.find((scene) => scene.title.includes("ivy") || scene.plot.toLowerCase().includes("leaf"));
    expect(ivy).toBeDefined();
    expect(ivy!.environment?.name).toBeTruthy();
    expect(ivy!.entities.map((entity) => entity.name)).toEqual(expect.arrayContaining(["Sue", "Johnsy"]));
  });

  it("assembles a character-event timeline, not only nested scene cards", async () => {
    const { project } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const outline = assembleStoryOutline(project.id);
    const { timeline } = outline;

    expect(timeline.axis).toBe("sequence");
    expect(timeline.events.length).toBeGreaterThanOrEqual(2);
    expect(timeline.characters.length).toBeGreaterThanOrEqual(2);
    expect(timeline.events.map((event) => event.sequence)).toEqual(timeline.events.map((_, index) => index));

    const sue = timeline.characters.find((character) => character.name === "Sue");
    const johnsy = timeline.characters.find((character) => character.name === "Johnsy");
    expect(sue).toBeDefined();
    expect(johnsy).toBeDefined();

    const withBoth = timeline.events.filter(
      (event) => event.participantIds.includes(sue!.id) && event.participantIds.includes(johnsy!.id),
    );
    expect(withBoth.length).toBeGreaterThanOrEqual(1);
    expect(withBoth[0]?.participantIds.length).toBeGreaterThanOrEqual(2);

    const sueHits = timeline.intersections.filter((hit) => hit.characterId === sue!.id);
    expect(sueHits.length).toBeGreaterThanOrEqual(1);
    for (const hit of sueHits) {
      const event = timeline.events.find((item) => item.id === hit.eventId);
      expect(event).toBeDefined();
      expect(event!.participantIds).toContain(sue!.id);
    }

    const eventIds = timeline.events.map((event) => event.id);
    expect(new Set(eventIds).size).toBe(eventIds.length);
    for (const event of timeline.events) {
      expect(event.id).not.toBe(event.sceneId);
      expect(event.id).toContain(event.chapterId);
      expect(event.id).toContain(event.sceneId);
    }

    const doctor = timeline.characters.find((character) => character.name === "Doctor");
    const behrman = timeline.characters.find((character) => character.name === "Behrman");
    expect(doctor).toBeDefined();
    expect(behrman).toBeDefined();

    const studio = mustEvent(timeline.events, "A studio in Greenwich Village");
    const illness = mustEvent(timeline.events, "Pneumonia visits Johnsy");
    const ivy = mustEvent(timeline.events, "Counting the ivy leaves");
    const hears = mustEvent(timeline.events, "Behrman hears the last leaf");
    const stays = mustEvent(timeline.events, "The last leaf stays");

    expect(studio.participantIds).toEqual(expect.arrayContaining([sue!.id, johnsy!.id]));
    expect(studio.participantIds).not.toContain(doctor!.id);
    expect(studio.participantIds).not.toContain(behrman!.id);
    expect(illness.participantIds).toEqual(expect.arrayContaining([sue!.id, johnsy!.id, doctor!.id]));
    expect(illness.participantIds).not.toContain(behrman!.id);
    expect(ivy.participantIds).toEqual(expect.arrayContaining([sue!.id, johnsy!.id]));
    expect(hears.participantIds).toEqual(expect.arrayContaining([sue!.id, behrman!.id]));
    expect(hears.participantIds).not.toContain(doctor!.id);
    expect(stays.participantIds).toEqual(expect.arrayContaining([sue!.id, johnsy!.id, behrman!.id, doctor!.id]));

    expect(presentOn(timeline.intersections, doctor!.id, studio.id)).toBe(false);
    expect(presentOn(timeline.intersections, behrman!.id, studio.id)).toBe(false);
    expect(presentOn(timeline.intersections, doctor!.id, illness.id)).toBe(true);
    expect(presentOn(timeline.intersections, behrman!.id, hears.id)).toBe(true);
    expect(presentOn(timeline.intersections, doctor!.id, stays.id)).toBe(true);

    expect(timeline.connections.length).toBe(timeline.events.length - 1);
    for (let index = 0; index < timeline.connections.length; index += 1) {
      expect(timeline.connections[index]).toEqual({
        fromEventId: timeline.events[index]!.id,
        toEventId: timeline.events[index + 1]!.id,
      });
    }
  });

  it("puts Last Leaf characters and a location on timeline.entities with appearance event ids", async () => {
    const { project } = await ingestFixtureStory("The Last Leaf", "last-leaf");
    const outline = assembleStoryOutline(project.id);
    const sue = outline.timeline.entities.find((entity) => entity.name === "Sue");
    const johnsy = outline.timeline.entities.find((entity) => entity.name === "Johnsy");
    expect(sue?.kind).toBe("character");
    expect(johnsy?.kind).toBe("character");
    expect(sue?.appearanceEventIds.length).toBeGreaterThanOrEqual(1);
    expect(johnsy?.appearanceEventIds.length).toBeGreaterThanOrEqual(1);
    expect(outline.timeline.entities.some((entity) => entity.kind === "location")).toBe(true);
    expect(listBasenames(path.join(getWorkspaceRoot(), project.id))).not.toContain("outline.json");
  });

  it("records two appearance event ids when the same character is in two scenes", () => {
    const project = createProject({ title: "Two Scenes" });
    const sue = createEntity(project.id, { kind: "character", name: "Sue" });
    const first = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      title: "Studio morning",
      characters: [sue.id],
      expectedUpdatedAt: first.updatedAt,
    });
    const second = createScene(project.id, "volume-01", "chapter-01", { title: "Studio night" });
    updateScene(project.id, "volume-01", "chapter-01", second.id, {
      characters: [sue.id],
      expectedUpdatedAt: second.updatedAt,
    });

    const outline = assembleStoryOutline(project.id);
    const entity = outline.timeline.entities.find((item) => item.id === sue.id);
    expect(entity?.appearanceEventIds).toHaveLength(2);
    expect(new Set(entity?.appearanceEventIds).size).toBe(2);
    expect(listBasenames(path.join(getWorkspaceRoot(), project.id))).not.toContain("outline.json");
  });

  it("adds timeline stateChanges when a scene has content-state patches", () => {
    const project = createProject({ title: "Injured Watch" });
    const jill = createEntity(project.id, { kind: "character", name: "Jill" });
    const scene = readScene(project.id, "volume-01", "chapter-01", "scene-01");
    updateScene(project.id, "volume-01", "chapter-01", "scene-01", {
      title: "Harbor watch",
      characters: [jill.id],
      expectedUpdatedAt: scene.updatedAt,
    });
    writeContentState(project.id, "volume-01", "chapter-01", "scene-01", {
      patches: [{ entityId: jill.id, condition: "injured", truth: "inferred" }],
    });

    const outline = assembleStoryOutline(project.id);
    expect(outline.timeline.stateChanges).toEqual([
      expect.objectContaining({
        entityId: jill.id,
        eventId: outline.timeline.events[0]?.id,
        condition: "injured",
        truth: "inferred",
      }),
    ]);
  });
});

function listBasenames(directoryPath: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    names.push(entry.name);
    if (entry.isDirectory()) {
      names.push(...listBasenames(path.join(directoryPath, entry.name)));
    }
  }
  return names;
}

function mustEvent(
  events: { id: string; title: string; participantIds: string[] }[],
  title: string,
) {
  const event = events.find((item) => item.title === title);
  expect(event, title).toBeDefined();
  return event!;
}

function presentOn(
  intersections: { characterId: string; eventId: string }[],
  characterId: string,
  eventId: string,
) {
  return intersections.some((hit) => hit.characterId === characterId && hit.eventId === eventId);
}
