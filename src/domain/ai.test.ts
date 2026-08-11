import { describe, expect, it } from "vitest";
import { aiAcceptInputSchema, aiGenerateInputSchema, aiContextSchema, AI_LIMITS } from "./ai";

const projectId = "11111111-1111-4111-8111-111111111111";
const chapterId = "22222222-2222-4222-8222-222222222222";
const refId = "33333333-3333-4333-8333-333333333333";

const base = {
  projectId,
  targetChapterId: chapterId,
  action: "brainstorm" as const,
  instruction: "  Find three possible turns  ",
  context: { bibleEntryIds: [], outlineNodeIds: [], chapterIds: [] },
};

describe("AI domain contracts", () => {
  it("trims instruction for validation while keeping the normalized value", () => {
    expect(aiGenerateInputSchema.parse(base).instruction).toBe("Find three possible turns");
    expect(() => aiGenerateInputSchema.parse({ ...base, instruction: "   " })).toThrow();
  });

  it("rejects duplicates and reference counts over the limit", () => {
    expect(() => aiContextSchema.parse({ bibleEntryIds: [refId], outlineNodeIds: [refId], chapterIds: [] })).toThrow();
    const ids = Array.from({ length: AI_LIMITS.references + 1 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    for (const group of ["bibleEntryIds", "outlineNodeIds", "chapterIds"] as const) {
      expect(() => aiContextSchema.parse({ bibleEntryIds: [], outlineNodeIds: [], chapterIds: [], [group]: ids })).toThrow();
    }
  });

  it("requires selected prose for rewrite and enforces its limit", () => {
    expect(() => aiGenerateInputSchema.parse({ ...base, action: "rewrite" })).toThrow(/selected prose/i);
    expect(() => aiGenerateInputSchema.parse({ ...base, action: "rewrite", selectedProse: "x".repeat(AI_LIMITS.selectedProse + 1) })).toThrow();
    expect(aiGenerateInputSchema.parse({ ...base, action: "rewrite", selectedProse: "A passage" }).selectedProse).toBe("A passage");
  });

  it("does not accept browser-supplied AI provenance fields", () => {
    expect(() => aiAcceptInputSchema.parse({
      generationId: chapterId,
      body: "Draft",
      baseUpdatedAt: "2026-01-01T00:00:00.000Z",
      source: "ai",
      instruction: "forged",
      contextReferenceIds: [refId],
    })).toThrow();
  });

  it("enforces the shared chapter body limit at the AI acceptance boundary", () => {
    const accepted = aiAcceptInputSchema.safeParse({
      generationId: chapterId,
      body: "x".repeat(100_000),
      baseUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    const rejected = aiAcceptInputSchema.safeParse({
      generationId: chapterId,
      body: "x".repeat(100_001),
      baseUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(accepted.success).toBe(true);
    expect(rejected.success).toBe(false);
  });
});
