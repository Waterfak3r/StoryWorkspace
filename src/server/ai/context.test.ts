import { describe, expect, it } from "vitest";
import type { BibleEntry, Chapter, OutlineNode } from "@/domain/narrative";
import { resolveAiContextFromCollections } from "./context";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const targetId = "33333333-3333-4333-8333-333333333333";
const bibleId = "44444444-4444-4444-8444-444444444444";
const outlineId = "55555555-5555-4555-8555-555555555555";
const chapterId = "66666666-6666-4666-8666-666666666666";
const timestamp = "2026-01-01T00:00:00.000Z";

const bible = (id: string, position: number, owner = projectId): BibleEntry => ({
  id,
  projectId: owner,
  category: "world",
  title: `Bible ${position}`,
  body: `World ${position}`,
  position,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const outline = (id: string, position: number, owner = projectId): OutlineNode => ({
  id,
  projectId: owner,
  parentId: null,
  kind: "scene",
  title: `Scene ${position}`,
  summary: `Summary ${position}`,
  position,
  createdAt: timestamp,
  updatedAt: timestamp,
});

const chapter = (id: string, position: number, owner = projectId): Chapter => ({
  id,
  projectId: owner,
  outlineNodeId: null,
  title: `Chapter ${position}`,
  summary: `Summary ${position}`,
  body: `Body ${position}`,
  position,
  status: "draft",
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("AI context resolution", () => {
  it("returns deterministic position and id ordering with reference summaries", () => {
    const collections = {
      bibleEntries: [bible(bibleId, 2), bible("77777777-7777-4777-8777-777777777777", 1), bible("88888888-8888-4888-8888-888888888888", 0)],
      outlineNodes: [outline(outlineId, 0)],
      chapters: [chapter(targetId, 9), chapter(chapterId, 1)],
    };
    const resolved = resolveAiContextFromCollections(projectId, targetId, {
      bibleEntryIds: [bibleId, "77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"],
      outlineNodeIds: [outlineId],
      chapterIds: [chapterId],
    }, collections);

    expect(resolved.referenceIds).toEqual(["88888888-8888-4888-8888-888888888888", "77777777-7777-4777-8777-777777777777", bibleId, outlineId, chapterId]);
    expect(resolved.references).toMatchObject([
      { id: "88888888-8888-4888-8888-888888888888", group: "bible", subtype: "world" },
      { id: "77777777-7777-4777-8777-777777777777", group: "bible", subtype: "world" },
      { id: bibleId, group: "bible", subtype: "world" },
      { id: outlineId, group: "outline", subtype: "scene" },
      { id: chapterId, group: "chapter", subtype: "draft" },
    ]);
    expect(resolved.contextText.indexOf("Bible 2")).toBeGreaterThanOrEqual(0);
  });

  it("does not resolve missing or cross-project references", () => {
    const collections = {
      bibleEntries: [bible(bibleId, 0, otherProjectId)],
      outlineNodes: [],
      chapters: [chapter(targetId, 0)],
    };
    expect(() => resolveAiContextFromCollections(projectId, targetId, {
      bibleEntryIds: [bibleId],
      outlineNodeIds: [],
      chapterIds: [],
    }, collections)).toThrow(/reference not found/i);
  });

  it("rejects duplicates across context groups and resolved context over the budget", () => {
    const collections = {
      bibleEntries: [bible(bibleId, 0)],
      outlineNodes: [],
      chapters: [chapter(targetId, 0)],
    };
    expect(() => resolveAiContextFromCollections(projectId, targetId, {
      bibleEntryIds: [bibleId],
      outlineNodeIds: [],
      chapterIds: [bibleId],
    }, collections)).toThrow();

    const huge = { ...bible(bibleId, 0), body: "x".repeat(80_001) };
    expect(() => resolveAiContextFromCollections(projectId, targetId, {
      bibleEntryIds: [bibleId],
      outlineNodeIds: [],
      chapterIds: [],
    }, { ...collections, bibleEntries: [huge] })).toThrow(/80000/);
  });
});
