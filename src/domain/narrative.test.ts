import { describe, expect, it } from "vitest";
import {
  createBibleEntryInputSchema,
  createChapterInputSchema,
  CHAPTER_BODY_MAX_LENGTH,
  createManualChapterVersionInputSchema,
  createOutlineNodeInputSchema,
  updateChapterInputSchema,
  updateOutlineNodeInputSchema,
} from "./narrative";

describe("narrative input schemas", () => {
  it("defaults optional creation fields", () => {
    expect(createBibleEntryInputSchema.parse({ category: "world", title: "Weather" })).toMatchObject({ body: "" });
    expect(createOutlineNodeInputSchema.parse({ kind: "story", title: "The return" })).toMatchObject({ parentId: null, summary: "" });
    expect(createChapterInputSchema.parse({ title: "First light" })).toMatchObject({ outlineNodeId: null, body: "", status: "planned" });
  });

  it("rejects unknown fields and invalid enum values", () => {
    expect(createBibleEntryInputSchema.safeParse({ category: "person", title: "Nope" }).success).toBe(false);
    expect(createOutlineNodeInputSchema.safeParse({ kind: "story", title: "Known", extra: true }).success).toBe(false);
    expect(updateOutlineNodeInputSchema.safeParse({ title: "Known", extra: true }).success).toBe(false);
  });

  it("requires a chapter base timestamp and a changed field", () => {
    expect(updateChapterInputSchema.safeParse({}).success).toBe(false);
    expect(updateChapterInputSchema.safeParse({ baseUpdatedAt: "2026-01-01T00:00:00.000Z" }).success).toBe(false);
    expect(updateChapterInputSchema.safeParse({ baseUpdatedAt: "2026-01-01T00:00:00.000Z", body: "Draft" }).success).toBe(true);
  });

  it("keeps AI provenance behind the server-side version boundary", () => {
    expect(createManualChapterVersionInputSchema.safeParse({}).success).toBe(true);
    expect(createManualChapterVersionInputSchema.safeParse({ source: "manual" }).success).toBe(true);
    expect(createManualChapterVersionInputSchema.safeParse({ source: "ai", aiAction: "rewrite" }).success).toBe(false);
  });

  it("uses the shared chapter body limit for creation", () => {
    expect(createChapterInputSchema.safeParse({ title: "Boundary", body: "x".repeat(CHAPTER_BODY_MAX_LENGTH) }).success).toBe(true);
    expect(createChapterInputSchema.safeParse({ title: "Boundary", body: "x".repeat(CHAPTER_BODY_MAX_LENGTH + 1) }).success).toBe(false);
  });
});
