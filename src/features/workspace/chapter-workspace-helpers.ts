import type { ChapterAutosaveStatus, ChapterDraft } from "./chapter-autosave";
import type { ChapterVersion } from "@/domain/narrative";

const statusLabels: Record<ChapterAutosaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved",
  saving: "Saving",
  failed: "Could not save",
  conflict: "Review conflict",
};

const sourceLabels: Record<ChapterVersion["source"], string> = {
  manual: "Manual snapshot",
  restore_backup: "Restore backup",
  ai: "AI accepted",
};

export function chapterStatusLabel(status: ChapterAutosaveStatus) {
  return statusLabels[status];
}

export function chapterVersionSourceLabel(source: ChapterVersion["source"]) {
  return sourceLabels[source];
}

function compareVersions(left: ChapterVersion, right: ChapterVersion) {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

export function mergeChapterVersions(...groups: ChapterVersion[][]) {
  const byId = new Map<string, ChapterVersion>();
  for (const group of groups) {
    for (const version of group) {
      byId.set(version.id, version);
    }
  }
  return [...byId.values()].sort(compareVersions);
}

export type ConflictDraftChoice = "local" | "server";

export function conflictDraftFor(choice: ConflictDraftChoice, local: ChapterDraft, server: ChapterDraft) {
  return { ...(choice === "local" ? local : server) };
}

export function localConflictDraft(draft: ChapterDraft, recoveryDraft: ChapterDraft | null) {
  return { ...(recoveryDraft ?? draft) };
}

export function chapterDraftFromCanonical(chapter: {
  title: string;
  summary: string;
  body: string;
  status: ChapterDraft["status"];
  outlineNodeId: string | null;
}): ChapterDraft {
  return {
    title: chapter.title,
    summary: chapter.summary,
    body: chapter.body,
    status: chapter.status,
    outlineNodeId: chapter.outlineNodeId,
  };
}
