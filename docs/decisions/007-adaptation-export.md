# ADR 007: Adaptation persistence and deterministic export

## Status

Accepted for MVP Slice 4.

## Context

The MVP needs one concrete cross-modal outcome without introducing a media production pipeline. Authors must be able to write a screenplay-style scene manually or save an explicitly reviewed AI `adapt` result, continue editing it safely, and export the whole project as Markdown.

## Decision

### Adaptation record

Schema version 4 adds `adaptations` with:

- `id`, `project_id`, `format`, `title`, `body`, `position`;
- nullable unique `source_generation_id` for trusted AI provenance;
- `created_at` and `updated_at`;
- project cascade ownership and `ON DELETE SET NULL` for generation provenance.

The only MVP format is `screenplay_scene`. Title is limited to 160 characters and body to 100,000 characters. Lists always sort by `position`, then `id`.

Adaptations do not have version history in the MVP. Updates use the same timestamp compare-and-swap rule as chapters and return `EDIT_CONFLICT` with `currentAdaptation`. The editor preserves the local body, mirrors unacknowledged work to per-tab storage, and offers retry, use-server, and keep-local recovery.

### Manual and AI creation

`GET /api/projects/[projectId]/adaptations` lists the project adaptations. `POST` accepts a strict discriminated union:

- `{ origin: "manual", format: "screenplay_scene", title, body?, position? }`;
- `{ origin: "ai", format: "screenplay_scene", title, generationId, position? }`.

For AI creation, the server loads the stored generation and verifies that it belongs to the project, has action `adapt`, has not been accepted into a chapter, and has not already created an adaptation. The stored generated Markdown becomes the adaptation body; browser-supplied generated text is never trusted. Creation and provenance linking happen in one immediate transaction. A generation can be consumed by either a chapter or one adaptation, not both.

`PATCH /api/adaptations/[adaptationId]` updates an adaptation using `baseUpdatedAt`. `DELETE` removes only that adaptation after confirmation. Deleting an AI-created adaptation leaves the generation record intact and makes it eligible to be saved again.

The existing chapter AI panel remains the generation surface. When the reviewed result has action `adapt`, it additionally offers `Save as adaptation`. The action uses the generation ID, flushes the active chapter before navigation, creates the adaptation, and opens its editor. The existing insert, replace, copy, and dismiss actions remain available.

The `adapt` prompt is fixed to screenplay-style scene Markdown for the MVP: slugline, present-tense action, character cue, and dialogue. The author's instruction can shape the scene but cannot switch the persisted format.

### Adaptation workspace

The navigator shows ordered adaptations and provides create and delete controls. The center editor exposes title and Markdown body with the same `Unsaved`, `Saving`, `Saved`, conflict, and recovery language used for chapters. The format is visible but not editable while only one format exists.

Leaving an adaptation, opening another record, returning to the library, or exporting first flushes its serialized save queue. A failed save or unresolved conflict blocks the transition and keeps the local draft.

### Markdown export

`GET /api/projects/[projectId]/export` returns `text/markdown; charset=utf-8` with a safe attachment filename. It is intentionally not wrapped in the JSON response envelope.

The renderer is a pure server module. It reads stored canonical state, performs no AI call, normalizes line endings to LF, and emits sections in this order:

1. project title, genre, and premise;
2. story-bible entries grouped by the fixed category order and then record order;
3. outline nodes in deterministic tree order;
4. chapters by position and ID;
5. adaptations by position and ID.

Empty collections and empty optional fields are omitted. Headings use normalized single-line titles. Given the same stored state, the response bytes are identical.

The workspace export action first blocks on unsaved explicit-form changes or flushes the active autosaved document. A preview identifies the included section counts before download.

## Consequences

- The adaptation flow reuses the reviewed AI generation boundary without generalizing chapter acceptance or trusting client prose.
- Screenplay scene is the only cross-modal format shipped in the MVP, while the `format` column leaves a clear extension point.
- Adaptation autosave adds focused code and tests but avoids a risky chapter-autosave refactor before release.
- Export remains fast, private, testable, and independent of provider availability.
