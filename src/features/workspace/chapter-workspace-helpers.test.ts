import { describe, expect, it } from "vitest";
import type { ChapterVersion } from "@/domain/narrative";
import {
  chapterStatusLabel,
  chapterVersionSourceLabel,
  conflictDraftFor,
  localConflictDraft,
  mergeChapterVersions,
} from "./chapter-workspace-helpers";
import type { ChapterDraft } from "./chapter-autosave";

const draft: ChapterDraft = {
  title: "Local title",
  summary: "Local summary",
  body: "Local body",
  status: "draft",
  outlineNodeId: null,
};

const serverDraft: ChapterDraft = {
  title: "Server title",
  summary: "Server summary",
  body: "Server body",
  status: "revised",
  outlineNodeId: "33333333-3333-4333-8333-333333333333",
};

function version(id: string, createdAt: string, source: ChapterVersion["source"] = "manual"): ChapterVersion {
  return {
    id,
    chapterId: "22222222-2222-4222-8222-222222222222",
    body: `${id} body`,
    source,
    aiAction: null,
    instruction: null,
    contextReferenceIds: [],
    createdAt,
  };
}

describe("chapter workspace helpers", () => {
  it("maps every autosave state to the visible status copy", () => {
    expect(chapterStatusLabel("saved")).toBe("Saved");
    expect(chapterStatusLabel("dirty")).toBe("Unsaved");
    expect(chapterStatusLabel("saving")).toBe("Saving");
    expect(chapterStatusLabel("failed")).toBe("Could not save");
    expect(chapterStatusLabel("conflict")).toBe("Review conflict");
    expect(chapterVersionSourceLabel("restore_backup")).toBe("Restore backup");
  });

  it("deduplicates versions by id and sorts newest first", () => {
    const older = version("11111111-1111-4111-8111-111111111111", "2026-01-01T00:00:00.000Z");
    const newer = version("22222222-2222-4222-8222-222222222222", "2026-01-02T00:00:00.000Z");
    const replacement = version(older.id, "2026-01-03T00:00:00.000Z", "restore_backup");

    expect(mergeChapterVersions([older, newer], [replacement])).toEqual([replacement, newer]);
  });

  it("keeps history written locally while a late list response is merged", () => {
    const listed = version("11111111-1111-4111-8111-111111111111", "2026-01-01T00:00:00.000Z");
    const snapshot = version("22222222-2222-4222-8222-222222222222", "2026-01-02T00:00:00.000Z");
    const backup = version("33333333-3333-4333-8333-333333333333", "2026-01-03T00:00:00.000Z", "restore_backup");
    const restored = version("44444444-4444-4444-8444-444444444444", "2026-01-04T00:00:00.000Z");

    expect(mergeChapterVersions([listed], [snapshot, backup], [restored]).map((item) => item.id)).toEqual([
      restored.id,
      backup.id,
      snapshot.id,
      listed.id,
    ]);
  });

  it("returns an isolated local or server conflict draft", () => {
    const local = conflictDraftFor("local", draft, serverDraft);
    const server = conflictDraftFor("server", draft, serverDraft);

    expect(local).toEqual(draft);
    expect(server).toEqual(serverDraft);
    expect(local).not.toBe(draft);
    expect(server).not.toBe(serverDraft);
  });

  it("prefers a recovered local draft over the canonical draft in a conflict", () => {
    expect(localConflictDraft(draft, serverDraft)).toEqual(serverDraft);
    expect(localConflictDraft(draft, null)).toEqual(draft);
  });
});
