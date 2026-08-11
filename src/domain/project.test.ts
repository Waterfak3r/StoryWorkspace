import { describe, expect, it } from "vitest";
import { createProjectInputSchema, updateProjectInputSchema } from "./project";

describe("project input schemas", () => {
  it("trims valid creation input and fills optional fields", () => {
    expect(
      createProjectInputSchema.parse({
        title: "  The Last Orchard  ",
      }),
    ).toEqual({ title: "The Last Orchard", premise: "", genre: "" });
  });

  it("rejects an empty title with a field-level message", () => {
    const result = createProjectInputSchema.safeParse({ title: "   " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Project title is required");
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });

  it("rejects an update with no changes", () => {
    expect(updateProjectInputSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields on create and update", () => {
    expect(createProjectInputSchema.safeParse({ title: "Known", extra: "nope" }).success).toBe(false);
    expect(updateProjectInputSchema.safeParse({ title: "Known", extra: "nope" }).success).toBe(false);
  });

  it("enforces title, premise, and genre length boundaries", () => {
    expect(createProjectInputSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ title: "Valid", premise: "x".repeat(2001) }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ title: "Valid", genre: "x".repeat(81) }).success).toBe(false);
    expect(updateProjectInputSchema.safeParse({ title: "x".repeat(121) }).success).toBe(false);
  });
});
