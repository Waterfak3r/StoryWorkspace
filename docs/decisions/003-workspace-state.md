# ADR 003: Workspace client state and autosave

## Status

Accepted for MVP Slice 2 UI.

## Context

The project workspace combines structured records and a continuously edited manuscript. It needs immediate local interaction without hiding persistence failures or allowing slow saves to overwrite newer prose.

## Decision

The dynamic project page loads the complete workspace on the server and passes it to one client workspace shell. Feature components use local React state; no global state library is introduced for the MVP.

- The left navigator owns the selected feature and record.
- Successful structured mutations update local canonical data from the API response.
- The workspace can request a full refresh after a destructive or multi-record mutation.
- Desktop shows navigator, editor, and contextual rail. Below 1024px, navigator and context become explicit drawers while the editor remains primary.

Chapter editing uses a debounced, serialized autosave queue.

- The client tracks the latest local body, the last acknowledged `updatedAt`, and save state.
- Only one chapter update request may be in flight for a document.
- Edits made during a request set a pending flag. When the request settles, the newest body saves against the newly acknowledged timestamp.
- A stale response never replaces newer local text.
- HTTP 409 preserves local and server text, stops automatic retries, and presents a conflict choice.
- Network failure leaves the editor dirty and exposes retry.
- `beforeunload` warns while a document is dirty or saving.
- The latest unacknowledged chapter draft is mirrored synchronously to `sessionStorage`, keyed by project and chapter. A successful acknowledgement clears only the matching stored draft.
- Returning to a chapter offers recovery when a stored draft differs from the server. A stale stored revision is never applied without showing both versions.
- Workspace-owned links and record switches use the same dirty-state guard. Browser navigation remains recoverable through the session draft even when a framework soft navigation bypasses `beforeunload`.

Manual snapshot and restore are explicit document-menu actions. Both first flush the autosave queue and proceed only after the current draft is acknowledged. Restore shows the target timestamp/source and confirms that the acknowledged current body will first be preserved as a backup. A failed save or conflict blocks restore and keeps the local draft intact.

Structured mutations update only their corresponding canonical slice. A bible or outline mutation must not refetch or replace chapter state. If a future multi-record operation needs a full refresh, it must merge around the active local chapter draft and preserve valid selection IDs.

## Consequences

- The MVP avoids an extra state-management dependency.
- A single initial workspace payload is acceptable for local projects; pagination can be added if manuscripts grow beyond practical payload limits.
- Autosave correctness is implemented in one hook and covered with focused tests before reuse by adaptations.
- URL-deep-linking to individual records is deferred; the project route remains stable.
