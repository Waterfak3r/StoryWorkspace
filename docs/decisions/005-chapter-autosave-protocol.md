# ADR 005: Chapter autosave protocol

## Status

Accepted for MVP Slice 2B2.

## Goals

Chapter typing must stay immediate while persistence is debounced, serialized, conflict-aware, and recoverable after framework navigation. A late response must never replace newer local text.

## Draft and state

An editor draft contains `title`, `summary`, `body`, `status`, and `outlineNodeId`. The autosave session tracks:

- the latest local draft and a monotonically increasing local edit sequence;
- the last acknowledged canonical chapter and its `updatedAt` revision;
- at most one in-flight request with its submitted draft and sequence;
- one debounce timer and whether a newer edit is pending;
- status: `saved`, `dirty`, `saving`, `failed`, or `conflict`;
- an optional server chapter from a 409 response.

UI labels map to `Saved`, `Unsaved`, `Saving`, `Could not save`, and `Review conflict`.

## Save pump

Editing increments the sequence, updates the controlled draft, writes a session-draft record synchronously, marks `dirty`, and schedules an 800ms save. No save starts while another request is in flight or while conflicted.

A save snapshots the current draft, sequence, and acknowledged `updatedAt`, then sends one PATCH containing the full editable draft plus `baseUpdatedAt`.

On success:

1. Replace the acknowledged canonical chapter with the response.
2. Never assign the response body into the controlled draft when the local sequence has advanced.
3. If a newer edit exists, rewrite its session-draft record with the new acknowledged `updatedAt` before pumping again. This prevents an ordinary in-flight edit from looking like a stale recovery conflict after navigation.
4. If no newer edit exists, mark `saved` and clear only the matching session-draft record.
5. If a newer edit exists, retain it and immediately pump one save against the new acknowledged revision.

On a network or retryable error, retain the draft, mark `failed`, and wait for explicit retry. On 409, retain the local draft, store the returned server chapter, mark `conflict`, and stop automatic saves.

## Conflict resolution

The conflict surface shows both complete local and server drafts. It offers:

- `Use server version`: replace the local draft and acknowledged chapter with the returned server chapter, then clear the matching session draft.
- `Keep my draft`: first create a manual snapshot of the current server body, then submit the local draft against the returned server `updatedAt`. If either request fails or another 409 occurs, keep both drafts and remain blocked.
- `Copy my draft`: copy local Markdown without changing persistence state.

No option is selected automatically.

## Flush and guarded actions

`flush()` cancels the debounce, waits for an in-flight request, pumps the newest pending draft, and resolves `true` only when the latest sequence is acknowledged. It resolves `false` on failure or conflict.

Chapter switching, workspace-owned navigation, manual snapshot, restore, and chapter deletion call `flush()` first. Snapshot and restore stop when it returns false. Restore then confirms the target, sends the latest acknowledged `updatedAt`, and updates the draft only from a successful response.

The editor handle exposed to the workspace is a broader leave guard: it delegates to the coordinator only when no snapshot, restore, or conflict-resolution mutation is active. While one of those external writes is pending it resolves `false`, so the shell cannot unmount the editor before the returned canonical state is applied.

## External canonical mutations

Version restore and accepted AI output mutate a chapter through endpoints outside the autosave PATCH pump. The caller must first obtain `flush() === true`, perform the mutation, then pass the validated returned chapter to `applyCanonicalChapter()`.

The coordinator accepts that chapter only while saved and with no save or conflict resolution in flight, and only when its chapter and project IDs match. Acceptance replaces the draft and acknowledged canonical revision atomically, clears only the coordinator's exactly tracked session record, and notifies subscribers once. Rejection leaves the current draft untouched.

## Session recovery

The storage key is scoped by project and chapter. Its JSON value contains a schema version, base `updatedAt`, draft, edit time, and local sequence. Storage failures do not break typing.

When a chapter opens:

- ignore invalid or identical records;
- if the stored base equals the server revision, restore it as a dirty draft and explain that it was recovered;
- if revisions differ, show a recovery conflict with both versions and apply neither automatically.

`beforeunload` is registered for dirty, saving, failed, and conflict states. Session recovery is the fallback for browser or framework navigation that cannot be synchronously blocked.

## Test requirements

Use an autosave coordinator with injected save, snapshot, clock/timer, and storage boundaries so it can be tested without a browser. Cover debounce, one request in flight, edits during flight, late success, retry, 409, both conflict choices, flush, restore gate, matching-draft cleanup, and stale session recovery.
