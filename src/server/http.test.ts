import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validationResponse } from "./http";

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
});
