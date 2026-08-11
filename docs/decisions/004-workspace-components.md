# ADR 004: Narrative workspace component boundaries

## Status

Accepted for MVP Slice 2 UI.

## Context

The workspace must coordinate three record types, responsive navigation, and a continuously edited chapter without turning one client component into an untestable state container.

## Decision

The project route remains a dynamic React Server Component. It reads the complete narrative workspace directly from the repository, handles a missing project with `notFound()`, and passes serializable initial data to one client shell.

The client shell owns only cross-feature state:

- canonical arrays for bible entries, outline nodes, and chapters;
- active section and active record IDs;
- navigator and context drawer visibility;
- a contextual mutation error announced through an ARIA live region.

Feature modules own their form drafts and request states. Structured edits are pessimistic: keep typed input, wait for the API response, then replace the canonical record with the returned record. A failure never clears the draft.

## Component map

- `NarrativeWorkspace`: shared data, selection, responsive shell, and section routing.
- `WorkspaceNavigator`: section tabs and record lists; no persistence logic.
- `StoryBibleWorkspace`: entry form, category selection, create, update, and delete.
- `OutlineWorkspace`: tree projection, node form, parent validation hints, create, update, delete, and keyboard-safe move buttons.
- `ChapterWorkspace`: document metadata, editor, save status, conflicts, snapshots, and history.
- `useChapterAutosave`: the only module allowed to coordinate chapter revision timestamps and queued saves.
- `workspace-api`: typed JSON request helper that preserves the server error code, message, field errors, retryability, and conflict payload.

## Outline projection

Storage order is project-wide, while parent IDs define hierarchy. The UI derives a pre-order tree by sorting siblings by `(position, id)`. Moving a node swaps it with the previous or next sibling, then submits the complete duplicate-free pre-order ID list. Parent choices exclude the node and all descendants. A node with children cannot be deleted.

## Chapter editing

Switching chapters or using a workspace-owned navigation link is blocked by a confirmation while the current chapter is dirty, saving, failed, or conflicted. The editor keeps local text authoritative until a save is acknowledged. It mirrors each unacknowledged draft into per-tab session storage before yielding control. A 409 response exposes both local and server text; neither side is selected automatically.

Manual snapshots and restore first flush the save queue and are blocked unless pending prose is acknowledged. Restore requires confirmation, uses the latest acknowledged timestamp, and replaces local text only with the successful server response. The server-created restore backup appears in refreshed history.

## Responsive behavior

At 1024px and above, navigation is a fixed-width left column and the contextual rail is optional. Below 1024px, each becomes a labelled modal drawer with Escape and backdrop close behavior, focus restoration, and no simultaneous drawers. The editor remains the only persistent region.

## Testing seam

Pure helpers cover tree projection, descendant detection, sibling moves, and canonical record replacement. The autosave hook is tested with controlled deferred requests, edits during an in-flight request, conflict, retry, flush, and session-draft recovery. Browser coverage later verifies creation through restore across desktop and mobile viewports.

## Consequences

The shell remains understandable without a global state library. Feature work can be delivered in two independent UI increments, and the autosave protocol remains isolated for later reuse by adaptations.
