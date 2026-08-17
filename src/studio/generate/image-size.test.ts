import { describe, expect, it } from "vitest";

import { normalizeImageSize } from "./image-size";

describe("normalizeImageSize", () => {
  it("maps unofficial square sizes to a gpt-image size", () => {
    expect(normalizeImageSize("1080x1080", "gpt-image-2-only1k2k")).toBe("1024x1024");
    expect(normalizeImageSize("3840x2160", "gpt-image-2")).toBe("1536x1024");
    expect(normalizeImageSize("1024x1024", "gpt-image-2")).toBe("1024x1024");
  });

  it("leaves non-gpt image sizes unchanged", () => {
    expect(normalizeImageSize("1080x1080", "sdxl")).toBe("1080x1080");
  });
});
