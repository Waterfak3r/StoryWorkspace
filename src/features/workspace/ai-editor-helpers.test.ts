import { describe, expect, it } from "vitest";
import { CHAPTER_BODY_MAX_LENGTH } from "@/domain/narrative";
import { canApplyCanonicalAiAcceptance, composeAiBody, resolveInsertCaret, selectionStillMatches, type AiSelectionSnapshot } from "./ai-editor-helpers";

const selection: AiSelectionSnapshot = {
  start: 6,
  end: 11,
  text: "world",
  editSequence: 3,
};

describe("AI editor body composition", () => {
  it("recognizes an unchanged captured selection", () => {
    expect(selectionStillMatches("hello world", 3, selection)).toBe(true);
    expect(selectionStillMatches("hello brave world", 3, selection)).toBe(false);
    expect(selectionStillMatches("hello world", 4, selection)).toBe(false);
  });

  it("replaces only a still-current selection", () => {
    expect(composeAiBody("hello world", "there", "replace", selection, 0, 3)).toBe("hello there");
    expect(composeAiBody("hello world", "there", "replace", selection, 0, 4)).toBeNull();
    expect(composeAiBody("hello brave world", "there", "replace", selection, 0, 3)).toBeNull();
  });

  it("inserts at the latest caret without changing surrounding prose", () => {
    expect(composeAiBody("hello world", " brave", "insert", null, 5)).toBe("hello brave world");
    expect(composeAiBody("hello", "!", "insert", null, 999)).toBe("hello!");
  });

  it("keeps the generation selection as the replace target after a later selection", () => {
    const generationSelection: AiSelectionSnapshot = { start: 0, end: 5, text: "hello", editSequence: 3 };
    const laterSelection: AiSelectionSnapshot = { start: 6, end: 11, text: "world", editSequence: 3 };
    expect(selectionStillMatches("hello world", 3, generationSelection)).toBe(true);
    expect(composeAiBody("hello world", "there", "replace", generationSelection, 0, 3)).toBe("there world");
    expect(composeAiBody("hello world", "there", "replace", laterSelection, 0, 3)).toBe("hello there");
  });

  it("uses the body end when Insert has not touched the editor and clamps touched carets", () => {
    expect(resolveInsertCaret(12, 0, false)).toBe(12);
    expect(resolveInsertCaret(12, 12, true)).toBe(12);
    expect(resolveInsertCaret(12, 99, true)).toBe(12);
    expect(resolveInsertCaret(12, -4, true)).toBe(0);
    expect(resolveInsertCaret(12, undefined, true)).toBe(12);
  });

  it("only applies a canonical lost-response chapter when the submitted body matches", () => {
    expect(canApplyCanonicalAiAcceptance("submitted", "submitted", true)).toBe(true);
    expect(canApplyCanonicalAiAcceptance("server edit", "submitted", true)).toBe(false);
    expect(canApplyCanonicalAiAcceptance("submitted", "submitted", false)).toBe(false);
  });

  it("keeps insert and replace composition observable at the shared body boundary", () => {
    const body = "x".repeat(CHAPTER_BODY_MAX_LENGTH - 1);
    expect(composeAiBody(body, "y", "insert", null, body.length)).toHaveLength(CHAPTER_BODY_MAX_LENGTH);
    expect(composeAiBody(body, "yy", "insert", null, body.length)).toHaveLength(CHAPTER_BODY_MAX_LENGTH + 1);
    const captured: AiSelectionSnapshot = { start: 0, end: 1, text: "x", editSequence: 1 };
    expect(composeAiBody(body, "y", "replace", captured, 0, 1)).toHaveLength(CHAPTER_BODY_MAX_LENGTH - 1);
  });
});
