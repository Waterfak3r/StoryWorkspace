import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ADAPTATION_BODY_MAX_LENGTH,
  createAdaptationInputSchema,
  createManualAdaptationInputSchema,
  updateAdaptationInputSchema,
} from "./adaptation";

describe("adaptation contracts", () => {
  it("accepts strict manual and AI creation forms", () => {
    expect(createAdaptationInputSchema.parse({
      origin: "manual",
      format: "screenplay_scene",
      title: "Scene one",
    })).toMatchObject({ origin: "manual", body: "" });

    expect(createAdaptationInputSchema.parse({
      origin: "ai",
      format: "screenplay_scene",
      title: "Reviewed scene",
      generationId: randomUUID(),
    })).toMatchObject({ origin: "ai" });
  });

  it("rejects forged AI body fields and unknown formats", () => {
    expect(createAdaptationInputSchema.safeParse({
      origin: "ai",
      format: "screenplay_scene",
      title: "Forged",
      generationId: randomUUID(),
      body: "untrusted body",
    }).success).toBe(false);
    expect(createAdaptationInputSchema.safeParse({
      origin: "manual",
      format: "other",
      title: "Unsupported",
    }).success).toBe(false);
  });

  it("preserves Markdown body whitespace and enforces limits", () => {
    const body = "  slugline\n\n  action\n";
    const parsed = createManualAdaptationInputSchema.parse({ origin: "manual", format: "screenplay_scene", title: "Whitespace", body });
    expect(parsed.body).toBe(body);
    expect(createAdaptationInputSchema.safeParse({
      origin: "manual",
      format: "screenplay_scene",
      title: "Boundary",
      body: "x".repeat(ADAPTATION_BODY_MAX_LENGTH),
    }).success).toBe(true);
    expect(createAdaptationInputSchema.safeParse({
      origin: "manual",
      format: "screenplay_scene",
      title: "Too long",
      body: "x".repeat(ADAPTATION_BODY_MAX_LENGTH + 1),
    }).success).toBe(false);
  });

  it("requires a base revision and at least one changed field", () => {
    expect(updateAdaptationInputSchema.safeParse({}).success).toBe(false);
    expect(updateAdaptationInputSchema.safeParse({ baseUpdatedAt: "2026-01-01T00:00:00.000Z" }).success).toBe(false);
    expect(updateAdaptationInputSchema.safeParse({ baseUpdatedAt: "2026-01-01T00:00:00.000Z", body: "Updated" }).success).toBe(true);
    expect(updateAdaptationInputSchema.safeParse({ baseUpdatedAt: "2026-01-01T00:00:00.000Z", format: "screenplay_scene" }).success).toBe(false);
  });
});
