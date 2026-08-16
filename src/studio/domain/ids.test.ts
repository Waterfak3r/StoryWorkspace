import { describe, expect, it } from "vitest";

import {
  allocateUniqueSlug,
  isStudioSlug,
  nextNumberedId,
  slugifyTitle,
  STUDIO_SLUG_MAX_LENGTH,
  STUDIO_SLUG_REGEX,
} from "./ids";

describe("studio slugs", () => {
  it("accepts ids that match the workspace slug regex", () => {
    expect(STUDIO_SLUG_REGEX.test("harbor-night")).toBe(true);
    expect(isStudioSlug("a")).toBe(true);
    expect(isStudioSlug("volume-01")).toBe(true);
    expect(isStudioSlug(`${"a".repeat(STUDIO_SLUG_MAX_LENGTH)}`)).toBe(true);
  });

  it("rejects ids that are empty, too long, or use illegal characters", () => {
    expect(isStudioSlug("")).toBe(false);
    expect(isStudioSlug("Harbor-Night")).toBe(false);
    expect(isStudioSlug("1harbor")).toBe(false);
    expect(isStudioSlug("-harbor")).toBe(false);
    expect(isStudioSlug("harbor_night")).toBe(false);
    expect(isStudioSlug("harbor.night")).toBe(false);
    expect(isStudioSlug("harbor/night")).toBe(false);
    expect(isStudioSlug(`${"a".repeat(STUDIO_SLUG_MAX_LENGTH + 1)}`)).toBe(false);
  });

  it("slugifies titles into lowercase hyphenated slugs", () => {
    expect(slugifyTitle("Harbor Night")).toBe("harbor-night");
    expect(slugifyTitle("  Harbor   Night!! ")).toBe("harbor-night");
    expect(slugifyTitle("Café Harbor")).toBe("caf-harbor");
  });

  it("uses project or project- when the slug would be empty or start with a digit", () => {
    expect(slugifyTitle("")).toBe("project");
    expect(slugifyTitle("!!!")).toBe("project");
    expect(slugifyTitle("---")).toBe("project");
    expect(slugifyTitle("123 Harbor")).toBe("project-123-harbor");
    expect(slugifyTitle("9 lives")).toBe("project-9-lives");
    expect(slugifyTitle("42")).toBe("project-42");
  });

  it("truncates long slugs so they still match the regex", () => {
    const slug = slugifyTitle(`Harbor ${"Night ".repeat(40)}`);
    expect(slug.length).toBeLessThanOrEqual(STUDIO_SLUG_MAX_LENGTH);
    expect(isStudioSlug(slug)).toBe(true);

    const numeric = slugifyTitle(`123 ${"x".repeat(80)}`);
    expect(numeric.startsWith("project-")).toBe(true);
    expect(numeric.length).toBeLessThanOrEqual(STUDIO_SLUG_MAX_LENGTH);
    expect(isStudioSlug(numeric)).toBe(true);
  });

  it("allocates -2 then -3 on collisions, not -01", () => {
    const taken = new Set(["harbor-night"]);
    const second = allocateUniqueSlug("harbor-night", (id) => taken.has(id));
    expect(second).toBe("harbor-night-2");
    taken.add(second);

    const third = allocateUniqueSlug("harbor-night", (id) => taken.has(id));
    expect(third).toBe("harbor-night-3");
  });

  it("generates numbered ids with at least two digits and continues after 99", () => {
    expect(nextNumberedId("character", [])).toBe("character-01");
    expect(nextNumberedId("scene", ["scene-01"])).toBe("scene-02");
    expect(nextNumberedId("volume", ["volume-01", "volume-03"])).toBe("volume-04");
    expect(nextNumberedId("character", ["character-99"])).toBe("character-100");
    expect(nextNumberedId("location", ["location-01", "dock"])).toBe("location-02");
  });
});
