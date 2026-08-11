# MVP Delivery Plan

## Critical user story

An author creates a story project, records its core world and characters, arranges an outline, drafts a chapter, asks AI for a context-aware suggestion without losing existing prose, creates a screenplay-style adaptation, and exports the project as Markdown.

## Slice 1: persistent project library

Acceptance criteria:

- A clean install starts with `npm install` and `npm run dev`.
- The home page has complete loading, empty, populated, validation, and failure states.
- A user can create, open, rename, and archive a project.
- Projects persist in SQLite across server restarts.
- Repository behavior and validation have automated tests.

## Slice 2: narrative workspace

Acceptance criteria:

- The workspace loads by project ID and handles missing projects.
- A user can manage story-bible entries, hierarchical outline nodes, and chapters.
- The editor autosaves Markdown without cursor disruption or silent data loss.
- Navigation remains usable on desktop, tablet, and mobile.

Delivery is split without changing the acceptance boundary:

- Slice 2A establishes the persistent schema, repository invariants, and HTTP contract.
- Slice 2B1 ships the responsive workspace shell, story bible, and outline management.
- Slice 2B2 adds chapters, serialized autosave, conflict recovery, snapshots, and restore.

## Slice 3: context-aware AI

Acceptance criteria:

- The user explicitly selects story context sent with each request.
- Six supported actions use a single server-only provider interface.
- Generated text appears as a reviewable draft with insert, replace, copy, and dismiss actions.
- Missing configuration, timeouts, and provider errors are recoverable.
- Accepted AI text and manual snapshots appear in chapter history.
- A user can inspect and restore a chapter version without discarding the current text.
- Accepted AI versions retain action, instruction, and resolved context-reference provenance.

## Slice 4: adaptation and export

Acceptance criteria:

- The user can generate or manually write a screenplay-style scene adaptation.
- Adaptation drafts persist and remain editable.
- Export produces deterministic, well-ordered Markdown with story bible, outline, chapters, and adaptations.

## Slice 5: release readiness

Acceptance criteria:

- Unit and integration checks pass, with a Playwright smoke test covering the critical path.
- Production build succeeds from a clean checkout.
- A project created under production mode remains visible after restart.
- Keyboard focus, contrast, responsive layouts, and reduced-motion behavior are verified.
- README documents setup, environment variables, architecture, verification, limitations, and next steps.
