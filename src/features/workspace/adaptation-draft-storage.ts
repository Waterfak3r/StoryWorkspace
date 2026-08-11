import { z } from "zod";

export const adaptationDraftSchema = z.object({
  title: z.string().max(160),
  body: z.string().max(100_000),
}).strict();

export type AdaptationDraft = z.infer<typeof adaptationDraftSchema>;

export const adaptationDraftStorageRecordSchema = z.object({
  schemaVersion: z.literal(1),
  baseUpdatedAt: z.string().datetime({ offset: true }),
  draft: adaptationDraftSchema,
  editedAt: z.string().datetime({ offset: true }),
  sequence: z.number().int().positive(),
}).strict();

export type AdaptationDraftStorageRecord = z.infer<typeof adaptationDraftStorageRecordSchema>;

export interface AdaptationDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ADAPTATION_DRAFT_STORAGE_SCHEMA_VERSION = 1 as const;

export function adaptationDraftStorageKey(projectId: string, adaptationId: string) {
  return `story-workspace:adaptation-draft:${encodeURIComponent(projectId)}:${encodeURIComponent(adaptationId)}`;
}

export function adaptationDraftsEqual(left: AdaptationDraft, right: AdaptationDraft) {
  return left.title === right.title && left.body === right.body;
}

export function readAdaptationDraftRecord(storage: AdaptationDraftStorage | undefined, key: string): AdaptationDraftStorageRecord | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const result = adaptationDraftStorageRecordSchema.safeParse(JSON.parse(raw) as unknown);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function writeAdaptationDraftRecord(storage: AdaptationDraftStorage | undefined, key: string, record: AdaptationDraftStorageRecord) {
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

export function clearAdaptationDraftIfMatching(storage: AdaptationDraftStorage | undefined, key: string, expected: AdaptationDraftStorageRecord) {
  if (!storage) {
    return false;
  }
  const current = readAdaptationDraftRecord(storage, key);
  if (!current
    || current.schemaVersion !== expected.schemaVersion
    || current.baseUpdatedAt !== expected.baseUpdatedAt
    || current.editedAt !== expected.editedAt
    || current.sequence !== expected.sequence
    || !adaptationDraftsEqual(current.draft, expected.draft)) {
    return false;
  }
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
