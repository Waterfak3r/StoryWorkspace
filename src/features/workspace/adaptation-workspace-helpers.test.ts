import { describe, expect, it } from "vitest";
import { adaptationConflictDraft, adaptationStatusLabel } from "./adaptation-workspace-helpers";

describe("adaptation workspace helpers", () => {
  it("labels all autosave states plainly", () => {
    expect(adaptationStatusLabel("saved")).toBe("Saved");
    expect(adaptationStatusLabel("dirty")).toBe("Unsaved");
    expect(adaptationStatusLabel("saving")).toBe("Saving");
    expect(adaptationStatusLabel("failed")).toBe("Could not save");
    expect(adaptationStatusLabel("conflict")).toBe("Review conflict");
  });

  it("uses the preserved local recovery draft for conflict review", () => {
    const canonical = { title: "Server", body: "Server body" };
    const local = { title: "Local", body: "Local body" };
    expect(adaptationConflictDraft(canonical, local)).toBe(local);
    expect(adaptationConflictDraft(canonical, null)).toBe(canonical);
  });
});
