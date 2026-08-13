import { describe, expect, it } from "vitest";
import { z } from "zod";
import { storyBibleConflictResponse, validationResponse } from "./http";

describe("API validation envelope", () => {
  it("preserves root refinement messages in the top-level message and form errors", async () => {
    const schema = z.object({ title: z.string() }).refine(() => false, { message: "A title is required before continuing" });
    const response = validationResponse(schema.safeParse({ title: "" }).error!);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.message).toBe("A title is required before continuing");
    expect(payload.error.fieldErrors._form).toEqual(["A title is required before continuing"]);
    expect(payload.error.retryable).toBe(false);
  });

  it("returns the canonical Storyboard in a stable edit-conflict field", async () => {
    const currentStoryboard = { id: "33333333-3333-4333-8333-333333333333", version: 2 };
    const response = storyBibleConflictResponse("storyboard", currentStoryboard);
    await expect(response.json()).resolves.toEqual({ error: { code: "EDIT_CONFLICT", message: "The resource changed on the server. Review the current version before saving again.", currentStoryboard, retryable: false } });
    expect(response.status).toBe(409);
  });
});
