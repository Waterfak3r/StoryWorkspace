import { z } from "zod";
import { chapterStatusSchema } from "@/domain/narrative";

export const chapterDraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  status: chapterStatusSchema,
  outlineNodeId: z.string().uuid().nullable(),
}).strict();

export type ChapterDraft = z.infer<typeof chapterDraftSchema>;

export const chapterDraftStorageRecordSchema = z.object({
  schemaVersion: z.literal(1),
  baseUpdatedAt: z.string().datetime({ offset: true }),
  draft: chapterDraftSchema,
  editedAt: z.string().datetime({ offset: true }),
  sequence: z.number().int().positive(),
}).strict();

export type ChapterDraftStorageRecord = z.infer<typeof chapterDraftStorageRecordSchema>;

export interface ChapterDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CHAPTER_DRAFT_STORAGE_SCHEMA_VERSION = 1 as const;

export function chapterDraftStorageKey(projectId: string, chapterId: string) {
  return `story-workspace:chapter-draft:${encodeURIComponent(projectId)}:${encodeURIComponent(chapterId)}`;
}

export function chapterDraftsEqual(left: ChapterDraft, right: ChapterDraft) {
  return left.title === right.title
    && left.summary === right.summary
    && left.body === right.body
    && left.status === right.status
    && left.outlineNodeId === right.outlineNodeId;
}

export function readChapterDraftRecord(storage: ChapterDraftStorage | undefined, key: string): ChapterDraftStorageRecord | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    const result = chapterDraftStorageRecordSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function writeChapterDraftRecord(
  storage: ChapterDraftStorage | undefined,
  key: string,
  record: ChapterDraftStorageRecord,
) {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearChapterDraftIfMatching(
  storage: ChapterDraftStorage | undefined,
  key: string,
  expected: ChapterDraftStorageRecord,
) {
  if (!storage) {
    return false;
  }

  const current = readChapterDraftRecord(storage, key);
  if (!current
    || current.schemaVersion !== expected.schemaVersion
    || current.baseUpdatedAt !== expected.baseUpdatedAt
    || current.editedAt !== expected.editedAt
    || current.sequence !== expected.sequence
    || !chapterDraftsEqual(current.draft, expected.draft)) {
    return false;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
