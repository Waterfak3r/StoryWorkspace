import { describe, expect, it } from "vitest";
import { initializeSelectionDraft, workspaceSelectionKey } from "./workspace-selection";

type RecordItem = { id: string; title: string };

const records: RecordItem[] = [
  { id: "a", title: "Canonical A" },
  { id: "b", title: "Canonical B" },
];

function draftFor(record: RecordItem | undefined) {
  return { title: record?.title ?? "" };
}

describe("workspace selection state", () => {
  it("initializes existing A and existing B from their own canonical records", () => {
    const stateA = initializeSelectionDraft("a", records, (record) => record.id, draftFor);
    const stateB = initializeSelectionDraft("b", records, (record) => record.id, draftFor);

    expect(stateA).toEqual({ draft: { title: "Canonical A" }, dirty: false, error: null, notice: null });
    expect(stateB).toEqual({ draft: { title: "Canonical B" }, dirty: false, error: null, notice: null });
  });

  it("initializes existing A to a blank new-record draft", () => {
    const stateA = initializeSelectionDraft("a", records, (record) => record.id, draftFor);
    const stateNew = initializeSelectionDraft(null, records, (record) => record.id, draftFor);

    expect(stateA.draft).toEqual({ title: "Canonical A" });
    expect(stateNew).toEqual({ draft: { title: "" }, dirty: false, error: null, notice: null });
  });

  it("gives each existing selection and New its own remount key", () => {
    expect(workspaceSelectionKey("bible", "a")).not.toBe(workspaceSelectionKey("bible", "b"));
    expect(workspaceSelectionKey("bible", "a")).not.toBe(workspaceSelectionKey("bible", null));
    expect(workspaceSelectionKey("outline", "a")).not.toBe(workspaceSelectionKey("bible", "a"));
  });

});
