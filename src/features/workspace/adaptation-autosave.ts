import { adaptationSchema, type Adaptation } from "@/domain/adaptation";
import { WorkspaceApiError } from "./workspace-api";
import {
  ADAPTATION_DRAFT_STORAGE_SCHEMA_VERSION,
  adaptationDraftSchema,
  adaptationDraftsEqual,
  adaptationDraftStorageKey,
  clearAdaptationDraftIfMatching,
  readAdaptationDraftRecord,
  type AdaptationDraft,
  type AdaptationDraftStorage,
  type AdaptationDraftStorageRecord,
  writeAdaptationDraftRecord,
} from "./adaptation-draft-storage";

export type { AdaptationDraft } from "./adaptation-draft-storage";

export type AdaptationDraftPatch = Partial<AdaptationDraft>;
export type AdaptationAutosaveStatus = "saved" | "dirty" | "saving" | "failed" | "conflict";
export type AdaptationRecoverySource = "session" | "conflict";
export type AdaptationSaveInput = AdaptationDraft & { baseUpdatedAt: string };

export type AdaptationAutosaveTimer = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type AdaptationAutosaveState = Readonly<{
  draft: AdaptationDraft;
  acknowledgedAdaptation: Adaptation;
  acknowledgedUpdatedAt: string;
  editSequence: number;
  acknowledgedSequence: number;
  inFlightSequence: number | null;
  pendingNewer: boolean;
  status: AdaptationAutosaveStatus;
  error: WorkspaceApiError | null;
  serverAdaptation: Adaptation | null;
  recoveryDraft: AdaptationDraft | null;
  recoverySource: AdaptationRecoverySource | null;
}>;

export type AdaptationAutosaveOptions = {
  projectId: string;
  adaptation: Adaptation;
  saveAdaptation: (adaptationId: string, input: AdaptationSaveInput) => Promise<Adaptation>;
  storage?: AdaptationDraftStorage;
  setTimeout?: AdaptationAutosaveTimer["setTimeout"];
  clearTimeout?: AdaptationAutosaveTimer["clearTimeout"];
  now?: () => string | Date;
  debounceMs?: number;
};

type SaveFlight = {
  sequence: number;
  baseUpdatedAt: string;
  draft: AdaptationDraft;
  promise: Promise<void>;
};

type Listener = () => void;

const defaultTimer: AdaptationAutosaveTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const defaultNow = () => new Date().toISOString();

function draftFromAdaptation(adaptation: Adaptation): AdaptationDraft {
  return { title: adaptation.title, body: adaptation.body };
}

function cloneDraft(draft: AdaptationDraft): AdaptationDraft {
  return { ...draft };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeError(value: unknown) {
  if (value instanceof WorkspaceApiError) {
    return value;
  }
  if (isRecord(value)) {
    const status = typeof value.status === "number" ? value.status : 0;
    const code = typeof value.code === "string" ? value.code : "NETWORK_ERROR";
    const message = typeof value.message === "string" ? value.message : "The adaptation could not be saved. Try again.";
    const retryable = typeof value.retryable === "boolean" ? value.retryable : true;
    const currentAdaptation = value.currentAdaptation;
    return new WorkspaceApiError(status, {
      code,
      message,
      retryable,
      details: value.details ?? (currentAdaptation !== undefined ? { currentAdaptation } : undefined),
      currentAdaptation,
    });
  }
  return new WorkspaceApiError(0, {
    code: "NETWORK_ERROR",
    message: value instanceof Error && value.message ? value.message : "The adaptation could not be saved. Try again.",
    retryable: true,
    details: value instanceof Error ? { cause: value.message } : undefined,
  });
}

function isConflict(error: WorkspaceApiError) {
  return error.status === 409 || error.code === "EDIT_CONFLICT";
}

function conflictAdaptation(error: WorkspaceApiError, adaptationId: string, projectId: string) {
  const candidates: unknown[] = [error.currentAdaptation];
  if (isRecord(error.details)) {
    if ("currentAdaptation" in error.details) {
      candidates.push(error.details.currentAdaptation);
    }
    if ("adaptation" in error.details) {
      candidates.push(error.details.adaptation);
    }
  }
  candidates.push(error.details);
  for (const candidate of candidates) {
    const parsed = adaptationSchema.safeParse(candidate);
    if (parsed.success && parsed.data.id === adaptationId && parsed.data.projectId === projectId) {
      return parsed.data;
    }
  }
  return null;
}

function invalidConflictError(error: WorkspaceApiError) {
  return new WorkspaceApiError(409, {
    code: "INTERNAL_ERROR",
    message: "The server returned an invalid adaptation conflict. Try again.",
    retryable: true,
    details: error.details,
  });
}

export class AdaptationAutosaveCoordinator {
  private readonly projectId: string;
  private readonly adaptationId: string;
  private readonly saveAdaptation: AdaptationAutosaveOptions["saveAdaptation"];
  private readonly storage: AdaptationDraftStorage | undefined;
  private readonly storageKey: string;
  private readonly setTimer: AdaptationAutosaveTimer["setTimeout"];
  private readonly clearTimerHandle: AdaptationAutosaveTimer["clearTimeout"];
  private readonly now: NonNullable<AdaptationAutosaveOptions["now"]>;
  private readonly debounceMs: number;
  private readonly listeners = new Set<Listener>();
  private state: AdaptationAutosaveState;
  private timerHandle: unknown = null;
  private inFlight: SaveFlight | null = null;
  private flushPromise: Promise<boolean> | null = null;
  private conflictResolutionInFlight = false;
  private keepLocalSaveStarted = false;
  private lastSessionRecord: AdaptationDraftStorageRecord | null = null;
  private disposed = false;

  constructor(options: AdaptationAutosaveOptions) {
    if (options.adaptation.projectId !== options.projectId) {
      throw new Error("Adaptation autosave project does not match the adaptation");
    }
    this.projectId = options.projectId;
    this.adaptationId = options.adaptation.id;
    this.saveAdaptation = options.saveAdaptation;
    this.storage = options.storage;
    this.storageKey = adaptationDraftStorageKey(this.projectId, this.adaptationId);
    this.setTimer = options.setTimeout ?? defaultTimer.setTimeout;
    this.clearTimerHandle = options.clearTimeout ?? defaultTimer.clearTimeout;
    this.now = options.now ?? defaultNow;
    this.debounceMs = options.debounceMs ?? 800;
    this.state = {
      draft: draftFromAdaptation(options.adaptation),
      acknowledgedAdaptation: options.adaptation,
      acknowledgedUpdatedAt: options.adaptation.updatedAt,
      editSequence: 0,
      acknowledgedSequence: 0,
      inFlightSequence: null,
      pendingNewer: false,
      status: "saved",
      error: null,
      serverAdaptation: null,
      recoveryDraft: null,
      recoverySource: null,
    };
    this.restoreSessionDraft();
  }

  getState() {
    return this.state;
  }

  getSnapshot() {
    return this.state;
  }

  subscribe(listener: Listener) {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  edit(patch: AdaptationDraftPatch) {
    if (this.disposed) {
      return;
    }
    const nextDraft = cloneDraft(this.state.draft);
    for (const key of Object.keys(patch) as Array<keyof AdaptationDraft>) {
      const value = patch[key];
      if (value !== undefined) {
        nextDraft[key] = value as never;
      }
    }
    const parsedDraft = adaptationDraftSchema.safeParse(nextDraft);
    if (!parsedDraft.success) {
      return;
    }
    const editSequence = this.state.editSequence + 1;
    const blocked = this.state.status === "conflict" || this.state.status === "failed";
    const waitingForConflictResolution = this.conflictResolutionInFlight && !this.keepLocalSaveStarted;
    this.state = {
      ...this.state,
      draft: parsedDraft.data,
      editSequence,
      pendingNewer: this.inFlight !== null && editSequence > this.inFlight.sequence,
      status: blocked ? this.state.status : waitingForConflictResolution ? "saving" : this.inFlight ? "saving" : "dirty",
      error: blocked ? this.state.error : null,
    };
    this.writeSession(this.inFlight?.baseUpdatedAt ?? this.state.acknowledgedUpdatedAt, parsedDraft.data, editSequence);
    if (!blocked && !waitingForConflictResolution) {
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

  useServerVersion() {
    if (this.disposed || this.conflictResolutionInFlight || !this.state.serverAdaptation) {
      return false;
    }
    const serverAdaptation = this.state.serverAdaptation;
    this.cancelDebounce();
    this.clearStoredDraftIfMatching([this.state.draft, this.state.recoveryDraft]);
    const editSequence = this.state.editSequence;
    this.state = {
      ...this.state,
      draft: draftFromAdaptation(serverAdaptation),
      acknowledgedAdaptation: serverAdaptation,
      acknowledgedUpdatedAt: serverAdaptation.updatedAt,
      acknowledgedSequence: editSequence,
      inFlightSequence: null,
      pendingNewer: false,
      status: "saved",
      error: null,
      serverAdaptation: null,
      recoveryDraft: null,
      recoverySource: null,
    };
    this.notify();
    return true;
  }

  resolveUseServer() {
    return this.useServerVersion();
  }

  keepMyDraft() {
    return this.keepLocal();
  }

  resolveKeepLocal() {
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
    if (adaptationDraftsEqual(record.draft, canonicalDraft)) {
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
        message: "A local draft is based on an older adaptation revision.",
        retryable: false,
        currentAdaptation: this.state.acknowledgedAdaptation,
      }),
      serverAdaptation: this.state.acknowledgedAdaptation,
      recoveryDraft: cloneDraft(record.draft),
      recoverySource: "session",
      editSequence: record.sequence,
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
    let request: Promise<Adaptation>;
    try {
      request = this.saveAdaptation(this.adaptationId, { ...flight.draft, baseUpdatedAt: flight.baseUpdatedAt });
    } catch (error) {
      request = Promise.reject(error);
    }
    flight.promise = request.then(
      (adaptation) => this.completeSuccess(flight, adaptation),
      (error) => this.completeFailure(flight, error),
    );
    return flight.promise;
  }

  private completeSuccess(flight: SaveFlight, response: Adaptation) {
    if (this.inFlight !== flight) {
      return;
    }
    const parsed = adaptationSchema.safeParse(response);
    if (!parsed.success || parsed.data.id !== this.adaptationId || parsed.data.projectId !== this.projectId) {
      this.completeFailure(flight, new WorkspaceApiError(500, {
        code: "INTERNAL_ERROR",
        message: "The workspace returned an invalid adaptation.",
        retryable: true,
      }));
      return;
    }
    if (this.disposed) {
      this.inFlight = null;
      return;
    }
    const adaptation = parsed.data;
    const hasNewer = this.state.editSequence > flight.sequence;
    this.inFlight = null;
    this.state = {
      ...this.state,
      acknowledgedAdaptation: adaptation,
      acknowledgedUpdatedAt: adaptation.updatedAt,
      acknowledgedSequence: flight.sequence,
      inFlightSequence: null,
      pendingNewer: hasNewer,
      status: hasNewer ? "dirty" : "saved",
      draft: hasNewer ? this.state.draft : draftFromAdaptation(adaptation),
      error: null,
      serverAdaptation: null,
      recoveryDraft: null,
      recoverySource: null,
    };
    if (hasNewer) {
      this.writeSession(adaptation.updatedAt, this.state.draft, this.state.editSequence);
    } else {
      this.clearSessionRecord({ baseUpdatedAt: flight.baseUpdatedAt, draft: flight.draft, sequence: flight.sequence });
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
    const serverAdaptation = isConflict(error) ? conflictAdaptation(error, this.adaptationId, this.projectId) : null;
    if (isConflict(error) && serverAdaptation) {
      this.state = {
        ...this.state,
        status: "conflict",
        error,
        serverAdaptation,
        recoveryDraft: cloneDraft(this.state.draft),
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

  private async flushUntilSettled() {
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

  private async keepLocal() {
    if (this.disposed || this.conflictResolutionInFlight || this.inFlight || !this.state.serverAdaptation) {
      return false;
    }
    const serverAdaptation = this.state.serverAdaptation;
    const localDraft = cloneDraft(this.state.recoveryDraft ?? this.state.draft);
    this.conflictResolutionInFlight = true;
    this.keepLocalSaveStarted = false;
    this.cancelDebounce();
    this.state = {
      ...this.state,
      draft: localDraft,
      acknowledgedAdaptation: serverAdaptation,
      acknowledgedUpdatedAt: serverAdaptation.updatedAt,
      status: "saving",
      error: null,
    };
    this.writeSession(serverAdaptation.updatedAt, localDraft, this.state.editSequence);
    this.notify();
    try {
      this.keepLocalSaveStarted = true;
      const request = this.startSave(true, serverAdaptation.updatedAt);
      if (!request) {
        return false;
      }
      const result = await this.flush();
      if (!result && this.state.status === "failed" && this.state.serverAdaptation) {
        this.state = { ...this.state, status: "conflict", recoveryDraft: localDraft, recoverySource: "conflict" };
        this.notify();
      }
      return result;
    } finally {
      this.conflictResolutionInFlight = false;
      this.keepLocalSaveStarted = false;
    }
  }

  private writeSession(baseUpdatedAt: string, draft: AdaptationDraft, sequence: number) {
    const record: AdaptationDraftStorageRecord = {
      schemaVersion: ADAPTATION_DRAFT_STORAGE_SCHEMA_VERSION,
      baseUpdatedAt,
      draft: cloneDraft(draft),
      editedAt: this.timestamp(),
      sequence,
    };
    if (writeAdaptationDraftRecord(this.storage, this.storageKey, record)) {
      this.lastSessionRecord = record;
    }
  }

  private clearStoredDraftIfMatching(drafts: Array<AdaptationDraft | null>) {
    const record = this.lastSessionRecord;
    if (!record || !drafts.some((draft) => draft !== null && adaptationDraftsEqual(record.draft, draft))) {
      return;
    }
    this.clearSessionRecord(record);
  }

  private readSessionRecord() {
    const record = readAdaptationDraftRecord(this.storage, this.storageKey);
    this.lastSessionRecord = record;
    return record;
  }

  private clearSessionRecord(expected: Pick<AdaptationDraftStorageRecord, "baseUpdatedAt" | "draft" | "sequence">) {
    const tracked = this.lastSessionRecord;
    if (!tracked
      || tracked.baseUpdatedAt !== expected.baseUpdatedAt
      || tracked.sequence !== expected.sequence
      || !adaptationDraftsEqual(tracked.draft, expected.draft)) {
      return false;
    }
    const cleared = clearAdaptationDraftIfMatching(this.storage, this.storageKey, tracked);
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

export function createAdaptationAutosaveCoordinator(options: AdaptationAutosaveOptions) {
  return new AdaptationAutosaveCoordinator(options);
}
