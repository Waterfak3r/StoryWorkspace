import type { Chapter } from "@/domain/narrative";

export function sortChapters(chapters: Chapter[]) {
  return [...chapters].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function replaceCanonicalChapter(chapters: Chapter[], canonical: Chapter) {
  return sortChapters(chapters.map((chapter) => chapter.id === canonical.id ? canonical : chapter));
}

export function chapterSelectionAfterDelete(chapters: Chapter[], deletedId: string, selectedId: string | null) {
  if (selectedId !== deletedId) {
    return selectedId;
  }
  const ordered = sortChapters(chapters);
  const deletedIndex = ordered.findIndex((chapter) => chapter.id === deletedId);
  if (deletedIndex < 0) {
    return null;
  }
  return ordered[deletedIndex + 1]?.id ?? ordered[deletedIndex - 1]?.id ?? null;
}
