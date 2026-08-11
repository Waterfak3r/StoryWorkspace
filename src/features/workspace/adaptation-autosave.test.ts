import { describe, expect, it, vi } from "vitest";
import type { Adaptation } from "@/domain/adaptation";
import { WorkspaceApiError } from "./workspace-api";
import {
  AdaptationAutosaveCoordinator,
  type AdaptationAutosaveTimer,
} from "./adaptation-autosave";
import {
  adaptationDraftStorageKey,
  adaptationDraftStorageRecordSchema,
  type AdaptationDraftStorage,
} from "./adaptation-draft-storage";

const projectId = "11111111-1111-4111-8111-111111111111";
const adaptationId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-01-01T00:00:00.000Z";
const firstRevision = "2026-01-01T00:00:01.000Z";
const secondRevision = "2026-01-01T00:00:02.000Z";

function adaptation(overrides: Partial<Adaptation> = {}): Adaptation {
  return {
    id: adaptationId,
    projectId,
    format: "screenplay_scene",
    title: "Scene",
    body: "INT. ROOM",
    position: 0,
    sourceGenerationId: null,
    createdAt,
    updatedAt: firstRevision,
    ...overrides,
  };
}

class MemoryStorage implements AdaptationDraftStorage {
  readonly values = new Map<string, string>();
  throwOnWrite = false;
  throwOnRead = false;

  getItem(key: string) {
    if (this.throwOnRead) throw new Error("read failed");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.throwOnWrite) throw new Error("write failed");
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function timer() {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  const value: AdaptationAutosaveTimer = {
    setTimeout: (callback) => {
      const id = ++next;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout: (handle) => callbacks.delete(handle as number),
  };
  return { value, run: () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach((callback) => callback()); } };
}

function record(baseUpdatedAt: string, body: string, sequence: number) {
  return {
    schemaVersion: 1 as const,
    baseUpdatedAt,
    draft: { title: "Scene", body },
    editedAt: secondRevision,
    sequence,
  };
}

describe("adaptation draft storage", () => {
  it("rejects impossible sequence zero records", () => {
    const parsed = adaptationDraftStorageRecordSchema.safeParse(record(firstRevision, "Draft", 0));
    expect(parsed.success).toBe(false);
  });

  it("uses an exact project and adaptation session key", () => {
    expect(adaptationDraftStorageKey(projectId, adaptationId)).toContain(encodeURIComponent(projectId));
    expect(adaptationDraftStorageKey(projectId, adaptationId)).toContain(encodeURIComponent(adaptationId));
  });
});

describe("AdaptationAutosaveCoordinator", () => {
  it("debounces edits and keeps one serial request while preserving newer text", async () => {
    const clock = timer();
    const firstSave = deferred<Adaptation>();
    const calls: Array<{ body: string; baseUpdatedAt: string }> = [];
    const coordinator = new AdaptationAutosaveCoordinator({
      projectId,
      adaptation: adaptation(),
      setTimeout: clock.value.setTimeout,
      clearTimeout: clock.value.clearTimeout,
      saveAdaptation: async (_id, input) => {
        calls.push({ body: input.body, baseUpdatedAt: input.baseUpdatedAt });
        return firstSave.promise;
      },
    });

    coordinator.edit({ body: "First" });
    coordinator.edit({ body: "Second" });
    expect(calls).toHaveLength(0);
    clock.run();
    expect(calls).toEqual([{ body: "Second", baseUpdatedAt: firstRevision }]);
    coordinator.edit({ body: "Third" });
    firstSave.resolve(adaptation({ body: "Second", updatedAt: secondRevision }));
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ body: "Third", baseUpdatedAt: secondRevision });
  });

  it("shares concurrent flush calls and retries a failed save explicitly", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(adaptation({ body: "Saved", updatedAt: secondRevision }));
    const coordinator = new AdaptationAutosaveCoordinator({ projectId, adaptation: adaptation(), saveAdaptation: save });
    coordinator.edit({ body: "Saved" });
    const first = coordinator.flush();
    const second = coordinator.flush();
    expect(first).toBe(second);
    await expect(first).resolves.toBe(false);
    expect(coordinator.getState().status).toBe("failed");
    await expect(coordinator.retry()).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(coordinator.getState().status).toBe("saved");
  });

  it("enters typed conflict, can use server, and clears only its matching session record", async () => {
    const storage = new MemoryStorage();
    const server = adaptation({ title: "Server", body: "Server body", updatedAt: secondRevision });
    const coordinator = new AdaptationAutosaveCoordinator({
      projectId,
      adaptation: adaptation(),
      storage,
      saveAdaptation: async () => {
        throw new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentAdaptation: server });
      },
    });
    coordinator.edit({ body: "Local body" });
    await expect(coordinator.flush()).resolves.toBe(false);
    expect(coordinator.getState().status).toBe("conflict");
    expect(coordinator.getState().serverAdaptation).toEqual(server);
    const key = adaptationDraftStorageKey(projectId, adaptationId);
    storage.setItem(key, JSON.stringify(record(firstRevision, "External draft", 7)));
    expect(coordinator.useServerVersion()).toBe(true);
    expect(storage.getItem(key)).not.toBeNull();
    expect(coordinator.getState().draft).toEqual({ title: "Server", body: "Server body" });
  });

  it("keeps local title and body, then saves them against the latest conflict revision", async () => {
    const storage = new MemoryStorage();
    const server = adaptation({ title: "Server title", body: "Server body", updatedAt: secondRevision });
    const canonical = adaptation({ title: "Local title", body: "Local body", updatedAt: "2026-01-01T00:00:03.000Z" });
    const calls: Array<{ body: string; title: string; baseUpdatedAt: string }> = [];
    const save = vi.fn()
      .mockImplementationOnce(async (_id: string, input: { body: string; title: string; baseUpdatedAt: string }) => {
        calls.push(input);
        throw new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Conflict", retryable: false, currentAdaptation: server });
      })
      .mockImplementationOnce(async (_id: string, input: { body: string; title: string; baseUpdatedAt: string }) => {
        calls.push(input);
        return canonical;
      });
    const coordinator = new AdaptationAutosaveCoordinator({ projectId, adaptation: adaptation(), storage, saveAdaptation: save });

    coordinator.edit({ title: "Local title", body: "Local body" });
    await expect(coordinator.flush()).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({
      status: "conflict",
      serverAdaptation: server,
      recoveryDraft: { title: "Local title", body: "Local body" },
      draft: { title: "Local title", body: "Local body" },
    });

    await expect(coordinator.keepMyDraft()).resolves.toBe(true);
    expect(calls).toEqual([
      { title: "Local title", body: "Local body", baseUpdatedAt: firstRevision },
      { title: "Local title", body: "Local body", baseUpdatedAt: secondRevision },
    ]);
    expect(coordinator.getState()).toMatchObject({
      status: "saved",
      acknowledgedAdaptation: canonical,
      acknowledgedUpdatedAt: canonical.updatedAt,
      draft: { title: "Local title", body: "Local body" },
      serverAdaptation: null,
      recoveryDraft: null,
      recoverySource: null,
    });
    expect(storage.getItem(adaptationDraftStorageKey(projectId, adaptationId))).toBeNull();
  });

  it("recovers matching content without a false stale conflict and marks stale content for review", () => {
    const storage = new MemoryStorage();
    const key = adaptationDraftStorageKey(projectId, adaptationId);
    storage.setItem(key, JSON.stringify(record("2025-01-01T00:00:00.000Z", "INT. ROOM", 1)));
    const matching = new AdaptationAutosaveCoordinator({ projectId, adaptation: adaptation(), storage, saveAdaptation: vi.fn() });
    expect(matching.getState().status).toBe("saved");
    expect(storage.getItem(key)).toBeNull();

    storage.setItem(key, JSON.stringify(record("2025-01-01T00:00:00.000Z", "Different", 2)));
    const stale = new AdaptationAutosaveCoordinator({ projectId, adaptation: adaptation(), storage, saveAdaptation: vi.fn() });
    expect(stale.getState().status).toBe("conflict");
    expect(stale.getState().recoveryDraft?.body).toBe("Different");
  });

  it("restores a different same-base session draft as dirty and flushes it after debounce", async () => {
    const storage = new MemoryStorage();
    const clock = timer();
    const save = vi.fn().mockResolvedValue(adaptation({ body: "Recovered", updatedAt: secondRevision }));
    const key = adaptationDraftStorageKey(projectId, adaptationId);
    storage.setItem(key, JSON.stringify(record(firstRevision, "Recovered", 4)));
    const coordinator = new AdaptationAutosaveCoordinator({
      projectId,
      adaptation: adaptation(),
      storage,
      setTimeout: clock.value.setTimeout,
      clearTimeout: clock.value.clearTimeout,
      saveAdaptation: save,
    });

    expect(coordinator.getState()).toMatchObject({ status: "dirty", recoverySource: "session", draft: { body: "Recovered" } });
    expect(save).not.toHaveBeenCalled();
    clock.run();
    await expect(coordinator.flush()).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith(adaptationId, { title: "Scene", body: "Recovered", baseUpdatedAt: firstRevision });
    expect(coordinator.getState().status).toBe("saved");
    expect(storage.getItem(key)).toBeNull();
  });

  it("keeps the local draft and surfaces the latest canonical conflict after keep-local is rejected again", async () => {
    const storage = new MemoryStorage();
    const firstServer = adaptation({ title: "Server one", body: "Server one body", updatedAt: secondRevision });
    const latestServer = adaptation({ title: "Server two", body: "Server two body", updatedAt: "2026-01-01T00:00:03.000Z" });
    const calls: Array<{ body: string; title: string; baseUpdatedAt: string }> = [];
    const save = vi.fn()
      .mockImplementationOnce(async (_id: string, input: { body: string; title: string; baseUpdatedAt: string }) => {
        calls.push(input);
        throw new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "First conflict", retryable: false, currentAdaptation: firstServer });
      })
      .mockImplementationOnce(async (_id: string, input: { body: string; title: string; baseUpdatedAt: string }) => {
        calls.push(input);
        throw new WorkspaceApiError(409, { code: "EDIT_CONFLICT", message: "Latest conflict", retryable: false, currentAdaptation: latestServer });
      });
    const coordinator = new AdaptationAutosaveCoordinator({ projectId, adaptation: adaptation(), storage, saveAdaptation: save });

    coordinator.edit({ title: "Local title", body: "Local body" });
    await expect(coordinator.flush()).resolves.toBe(false);
    await expect(coordinator.keepMyDraft()).resolves.toBe(false);
    expect(calls).toEqual([
      { title: "Local title", body: "Local body", baseUpdatedAt: firstRevision },
      { title: "Local title", body: "Local body", baseUpdatedAt: secondRevision },
    ]);
    expect(coordinator.getState()).toMatchObject({
      status: "conflict",
      serverAdaptation: latestServer,
      recoveryDraft: { title: "Local title", body: "Local body" },
      draft: { title: "Local title", body: "Local body" },
    });
    expect(storage.getItem(adaptationDraftStorageKey(projectId, adaptationId))).not.toBeNull();
  });

  it("turns a malformed conflict payload into a retryable failed state without dropping the draft", async () => {
    const storage = new MemoryStorage();
    const save = vi.fn().mockRejectedValue(new WorkspaceApiError(409, {
      code: "EDIT_CONFLICT",
      message: "Malformed conflict",
      retryable: false,
      currentAdaptation: { id: "not-an-adaptation" },
    }));
    const coordinator = new AdaptationAutosaveCoordinator({ projectId, adaptation: adaptation(), storage, saveAdaptation: save });
    coordinator.edit({ title: "Local title", body: "Local body" });

    await expect(coordinator.flush()).resolves.toBe(false);
    expect(coordinator.getState()).toMatchObject({
      status: "failed",
      draft: { title: "Local title", body: "Local body" },
      serverAdaptation: null,
      error: { code: "INTERNAL_ERROR", retryable: true },
    });
  });

  it("ignores storage exceptions and does not clear an unconfirmed draft on dispose", () => {
    const storage = new MemoryStorage();
    storage.throwOnWrite = true;
    const coordinator = new AdaptationAutosaveCoordinator({ projectId, adaptation: adaptation(), storage, saveAdaptation: vi.fn() });
    expect(() => coordinator.edit({ body: "Still here" })).not.toThrow();
    coordinator.dispose();
    expect(coordinator.getState().draft.body).toBe("Still here");
  });

  it("rejects title and body edits beyond the adaptation limits before scheduling a save", () => {
    const coordinator = new AdaptationAutosaveCoordinator({ projectId, adaptation: adaptation(), saveAdaptation: vi.fn() });
    coordinator.edit({ title: "x".repeat(161), body: "y".repeat(100_001) });
    expect(coordinator.getState().draft).toEqual({ title: "Scene", body: "INT. ROOM" });
    expect(coordinator.getState().editSequence).toBe(0);
  });
});
