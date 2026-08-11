import { describe, expect, it } from "vitest";
import { exportPreviewSections } from "./export-preview-helpers";

describe("export preview sections", () => {
  it("keeps the deterministic project export order and counts", () => {
    expect(exportPreviewSections({ bibleEntries: 2, outlineNodes: 4, chapters: 3, adaptations: 1 })).toEqual([
      { id: "project", label: "Project", count: 1 },
      { id: "bible", label: "Story bible entries", count: 2 },
      { id: "outline", label: "Outline nodes", count: 4 },
      { id: "chapters", label: "Chapters", count: 3 },
      { id: "adaptations", label: "Adaptations", count: 1 },
    ]);
  });
});
