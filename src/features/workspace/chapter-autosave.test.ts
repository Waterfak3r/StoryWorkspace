import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceApiError } from "./workspace-api";
import {
  CHAPTER_DRAFT_STORAGE_SCHEMA_VERSION,
  chapterDraftStorageKey,
  type ChapterDraft,
  type ChapterDraftStorage,
} from "./chapter-draft-storage";
import {
  ChapterAutosaveCoordinator,
  type ChapterSaveInput,
} from "./chapter-autosave";
import type { Chapter } from "@/domain/narrative";

const projectId = "11111111-1111-4111-8111-111111111111";
const chapterId = "22222222-2222-4222-8222-222222222222";
const outlineNodeId = "33333333-3333-4333-8333-333333333333";
const baseUpdatedAt = "2026-01-01T00:00:00.000Z";
const nextUpdatedAt = "2026-01-01T00:00:01.000Z";
const finalUpdatedAt = "2026-01-01T00:00:02.000Z";

class MemoryStorage implements ChapterDraftStorage {
  private readonly values = new Map<string, string>();
  throwOnGet = false;
  throwOnSet = false;
  throwOnRemove = false;

  getItem(key: string) {
    if (this.throwOnGet) {
      throw new Error("storage get failed");
    }
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.throwOnSet) {
      throw new Error("storage set failed");
    }
    this.values.set(key, value);
  }

  removeItem(key: string) {
    if (this.throwOnRemove) {
      throw new Error("storage remove failed");
    }
    this.values.delete(key);
  }

  raw(key: string) {
    return this.values.get(key) ?? null;
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: chapterId,
    projectId,
    outlineNodeId,
    title: "Chapter one",
    summary: "A beginning",
    body: "Original body",
    position: 0,
    status: "draft",
    createdAt: baseUpdatedAt,
    updatedAt: baseUpdatedAt,
    ...overrides,
  };
}

function draft(overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    title: "Chapter one",
    summary: "A beginning",
    body: "Original body",
    status: "draft",
    outlineNodeId,
    ...overrides,
  };
}

function seedSession(storage: MemoryStorage, value: { baseUpdatedAt: string; draft: ChapterDraft; sequence: number }) {
  storage.setItem(chapterDraftStorageKey(projectId, chapterId), JSON.stringify({
    schemaVersion: CHAPTER_DRAFT_STORAGE_SCHEMA_VERSION,
    ...value,
    editedAt: baseUpdatedAt,
  }));
}

function harness(options: { storage?: MemoryStorage; chapter?: Chapter } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const saves: Array<{ chapterId: string; input: ChapterSaveInput; deferred: Deferred<Chapter> }> = [];
  const saveChapter = vi.fn((id: string, input: ChapterSaveInput) => {
    const request = deferred<Chapter>();
    saves.push({ chapterId: id, input, deferred: request });
    return request.promise;
  });
  const createManualSnapshot = vi.fn(() => Promise.resolve({ id: "snapshot" }));
  const coordinator = new ChapterAutosaveCoordinator({
    projectId,
    chapter: options.chapter ?? chapter(),
    saveChapter,
    createManualSnapshot,
    storage,
    now: () => baseUpdatedAt,
  });
  return { coordinator, storage, saves, saveChapter, createManualSnapshot };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ChapterAutosaveCoordinator", () => {
  it("debounces edits and sends the complete draft with its acknowledged base", async () => {
    vi.useFakeTimers();
    const { coordinator, saves } = harness();

    coordinator.edit({ body: "First edit" });
    expect(saves).toHaveLength(0);
    vi.advanceTimersByTime(799);
    expect(saves).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      chapterId,
      input: {
        title: "Chapter one",
        summary: "A beginning",
        body: "First edit",
        status: "draft",
        outlineNodeId,
        baseUpdatedAt,
      },
    });

    saves[0].deferred.resolve(chapter({ body: "First edit", updatedAt: nextUpdatedAt }));
    await settle();
    expect(coordinator.getState()).toMatchObject({ status: "saved", acknowledgedUpdatedAt: nextUpdatedAt, editSequence: 1, acknowledgedSequence: 1 });
  });

  it("applies a validated external canonical chapter atomically while saved", async () => {
    const { coordinator, saves } = harness();
    coordinator.edit({ body: "Acknowledged body" });
    const flush = coordinator.flush();
    saves[0].deferred.resolve(chapter({ body: "Acknowledged body", updatedAt: nextUpdatedAt }));
    await expect(flush).resolves.toBe(true);

    let notifications = 0;
    const unsubscribe = coordinator.subscribe(() => { notifications += 1; });
    const restored = chapter({
      title: "Restored chapter",
      summary: "Restored summary",
      body: "Restored body",
      status: "revised",
      updatedAt: finalUpdatedAt,
    });

    expect(coordinator.applyCanonicalChapter(restored)).toBe(true);
    expect(notifications).toBe(1);
    expect(coordinator.getState()).toMatchObject({
      status: "saved",
      draft: {
        title: restored.title,
        summary: restored.summary,
        body: restored.body,
        status: restored.status,
        outlineNodeId: restored.outlineNodeId,
      },
      acknowledgedChapter: restored,
      acknowledgedUpdatedAt: finalUpdatedAt,
      acknowledgedSequence: 1,
      error: null,
      serverChapter: null,
      recoveryDraft: null,
      recoverySource: null,
      pendingNewer: false,
    });
    unsubscribe();
  });

  it("rejects canonical mutations without changing dirty, in-flight, conflict, or snapshot states", async () => {
    const dirty = harness().coordinator;
    dirty.edit({ body: "Unsaved body" });
    const dirtyState = dirty.getState();
    expect(dirty.applyCanonicalChapter(chapter({ body: "External body", updatedAt: nextUpdatedAt }))).toBe(false);
    expect(dirty.getState()).toBe(dirtyState);

    const inFlightHarness = harness();
    inFlightHarness.coordinator.edit({ body: "Submitted body" });
    const inFlight = inFlightHarness.coordinator.flush();
    const inFlightState = inFlightHarness.coordinator.getState();
    expect(inFlightHarness.coordinator.applyCanonicalChapter(chapter({ body: "External body", updatedAt: nextUpdatedAt }))).toBe(false);
    expect(inFlightHarness.coordinator.getState()).toBe(inFlightState);
    inFlightHarness.saves[0].deferred.resolve(chapter({ body: "Submitted body", updatedAt: nextUpdatedAt }));
    await expect(inFlight).resolves.toBe(true);

    const conflictHarness = harness();
    conflictHarness.coordinator.edit({ body: "Local body" });
    const conflictFlush = conflictHarness.coordinator.flush();
    conflictHarness.saves[0].deferred.reject(new WorkspaceApiError(409, {
      code: "EDIT_CONFLICT",
      message: "Conflict",
      retryable: false,
      currentChapter: chapter({ body: "Server body", updatedAt: nextUpdatedAt }),
    }));
    await expect(conflictFlush).resolves.toBe(false);
    const conflictState = conflictHarness.coordinator.getState();
    expect(conflictHarness.coordinator.applyCanonicalChapter(chapter({ body: "External body", updatedAt: finalUpdatedAt }))).toBe(false);
    expect(conflictHarness.coordinator.getState()).toBe(conflictState);

    const snapshot = deferred<{ id: string }>();
    const snapshotHarness = harness();
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    snapshotHarness.coordinator.edit({ body: "Local body" });
    const snapshotFlush = snapshotHarness.coordinator.flush();
    snapshotHarness.saves[0].deferred.reject(new WorkspaceApiError(409, {
      code: "EDIT_CONFLICT",
      message: "Conflict",
      retryable: false,
      currentChapter: server,
    }));
    await expect(snapshotFlush).resolves.toBe(false);
    snapshotHarness.createManualSnapshot.mockReturnValueOnce(snapshot.promise);
    const keep = snapshotHarness.coordinator.resolveKeepLocal();
    const snapshotState = snapshotHarness.coordinator.getState();
    expect(snapshotHarness.coordinator.applyCanonicalChapter(chapter({ body: "External body", updatedAt: finalUpdatedAt }))).toBe(false);
    expect(snapshotHarness.coordinator.getState()).toBe(snapshotState);
    snapshot.resolve({ id: "backup" });
    await settle();
    snapshotHarness.saves[1].deferred.resolve(chapter({ body: "Local body", updatedAt: finalUpdatedAt }));
    await expect(keep).resolves.toBe(true);
  });

  it("rejects malformed, mismatched, and cross-project canonical chapters without side effects", () => {
    const { coordinator, storage } = harness();
    const state = coordinator.getState();
    const stored = storage.raw(chapterDraftStorageKey(projectId, chapterId));
    const invalid = { id: chapterId, projectId, body: "not a complete chapter" } as unknown as Chapter;
    const wrongId = chapter({ id: "44444444-4444-4444-8444-444444444444" });
    const wrongProject = chapter({ projectId: "55555555-5555-4555-8555-555555555555" });

    expect(coordinator.applyCanonicalChapter(invalid)).toBe(false);
    expect(coordinator.applyCanonicalChapter(wrongId)).toBe(false);
    expect(coordinator.applyCanonicalChapter(wrongProject)).toBe(false);
    expect(coordinator.getState()).toBe(state);
    expect(storage.raw(chapterDraftStorageKey(projectId, chapterId))).toBe(stored);
  });

  it("does not delete an externally replaced session record during canonical application", async () => {
    const storage = new MemoryStorage();
    const { coordinator, saves } = harness({ storage });
    coordinator.edit({ body: "Submitted body" });
    const flush = coordinator.flush();
    seedSession(storage, { baseUpdatedAt: nextUpdatedAt, draft: draft({ body: "Submitted body" }), sequence: 99 });
    saves[0].deferred.resolve(chapter({ body: "Submitted body", updatedAt: nextUpdatedAt }));
    await expect(flush).resolves.toBe(true);
    expect(storage.raw(chapterDraftStorageKey(projectId, chapterId))).not.toBeNull();

    expect(coordinator.applyCanonicalChapter(chapter({ body: "Restored body", updatedAt: finalUpdatedAt }))).toBe(true);
    expect(storage.raw(chapterDraftStorageKey(projectId, chapterId))).not.toBeNull();
  });

  it("exposes a subscribable stable snapshot and stops notifying after dispose", () => {
    const { coordinator } = harness();
    let notifications = 0;
    const unsubscribe = coordinator.subscribe(() => { notifications += 1; });
    coordinator.edit({ body: "Changed" });
    expect(notifications).toBe(1);
    expect(coordinator.getSnapshot()).toBe(coordinator.getState());
    unsubscribe();
    coordinator.edit({ body: "Changed again" });
    expect(notifications).toBe(1);
    coordinator.dispose();
    coordinator.edit({ body: "Ignored" });
    expect(notifications).toBe(1);
  });

  it("serializes one request and rewrites a newer session base before pumping", async () => {
    vi.useFakeTimers();
    const { coordinator, storage, saves } = harness();

    coordinator.edit({ body: "First edit" });
    vi.advanceTimersByTime(800);
    coordinator.edit({ body: "Newer edit" });
    expect(saves).toHaveLength(1);

    saves[0].deferred.resolve(chapter({ body: "First edit", updatedAt: nextUpdatedAt }));
    await settle();
    expect(saves).toHaveLength(2);
    expect(saves[1].input).toMatchObject({ body: "Newer edit", baseUpdatedAt: nextUpdatedAt });
    const storedWhilePumping = JSON.parse(storage.raw(chapterDraftStorageKey(projectId, chapterId)) as string) as { baseUpdatedAt: string; draft: ChapterDraft; sequence: number };
    expect(storedWhilePumping).toMatchObject({ baseUpdatedAt: nextUpdatedAt, sequence: 2, draft: { body: "Newer edit" } });
    expect(coordinator.getState().draft.body).toBe("Newer edit");

    saves[1].deferred.resolve(chapter({ body: "Newer edit", updatedAt: finalUpdatedAt }));
    await settle();
    expect(coordinator.getState()).toMatchObject({ status: "saved", acknowledgedUpdatedAt: finalUpdatedAt, acknowledgedSequence: 2 });
    expect(storage.raw(chapterDraftStorageKey(projectId, chapterId))).toBeNull();
  });

  it("does not clear a newer storage record when an old success arrives", async () => {
    vi.useFakeTimers();
    const { coordinator, storage, saves } = harness();
    coordinator.edit({ body: "Submitted" });
    vi.advanceTimersByTime(800);
    seedSession(storage, { baseUpdatedAt: baseUpdatedAt, draft: draft({ body: "Later tab write" }), sequence: 99 });

    saves[0].deferred.resolve(chapter({ body: "Submitted", updatedAt: nextUpdatedAt }));
    await settle();
    expect(storage.raw(chapterDraftStorageKey(projectId, chapterId))).not.toBeNull();
  });

  it("keeps failed drafts until an explicit retry", async () => {
    const { coordinator, saves } = harness();
    coordinator.edit({ body: "Needs retry" });
    const flush = coordinator.flush();
    expect(saves).toHaveLength(1);
    saves[0].deferred.reject(new WorkspaceApiError(503, { code: "NETWORK_ERROR", message: "Offline", retryable: true }));
    await expect(flush).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({ status: "failed", error: expect.objectContaining({ code: "NETWORK_ERROR" }), draft: { body: "Needs retry" } });

    const retry = coordinator.retry();
    expect(saves).toHaveLength(2);
    saves[1].deferred.resolve(chapter({ body: "Needs retry", updatedAt: nextUpdatedAt }));
    await expect(retry).resolves.toBe(true);
    expect(coordinator.getState().status).toBe("saved");
  });

  it("validates a 409 current chapter and blocks automatic saves", async () => {
    vi.useFakeTimers();
    const { coordinator, saves } = harness();
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    coordinator.edit({ body: "My body" });
    vi.advanceTimersByTime(800);
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: server }));
    await settle();

    expect(coordinator.getState()).toMatchObject({ status: "conflict", serverChapter: server, draft: { body: "My body" } });
    vi.advanceTimersByTime(10_000);
    expect(saves).toHaveLength(1);
    await expect(coordinator.flush()).resolves.toBe(false);
  });

  it("turns an invalid conflict payload into a safe internal failure", async () => {
    const { coordinator, saves } = harness();
    coordinator.edit({ body: "Keep this" });
    const flush = coordinator.flush();
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: { body: "not a chapter" } }));
    await expect(flush).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({ status: "failed", error: expect.objectContaining({ code: "INTERNAL_ERROR" }), draft: { body: "Keep this" } });
  });

  it("uses the server version and clears only the matching local session", async () => {
    const storage = new MemoryStorage();
    const { coordinator, saves } = harness({ storage });
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    coordinator.edit({ body: "Local body" });
    const flush = coordinator.flush();
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: server }));
    await expect(flush).resolves.toBe(false);
    seedSession(storage, { baseUpdatedAt: nextUpdatedAt, draft: draft({ body: "Local body" }), sequence: 99 });
    expect(coordinator.resolveUseServer()).toBe(true);
    expect(coordinator.getState()).toMatchObject({ status: "saved", draft: { body: "Server body" }, acknowledgedUpdatedAt: nextUpdatedAt, serverChapter: null });
    expect(storage.raw(chapterDraftStorageKey(projectId, chapterId))).not.toBeNull();
  });

  it("clears the exact tracked session when use-server has no external overwrite", async () => {
    const storage = new MemoryStorage();
    const { coordinator, saves } = harness({ storage });
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    coordinator.edit({ body: "Local body" });
    const flush = coordinator.flush();
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: server }));
    await expect(flush).resolves.toBe(false);

    expect(coordinator.resolveUseServer()).toBe(true);
    expect(storage.raw(chapterDraftStorageKey(projectId, chapterId))).toBeNull();
  });

  it("snapshots before keeping local text and saves against the conflict revision", async () => {
    const snapshot = deferred<{ id: string }>();
    const { coordinator, saves, createManualSnapshot } = harness();
    createManualSnapshot.mockReturnValueOnce(snapshot.promise);
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    coordinator.edit({ body: "Local body" });
    const initialFlush = coordinator.flush();
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: server }));
    await expect(initialFlush).resolves.toBe(false);

    const keep = coordinator.resolveKeepLocal();
    expect(createManualSnapshot).toHaveBeenCalledWith(chapterId);
    expect(saves).toHaveLength(1);
    snapshot.resolve({ id: "backup" });
    await settle();
    expect(saves).toHaveLength(2);
    expect(saves[1].input).toMatchObject({ body: "Local body", baseUpdatedAt: nextUpdatedAt });
    saves[1].deferred.resolve(chapter({ body: "Local body", updatedAt: finalUpdatedAt }));
    await expect(keep).resolves.toBe(true);
    expect(coordinator.getState()).toMatchObject({ status: "saved", draft: { body: "Local body" }, acknowledgedUpdatedAt: finalUpdatedAt });
  });

  it("advances the acknowledged revision before a synchronous listener edits during keep-local", async () => {
    const snapshot = deferred<{ id: string }>();
    const { coordinator, saves, createManualSnapshot } = harness();
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    coordinator.edit({ body: "Local body" });
    const initialFlush = coordinator.flush();
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: server }));
    await expect(initialFlush).resolves.toBe(false);

    createManualSnapshot.mockReturnValueOnce(snapshot.promise);
    let reentered = false;
    coordinator.subscribe(() => {
      if (!reentered && coordinator.getState().status === "dirty" && coordinator.getState().acknowledgedUpdatedAt === nextUpdatedAt) {
        reentered = true;
        coordinator.edit({ summary: "Listener edit" });
      }
    });
    const keep = coordinator.resolveKeepLocal();
    snapshot.resolve({ id: "backup" });
    await settle();
    expect(saves).toHaveLength(2);
    expect(saves[1].input).toMatchObject({ baseUpdatedAt: nextUpdatedAt, body: "Local body", summary: "Listener edit" });
    saves[1].deferred.resolve(chapter({ body: "Local body", summary: "Listener edit", updatedAt: finalUpdatedAt }));
    await expect(keep).resolves.toBe(true);
    expect(reentered).toBe(true);
  });

  it("keeps both drafts when the local snapshot fails or a second conflict arrives", async () => {
    const snapshotFailure = new WorkspaceApiError(503, { code: "NETWORK_ERROR", message: "Snapshot failed", retryable: true });
    const { coordinator, saves, createManualSnapshot } = harness();
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    coordinator.edit({ body: "Local body" });
    const initialFlush = coordinator.flush();
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: server }));
    await expect(initialFlush).resolves.toBe(false);
    createManualSnapshot.mockRejectedValueOnce(snapshotFailure);
    await expect(coordinator.resolveKeepLocal()).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({ status: "conflict", draft: { body: "Local body" }, serverChapter: server, error: snapshotFailure });

    createManualSnapshot.mockResolvedValueOnce({ id: "backup" });
    const secondKeep = coordinator.resolveKeepLocal();
    await settle();
    const newerServer = chapter({ body: "New server body", updatedAt: finalUpdatedAt });
    saves[1].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Second conflict", retryable: false, currentChapter: newerServer }));
    await expect(secondKeep).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({ status: "conflict", draft: { body: "Local body" }, serverChapter: newerServer });
  });

  it("blocks debounce and server resolution while keep-local is snapshotting", async () => {
    vi.useFakeTimers();
    const snapshot = deferred<{ id: string }>();
    const { coordinator, saves, createManualSnapshot } = harness();
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    coordinator.edit({ body: "Local body" });
    vi.advanceTimersByTime(800);
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: server }));
    await settle();

    createManualSnapshot.mockReturnValueOnce(snapshot.promise);
    const keep = coordinator.resolveKeepLocal();
    coordinator.edit({ body: "Edited while snapshotting" });
    vi.advanceTimersByTime(10_000);
    expect(saves).toHaveLength(1);
    expect(coordinator.resolveUseServer()).toBe(false);

    snapshot.resolve({ id: "backup" });
    await settle();
    expect(saves).toHaveLength(2);
    expect(saves[1].input).toMatchObject({ body: "Edited while snapshotting", baseUpdatedAt: nextUpdatedAt });
    saves[1].deferred.resolve(chapter({ body: "Edited while snapshotting", updatedAt: finalUpdatedAt }));
    await expect(keep).resolves.toBe(true);
  });

  it("keeps the conflict revision as the session base for edits during keep-local save", async () => {
    const snapshot = deferred<{ id: string }>();
    const { coordinator, storage, saves, createManualSnapshot } = harness();
    const server = chapter({ body: "Server body", updatedAt: nextUpdatedAt });
    coordinator.edit({ body: "Local body" });
    const initialFlush = coordinator.flush();
    saves[0].deferred.reject(new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentChapter: server }));
    await expect(initialFlush).resolves.toBe(false);

    createManualSnapshot.mockReturnValueOnce(snapshot.promise);
    const keep = coordinator.resolveKeepLocal();
    snapshot.resolve({ id: "backup" });
    await settle();
    expect(saves).toHaveLength(2);
    coordinator.edit({ summary: "Changed during keep" });
    const stored = JSON.parse(storage.raw(chapterDraftStorageKey(projectId, chapterId)) as string) as { baseUpdatedAt: string };
    expect(stored.baseUpdatedAt).toBe(nextUpdatedAt);

    saves[1].deferred.resolve(chapter({ body: "Local body", summary: "A beginning", updatedAt: finalUpdatedAt }));
    await settle();
    expect(saves).toHaveLength(3);
    saves[2].deferred.resolve(chapter({ body: "Local body", summary: "Changed during keep", updatedAt: "2026-01-01T00:00:03.000Z" }));
    await expect(keep).resolves.toBe(true);
  });

  it("rejects a successful response for another chapter as an internal failure", async () => {
    const { coordinator, saves } = harness();
    coordinator.edit({ body: "Local body" });
    const flush = coordinator.flush();
    saves[0].deferred.resolve(chapter({ id: "44444444-4444-4444-8444-444444444444", body: "Wrong chapter", updatedAt: nextUpdatedAt }));
    await expect(flush).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({ status: "failed", error: expect.objectContaining({ code: "INTERNAL_ERROR" }), draft: { body: "Local body" } });
  });

  it("shares concurrent flushes and allows a later flush after the first settles", async () => {
    const { coordinator, saves } = harness();
    coordinator.edit({ body: "First" });
    const first = coordinator.flush();
    const same = coordinator.flush();
    expect(same).toBe(first);
    saves[0].deferred.resolve(chapter({ body: "First", updatedAt: nextUpdatedAt }));
    await expect(first).resolves.toBe(true);

    coordinator.edit({ body: "Second" });
    const second = coordinator.flush();
    expect(second).not.toBe(first);
    saves[1].deferred.resolve(chapter({ body: "Second", updatedAt: finalUpdatedAt }));
    await expect(second).resolves.toBe(true);
  });

  it("recovers matching sessions, ignores identical and invalid records, and blocks stale records", () => {
    const matchingStorage = new MemoryStorage();
    seedSession(matchingStorage, { baseUpdatedAt, draft: draft({ body: "Recovered" }), sequence: 4 });
    const matching = harness({ storage: matchingStorage }).coordinator;
    expect(matching.getState()).toMatchObject({ status: "dirty", recoverySource: "session", draft: { body: "Recovered" }, editSequence: 4 });

    const identicalStorage = new MemoryStorage();
    seedSession(identicalStorage, { baseUpdatedAt: nextUpdatedAt, draft: draft(), sequence: 2 });
    const identical = harness({ storage: identicalStorage }).coordinator;
    expect(identical.getState().status).toBe("saved");
    expect(identicalStorage.raw(chapterDraftStorageKey(projectId, chapterId))).toBeNull();

    const invalidStorage = new MemoryStorage();
    invalidStorage.setItem(chapterDraftStorageKey(projectId, chapterId), "{bad json");
    expect(harness({ storage: invalidStorage }).coordinator.getState().status).toBe("saved");

    const zeroSequenceStorage = new MemoryStorage();
    seedSession(zeroSequenceStorage, { baseUpdatedAt, draft: draft({ body: "Zero sequence" }), sequence: 0 });
    expect(harness({ storage: zeroSequenceStorage }).coordinator.getState().status).toBe("saved");

    const staleStorage = new MemoryStorage();
    seedSession(staleStorage, { baseUpdatedAt: nextUpdatedAt, draft: draft({ body: "Stale local" }), sequence: 5 });
    const stale = harness({ storage: staleStorage }).coordinator;
    expect(stale.getState()).toMatchObject({ status: "conflict", recoverySource: "session", draft: { body: "Original body" }, recoveryDraft: { body: "Stale local" }, serverChapter: chapter() });
  });

  it("survives storage exceptions and dispose leaves an unconfirmed session draft", async () => {
    const storage = new MemoryStorage();
    storage.throwOnSet = true;
    const { coordinator } = harness({ storage });
    expect(() => coordinator.edit({ body: "Still editable" })).not.toThrow();
    expect(coordinator.getState()).toMatchObject({ status: "dirty", draft: { body: "Still editable" } });

    const pendingStorage = new MemoryStorage();
    const pending = harness({ storage: pendingStorage });
    pending.coordinator.edit({ body: "Do not lose me" });
    const flush = pending.coordinator.flush();
    expect(pending.storage.raw(chapterDraftStorageKey(projectId, chapterId))).not.toBeNull();
    pending.coordinator.dispose();
    const savedChapter = chapter({ body: "Do not lose me", updatedAt: nextUpdatedAt });
    pending.saves[0].deferred.resolve(savedChapter);
    await expect(flush).resolves.toBe(false);
    expect(pending.storage.raw(chapterDraftStorageKey(projectId, chapterId))).not.toBeNull();

    const reopened = harness({ storage: pendingStorage, chapter: savedChapter }).coordinator;
    expect(reopened.getState().status).toBe("saved");
    expect(pending.storage.raw(chapterDraftStorageKey(projectId, chapterId))).toBeNull();
  });

  it("requires a matching project id for the initial chapter", () => {
    expect(() => new ChapterAutosaveCoordinator({
      projectId: "44444444-4444-4444-8444-444444444444",
      chapter: chapter(),
      saveChapter: async () => chapter(),
      createManualSnapshot: async () => ({ id: "snapshot" }),
    })).toThrow("project does not match");
  });
});
