# ADR 002: Narrative persistence and edit conflicts

## Status

Accepted for MVP Slice 2.

## Context

Story-bible entries, outline structure, and chapter prose need stable relationships, deterministic ordering, and safe local autosave. A single project JSON blob would make targeted updates, reference selection, version history, and future migrations fragile.

## Decision

Store story-bible entries, outline nodes, chapters, and chapter versions in normalized SQLite tables owned by a project.

- Records use application-generated UUIDs and explicit foreign keys.
- Collection order uses integer `position`, with `(position, id)` as the deterministic read order.
- An outline node may reference a parent in the same project. Repository validation prevents self-parenting and descendant cycles.
- An outline node with children cannot be deleted until its children are moved or deleted. Deleting a leaf sets linked chapters' outline reference to null and never deletes prose.
- Outline reorder is project-wide and requires the complete, duplicate-free set of node IDs. The server rejects partial or foreign sets, then normalizes positions to `0..n-1`.
- Deleting a project cascades to all narrative records. Permanent project deletion remains unavailable in the MVP UI.
- Deleting a chapter cascades to versions owned by that chapter; the UI must confirm this destructive action.
- Schema changes use incremental `PRAGMA user_version` migrations and must preserve prior project records.

Chapter writes use optimistic concurrency. Every update sends `baseUpdatedAt`; SQL updates only the matching stored revision. A stale write returns `EDIT_CONFLICT` plus the current server chapter so the client can keep both texts.

Story-bible and outline updates are last-write-wins in the local single-user MVP. Their UI serializes mutations per record; optimistic tokens can be added if cloud or multi-window editing becomes a product requirement.

Autosave updates the current chapter without creating a version on every keystroke. Versions are created by explicit snapshots, restore backups, and accepted AI changes. Restoring a version first snapshots the current body as `restore_backup`, then applies the selected version.

AI-created versions reserve nullable provenance fields for action, user instruction, and resolved context-reference IDs. Slice 3 will populate them.

## Consequences

- APIs can load and mutate only the requested narrative resource.
- Context selection can reference stable IDs without copying browser-supplied text.
- Reordering and hierarchy require transactions and server validation.
- Clients must handle 409 conflicts rather than assuming last-write-wins.
- Version storage grows with deliberate user actions, not autosave frequency.
