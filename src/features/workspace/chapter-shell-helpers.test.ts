import { describe, expect, it } from "vitest";
import type { Chapter } from "@/domain/narrative";
import { chapterSelectionAfterDelete, replaceCanonicalChapter, sortChapters } from "./chapter-shell-helpers";

const projectId = "11111111-1111-4111-8111-111111111111";

function chapter(id: string, position: number, body = id): Chapter {
  return {
    id,
    projectId,
    outlineNodeId: null,
    title: id,
    summary: "",
    body,
    position,
    status: "planned",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("chapter shell helpers", () => {
  it("sorts by position and stable id", () => {
    const first = chapter("22222222-2222-4222-8222-222222222222", 0);
    const second = chapter("11111111-1111-4111-8111-111111111111", 0);
    expect(sortChapters([first, second]).map((item) => item.id)).toEqual([second.id, first.id]);
  });

  it("replaces one canonical chapter without changing unrelated records", () => {
    const first = chapter("11111111-1111-4111-8111-111111111111", 0);
    const second = chapter("22222222-2222-4222-8222-222222222222", 1);
    const replacement = chapter(second.id, 1, "updated");
    expect(replaceCanonicalChapter([first, second], replacement)).toEqual([first, replacement]);
  });

  it("selects the next chapter after deleting the selected one, otherwise the previous", () => {
    const first = chapter("11111111-1111-4111-8111-111111111111", 0);
    const second = chapter("22222222-2222-4222-8222-222222222222", 1);
    const third = chapter("33333333-3333-4333-8333-333333333333", 2);
    expect(chapterSelectionAfterDelete([first, second, third], second.id, second.id)).toBe(third.id);
    expect(chapterSelectionAfterDelete([first, second, third], third.id, third.id)).toBe(second.id);
    expect(chapterSelectionAfterDelete([first, second], second.id, first.id)).toBe(first.id);
  });
});
