import { chapterSchema, type Chapter } from "@/domain/narrative";
import { WorkspaceApiError } from "./workspace-api";
import {
  CHAPTER_DRAFT_STORAGE_SCHEMA_VERSION,
  chapterDraftsEqual,
  chapterDraftStorageKey,
  clearChapterDraftIfMatching,
  readChapterDraftRecord,
  type ChapterDraft,
  type ChapterDraftStorage,
  type ChapterDraftStorageRecord,
  writeChapterDraftRecord,
} from "./chapter-draft-storage";

export type { ChapterDraft } from "./chapter-draft-storage";

export type ChapterDraftPatch = Partial<ChapterDraft>;
export type ChapterAutosaveStatus = "saved" | "dirty" | "saving" | "failed" | "conflict";
export type ChapterRecoverySource = "session" | "conflict";

export type ChapterSaveInput = ChapterDraft & {
  baseUpdatedAt: string;
};

export type ChapterAutosaveTimer = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type ChapterAutosaveState = Readonly<{
  draft: ChapterDraft;
  acknowledgedChapter: Chapter;
  acknowledgedUpdatedAt: string;
  editSequence: number;
  acknowledgedSequence: number;
  inFlightSequence: number | null;
  pendingNewer: boolean;
  status: ChapterAutosaveStatus;
  error: WorkspaceApiError | null;
  serverChapter: Chapter | null;
  recoveryDraft: ChapterDraft | null;
  recoverySource: ChapterRecoverySource | null;
}>;

export type ChapterAutosaveOptions = {
  projectId: string;
  chapter: Chapter;
  saveChapter: (chapterId: string, input: ChapterSaveInput) => Promise<Chapter>;
  createManualSnapshot: (chapterId: string) => Promise<unknown>;
  storage?: ChapterDraftStorage;
  setTimeout?: ChapterAutosaveTimer["setTimeout"];
  clearTimeout?: ChapterAutosaveTimer["clearTimeout"];
  now?: () => string | Date;
  debounceMs?: number;
};

type SaveFlight = {
  sequence: number;
  baseUpdatedAt: string;
  draft: ChapterDraft;
  promise: Promise<void>;
};

type Listener = () => void;

const defaultTimer: ChapterAutosaveTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const defaultNow = () => new Date().toISOString();

function cloneDraft(draft: ChapterDraft): ChapterDraft {
  return { ...draft };
}

function draftFromChapter(chapter: Chapter): ChapterDraft {
  return {
    title: chapter.title,
    summary: chapter.summary,
    body: chapter.body,
    status: chapter.status,
    outlineNodeId: chapter.outlineNodeId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeError(value: unknown): WorkspaceApiError {
  if (value instanceof WorkspaceApiError) {
    return value;
  }

  if (isRecord(value)) {
    const status = typeof value.status === "number" ? value.status : 0;
    const code = typeof value.code === "string" ? value.code : "NETWORK_ERROR";
    const message = typeof value.message === "string" ? value.message : "The chapter could not be saved. Try again.";
    const retryable = typeof value.retryable === "boolean" ? value.retryable : true;
    const details = value.details ?? (value.currentChapter !== undefined ? { currentChapter: value.currentChapter } : undefined);
    return new WorkspaceApiError(status, { code, message, retryable, details });
  }

  return new WorkspaceApiError(0, {
    code: "NETWORK_ERROR",
    message: value instanceof Error && value.message ? value.message : "The chapter could not be saved. Try again.",
    retryable: true,
    details: value instanceof Error ? { cause: value.message } : undefined,
  });
}

function isConflict(error: WorkspaceApiError) {
  return error.status === 409 || error.code === "EDIT_CONFLICT";
}

function conflictChapter(error: WorkspaceApiError, chapterId: string, projectId: string) {
  const candidates: unknown[] = [];
  const details = error.details;
  if (isRecord(details)) {
    if ("currentChapter" in details) {
      candidates.push(details.currentChapter);
    }
    if ("chapter" in details) {
      candidates.push(details.chapter);
    }
  }
  candidates.push(details);

  for (const candidate of candidates) {
    const parsed = chapterSchema.safeParse(candidate);
    if (parsed.success && parsed.data.id === chapterId && parsed.data.projectId === projectId) {
      return parsed.data;
    }
  }
  return null;
}

function invalidConflictError(error: WorkspaceApiError) {
  return new WorkspaceApiError(409, {
    code: "INTERNAL_ERROR",
    message: "The server returned an invalid chapter conflict. Try again.",
    retryable: true,
    details: error.details,
  });
}

export class ChapterAutosaveCoordinator {
  private readonly projectId: string;
  private readonly chapterId: string;
  private readonly saveChapter: ChapterAutosaveOptions["saveChapter"];
  private readonly createManualSnapshot: ChapterAutosaveOptions["createManualSnapshot"];
  private readonly storage: ChapterDraftStorage | undefined;
  private readonly storageKey: string;
  private readonly setTimer: ChapterAutosaveTimer["setTimeout"];
  private readonly clearTimerHandle: ChapterAutosaveTimer["clearTimeout"];
  private readonly now: NonNullable<ChapterAutosaveOptions["now"]>;
  private readonly debounceMs: number;
  private readonly listeners = new Set<Listener>();
  private state: ChapterAutosaveState;
  private timerHandle: unknown = null;
  private inFlight: SaveFlight | null = null;
  private flushPromise: Promise<boolean> | null = null;
  private conflictResolutionInFlight = false;
  private keepLocalSaveStarted = false;
  private lastSessionRecord: ChapterDraftStorageRecord | null = null;
  private disposed = false;

  constructor(options: ChapterAutosaveOptions) {
    if (options.chapter.projectId !== options.projectId) {
      throw new Error("Chapter autosave project does not match the chapter");
    }
    this.projectId = options.projectId;
    this.chapterId = options.chapter.id;
    this.saveChapter = options.saveChapter;
    this.createManualSnapshot = options.createManualSnapshot;
    this.storage = options.storage;
    this.storageKey = chapterDraftStorageKey(this.projectId, this.chapterId);
    this.setTimer = options.setTimeout ?? defaultTimer.setTimeout;
    this.clearTimerHandle = options.clearTimeout ?? defaultTimer.clearTimeout;
    this.now = options.now ?? defaultNow;
    this.debounceMs = options.debounceMs ?? 800;

    this.state = {
      draft: draftFromChapter(options.chapter),
      acknowledgedChapter: options.chapter,
      acknowledgedUpdatedAt: options.chapter.updatedAt,
      editSequence: 0,
      acknowledgedSequence: 0,
      inFlightSequence: null,
      pendingNewer: false,
      status: "saved",
      error: null,
      serverChapter: null,
      recoveryDraft: null,
      recoverySource: null,
    };

    this.restoreSessionDraft();
  }

  getState(): ChapterAutosaveState {
    return this.state;
  }

  getSnapshot(): ChapterAutosaveState {
    return this.state;
  }

  subscribe(listener: Listener) {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  edit(patch: ChapterDraftPatch) {
    if (this.disposed) {
      return;
    }

    const nextDraft = cloneDraft(this.state.draft);
    for (const key of Object.keys(patch) as Array<keyof ChapterDraft>) {
      const value = patch[key];
      if (value !== undefined) {
        nextDraft[key] = value as never;
      }
    }

    const editSequence = this.state.editSequence + 1;
    const blocked = this.state.status === "conflict" || this.state.status === "failed";
    const waitingForConflictSnapshot = this.conflictResolutionInFlight && !this.keepLocalSaveStarted;
    const nextStatus: ChapterAutosaveStatus = blocked
      ? this.state.status
      : waitingForConflictSnapshot
        ? "saving"
      : this.inFlight
        ? "saving"
        : "dirty";

    this.state = {
      ...this.state,
      draft: nextDraft,
      editSequence,
      pendingNewer: this.inFlight !== null && editSequence > this.inFlight.sequence,
      status: nextStatus,
      error: blocked ? this.state.error : null,
    };
    this.writeSession(this.inFlight?.baseUpdatedAt ?? this.state.acknowledgedUpdatedAt, nextDraft, editSequence);
    if (!blocked && !waitingForConflictSnapshot) {
      this.scheduleDebounce();
    }
    this.notify();
  }

  retry() {
    if (this.disposed || this.state.status !== "failed") {
      return Promise.resolve(false);
    }
    this.state = { ...this.state, status: "dirty", error: null };
    this.notify();
    return this.flush();
  }

  flush() {
    if (this.disposed) {
      return Promise.resolve(false);
    }
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.cancelDebounce();
    const pending = this.flushUntilSettled();
    const settled = pending.finally(() => {
      if (this.flushPromise === settled) {
        this.flushPromise = null;
      }
    });
    this.flushPromise = settled;
    return settled;
  }

  applyCanonicalChapter(chapter: Chapter): boolean {
    const parsed = chapterSchema.safeParse(chapter);
    if (!parsed.success
      || parsed.data.id !== this.chapterId
      || parsed.data.projectId !== this.projectId
      || this.disposed
      || this.inFlight
      || this.conflictResolutionInFlight
      || this.state.status !== "saved") {
      return false;
    }

    this.cancelDebounce();
    this.clearStoredDraftIfMatching([this.state.draft, this.state.recoveryDraft]);
    const editSequence = this.state.editSequence;
    this.state = {
      ...this.state,
      draft: draftFromChapter(parsed.data),
      acknowledgedChapter: parsed.data,
      acknowledgedUpdatedAt: parsed.data.updatedAt,
      acknowledgedSequence: editSequence,
      inFlightSequence: null,
      pendingNewer: false,
      status: "saved",
      error: null,
      serverChapter: null,
      recoveryDraft: null,
      recoverySource: null,
    };
    this.notify();
    return true;
  }

  reportExternalConflict(chapter: Chapter, localDraft?: ChapterDraft): boolean {
    const parsed = chapterSchema.safeParse(chapter);
    if (!parsed.success
      || parsed.data.id !== this.chapterId
      || parsed.data.projectId !== this.projectId
      || this.disposed
      || this.inFlight
      || this.conflictResolutionInFlight) {
      return false;
    }

    this.cancelDebounce();
    const preservedDraft = cloneDraft(localDraft ?? this.state.draft);
    this.state = {
      ...this.state,
      draft: preservedDraft,
      status: "conflict",
      error: new WorkspaceApiError(409, {
        code: "EDIT_CONFLICT",
        message: "The chapter changed before the AI draft could be accepted. Review both versions.",
        retryable: false,
        currentChapter: parsed.data,
      }),
      serverChapter: parsed.data,
      recoveryDraft: preservedDraft,
      recoverySource: "conflict",
      inFlightSequence: null,
      pendingNewer: false,
    };
    this.notify();
    return true;
  }

  resolveUseServer() {
    if (this.disposed || this.conflictResolutionInFlight || !this.state.serverChapter) {
      return false;
    }

    const serverChapter = this.state.serverChapter;
    this.cancelDebounce();
    this.clearStoredDraftIfMatching([this.state.draft, this.state.recoveryDraft]);
    const editSequence = this.state.editSequence;
    this.state = {
      ...this.state,
      draft: draftFromChapter(serverChapter),
      acknowledgedChapter: serverChapter,
      acknowledgedUpdatedAt: serverChapter.updatedAt,
      acknowledgedSequence: editSequence,
      inFlightSequence: null,
      pendingNewer: false,
      status: "saved",
      error: null,
      serverChapter: null,
      recoveryDraft: null,
      recoverySource: null,
    };
    this.notify();
    return true;
  }

  resolveKeepLocal() {
    return this.keepLocal();
  }

  useServerVersion() {
    return this.resolveUseServer();
  }

  keepMyDraft() {
    return this.keepLocal();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.cancelDebounce();
    this.listeners.clear();
  }

  private restoreSessionDraft() {
    const record = this.readSessionRecord();
    if (!record) {
      return;
    }

    const canonicalDraft = this.state.draft;
    if (chapterDraftsEqual(record.draft, canonicalDraft)) {
      this.clearSessionRecord(record);
      return;
    }

    if (record.baseUpdatedAt === this.state.acknowledgedUpdatedAt) {
      this.state = {
        ...this.state,
        draft: cloneDraft(record.draft),
        editSequence: record.sequence,
        status: "dirty",
        recoverySource: "session",
      };
      this.scheduleDebounce();
      return;
    }

    this.state = {
      ...this.state,
      status: "conflict",
      error: new WorkspaceApiError(409, {
        code: "EDIT_CONFLICT",
        message: "A local draft is based on an older chapter revision.",
        retryable: false,
        details: { currentChapter: this.state.acknowledgedChapter },
      }),
      serverChapter: this.state.acknowledgedChapter,
      recoveryDraft: cloneDraft(record.draft),
      recoverySource: "session",
      editSequence: record.sequence,
      acknowledgedSequence: record.sequence,
    };
  }

  private scheduleDebounce() {
    this.cancelDebounce();
    if (this.disposed || this.state.status === "conflict" || this.state.status === "failed" || (this.conflictResolutionInFlight && !this.keepLocalSaveStarted)) {
      return;
    }
    this.timerHandle = this.setTimer(() => {
      this.timerHandle = null;
      if (this.disposed || this.inFlight || this.state.status === "conflict" || this.state.status === "failed" || (this.conflictResolutionInFlight && !this.keepLocalSaveStarted)) {
        return;
      }
      void this.startSave();
    }, this.debounceMs);
  }

  private cancelDebounce() {
    if (this.timerHandle === null) {
      return;
    }
    this.clearTimerHandle(this.timerHandle);
    this.timerHandle = null;
  }

  private startSave(force = false, baseOverride?: string) {
    if (this.disposed || this.inFlight || this.state.status === "conflict" || this.state.status === "failed" || (this.conflictResolutionInFlight && !this.keepLocalSaveStarted && !force)) {
      return null;
    }
    if (!force && this.state.editSequence <= this.state.acknowledgedSequence) {
      return null;
    }

    this.cancelDebounce();
    const flight: SaveFlight = {
      sequence: this.state.editSequence,
      baseUpdatedAt: baseOverride ?? this.state.acknowledgedUpdatedAt,
      draft: cloneDraft(this.state.draft),
      promise: Promise.resolve(),
    };
    this.inFlight = flight;
    this.state = {
      ...this.state,
      status: "saving",
      inFlightSequence: flight.sequence,
      pendingNewer: this.state.editSequence > flight.sequence,
    };
    this.notify();

    let request: Promise<Chapter>;
    try {
      request = this.saveChapter(this.chapterId, { ...flight.draft, baseUpdatedAt: flight.baseUpdatedAt });
    } catch (error) {
      request = Promise.reject(error);
    }
    flight.promise = request.then(
      (chapter) => this.completeSuccess(flight, chapter),
      (error) => this.completeFailure(flight, error),
    );
    return flight.promise;
  }

  private completeSuccess(flight: SaveFlight, response: Chapter) {
    if (this.inFlight !== flight) {
      return;
    }
    const parsed = chapterSchema.safeParse(response);
    if (!parsed.success || parsed.data.id !== this.chapterId || parsed.data.projectId !== this.projectId) {
      this.completeFailure(flight, new WorkspaceApiError(500, {
        code: "INTERNAL_ERROR",
        message: "The workspace returned an invalid chapter.",
        retryable: true,
      }));
      return;
    }
    if (this.disposed) {
      this.inFlight = null;
      return;
    }

    const chapter = parsed.data;
    const hasNewer = this.state.editSequence > flight.sequence;
    this.inFlight = null;
    this.state = {
      ...this.state,
      acknowledgedChapter: chapter,
      acknowledgedUpdatedAt: chapter.updatedAt,
      acknowledgedSequence: flight.sequence,
      inFlightSequence: null,
      pendingNewer: hasNewer,
      status: hasNewer ? "dirty" : "saved",
      draft: hasNewer ? this.state.draft : draftFromChapter(chapter),
      error: null,
      serverChapter: null,
      recoveryDraft: null,
      recoverySource: null,
    };

    if (hasNewer) {
      this.writeSession(chapter.updatedAt, this.state.draft, this.state.editSequence);
    } else {
      this.clearSessionRecord({
        baseUpdatedAt: flight.baseUpdatedAt,
        draft: flight.draft,
        sequence: flight.sequence,
      });
    }
    this.notify();

    if (hasNewer) {
      this.cancelDebounce();
      void this.startSave();
    }
  }

  private completeFailure(flight: SaveFlight, value: unknown) {
    if (this.inFlight !== flight) {
      return;
    }
    this.inFlight = null;
    this.cancelDebounce();
    if (this.disposed) {
      return;
    }

    const error = normalizeError(value);
    const serverChapter = isConflict(error) ? conflictChapter(error, this.chapterId, this.projectId) : null;
    if (isConflict(error) && serverChapter) {
      this.state = {
        ...this.state,
        status: "conflict",
        error,
        serverChapter,
        recoveryDraft: null,
        recoverySource: "conflict",
        inFlightSequence: null,
        pendingNewer: this.state.editSequence > flight.sequence,
      };
    } else {
      this.state = {
        ...this.state,
        status: "failed",
        error: isConflict(error) ? invalidConflictError(error) : error,
        inFlightSequence: null,
        pendingNewer: this.state.editSequence > flight.sequence,
      };
    }
    this.notify();
  }

  private async flushUntilSettled(): Promise<boolean> {
    while (!this.disposed) {
      if (this.state.status === "conflict" || this.state.status === "failed") {
        return false;
      }

      if (this.inFlight) {
        await this.inFlight.promise;
        continue;
      }

      if (this.state.editSequence <= this.state.acknowledgedSequence) {
        return this.state.status === "saved";
      }

      const request = this.startSave();
      if (!request) {
        return false;
      }
      await request;
    }
    return false;
  }

  private async keepLocal(): Promise<boolean> {
    if (this.disposed || this.conflictResolutionInFlight || this.inFlight || !this.state.serverChapter) {
      return false;
    }

    const serverChapter = this.state.serverChapter;
    const localDraft = cloneDraft(this.state.recoveryDraft ?? this.state.draft);
    this.conflictResolutionInFlight = true;
    this.keepLocalSaveStarted = false;
    this.state = {
      ...this.state,
      draft: localDraft,
      status: "saving",
      error: null,
    };
    this.notify();

    try {
      await this.createManualSnapshot(this.chapterId);
      if (this.disposed) {
        return false;
      }

      this.state = {
        ...this.state,
        acknowledgedChapter: serverChapter,
        acknowledgedUpdatedAt: serverChapter.updatedAt,
        status: "dirty",
      };
      this.notify();
      this.writeSession(serverChapter.updatedAt, this.state.draft, this.state.editSequence);
      this.keepLocalSaveStarted = true;
      const request = this.startSave(true, serverChapter.updatedAt);
      if (!request) {
        return false;
      }
      const result = await this.flush();
      if (!result && this.state.status === "failed" && this.state.serverChapter) {
        this.state = { ...this.state, status: "conflict" };
        this.notify();
      }
      return result;
    } catch (value) {
      if (!this.disposed) {
        this.state = {
          ...this.state,
          status: "conflict",
          error: normalizeError(value),
          serverChapter: this.state.serverChapter ?? serverChapter,
          recoverySource: "conflict",
        };
        this.notify();
      }
      return false;
    } finally {
      this.conflictResolutionInFlight = false;
      this.keepLocalSaveStarted = false;
    }
  }

  private writeSession(baseUpdatedAt: string, draft: ChapterDraft, sequence: number) {
    const record: ChapterDraftStorageRecord = {
      schemaVersion: CHAPTER_DRAFT_STORAGE_SCHEMA_VERSION,
      baseUpdatedAt,
      draft: cloneDraft(draft),
      editedAt: this.timestamp(),
      sequence,
    };
    if (writeChapterDraftRecord(this.storage, this.storageKey, record)) {
      this.lastSessionRecord = record;
    }
  }

  private clearStoredDraftIfMatching(drafts: Array<ChapterDraft | null>) {
    const record = this.lastSessionRecord;
    if (!record || !drafts.some((draft) => draft !== null && chapterDraftsEqual(record.draft, draft))) {
      return;
    }
    this.clearSessionRecord(record);
  }

  private readSessionRecord() {
    const record = readChapterDraftRecord(this.storage, this.storageKey);
    this.lastSessionRecord = record;
    return record;
  }

  private clearSessionRecord(expected: Pick<ChapterDraftStorageRecord, "baseUpdatedAt" | "draft" | "sequence">) {
    const tracked = this.lastSessionRecord;
    if (!tracked
      || tracked.baseUpdatedAt !== expected.baseUpdatedAt
      || tracked.sequence !== expected.sequence
      || !chapterDraftsEqual(tracked.draft, expected.draft)) {
      return false;
    }
    const cleared = clearChapterDraftIfMatching(this.storage, this.storageKey, tracked);
    if (cleared) {
      this.lastSessionRecord = null;
    }
    return cleared;
  }

  private timestamp() {
    const value = this.now();
    return value instanceof Date ? value.toISOString() : value;
  }

  private notify() {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

export function createChapterAutosaveCoordinator(options: ChapterAutosaveOptions) {
  return new ChapterAutosaveCoordinator(options);
}
