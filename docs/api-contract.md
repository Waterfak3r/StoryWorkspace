# API and Persistence Contract

## Response envelope

Successful JSON responses use `{ "data": ... }`. Failed responses use:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "A useful human-readable message",
    "fieldErrors": { "optionalField": ["Optional validation message"] },
    "currentChapter": { "optionalFor": "EDIT_CONFLICT" },
    "retryable": false
  }
}
```

Expected codes include `VALIDATION_ERROR`, `NOT_FOUND`, `EDIT_CONFLICT`, `AI_NOT_CONFIGURED`, `AI_TIMEOUT`, `AI_AUTHENTICATION_ERROR`, `AI_RATE_LIMITED`, `AI_PROVIDER_ERROR`, `AI_INVALID_RESPONSE`, `AI_GENERATION_ALREADY_ACCEPTED`, `AI_GENERATION_ALREADY_CONSUMED`, and `INTERNAL_ERROR`. An edit conflict includes the canonical `currentChapter` or `currentAdaptation` for the affected document. A consumed generation includes `consumedBy` (`chapter` or `adaptation`) and, for an adaptation consumer, a typed `currentAdaptation`. Route handlers log diagnostic details server-side but return no stack traces or secrets.

## HTTP behavior

- `GET` is read-only and returns 200 or 404.
- `POST` creates a resource and returns 201 with its canonical representation.
- `PATCH` accepts only documented fields and returns the updated representation.
- Project archival is a `PATCH` status change, not physical deletion.
- Malformed JSON and schema failures return 400 with field errors when available.
- Missing records return 404. Stale autosaves return 409. Unexpected failures return 500.

## SQLite invariants

- Every connection enables foreign keys, a finite busy timeout, and WAL when backed by a file.
- Schema bootstrap is idempotent and versioned with `PRAGMA user_version`.
- Multi-record changes run inside an explicit transaction.
- SQL parameters are always bound. User input is never interpolated into SQL.
- Database files, WAL files, and test databases are ignored by Git.
- Tests receive an isolated temporary or in-memory database through dependency injection.

Route handlers and repository modules run only in the Node.js runtime. Any route importing `node:sqlite` declares `export const runtime = "nodejs"` directly or inherits it from a verified Node-only boundary.

Pages that read SQLite through React Server Components declare `export const dynamic = "force-dynamic"`. Client mutations merge the returned canonical record into the relevant local data slice. They do not refetch unrelated slices or replace an active chapter draft.

## Ordering and deletion

Positions are zero-based integers scoped to a project and collection. Outline reorder accepts the complete project node-ID set, rejects missing, duplicate, or foreign IDs, and normalizes positions during one transaction. Bible and outline PATCH operations are last-write-wins in the local MVP. Foreign keys use cascade only for records fully owned by the parent project or chapter.

Archiving a project keeps all descendants. Permanent deletion is outside MVP and must not be exposed accidentally.

Deleting an outline node with children is rejected. Deleting a leaf sets linked chapters' outline reference to null and does not delete chapter prose. Deleting a chapter removes its owned version history after explicit UI confirmation.

## Autosave concurrency

Chapter and adaptation updates send `baseUpdatedAt`, the timestamp of the version the client edited. The repository updates only when the stored timestamp still matches. A mismatch returns `EDIT_CONFLICT` with the current server version so the UI can preserve both texts.

Autosave is debounced on the client and serialized per document. Older responses must not overwrite a later local edit. Navigating away while a save is pending completes the request first when the app controls the navigation, warns on browser unload, and retains an unacknowledged per-tab recovery draft.

## AI request boundary

The browser sends resource IDs, not trusted context text, for story bible, outline, and chapter references. The server confirms that every resource belongs to the requested project and resolves the latest stored content.

Requests have limits for instruction length, selected prose, number of references, resolved context size, provider duration, and response size. Context is clearly separated from system instructions and treated as untrusted story content. Story text cannot override server policy.

The provider adapter receives an abort signal and maps timeouts, authentication failures, rate limits, and upstream errors into stable error codes. Logs may include request IDs and sizes but never API keys or full manuscripts.

Accepted AI output records the action, instruction, and resolved reference IDs with the created chapter version. Story content is always placed in a clearly delimited user-data section, never interpolated into the system policy.

An AI `adapt` result may instead be consumed into one screenplay adaptation. The create request sends only its stored generation ID and adaptation metadata; the server copies the generated Markdown and provenance. A generation can be consumed by one chapter version or one adaptation, never both.

## Export determinism

Markdown export orders sections by normalized position and uses stable headings. It omits empty sections, normalizes line endings to LF, and performs no AI calls. The same stored project state must produce byte-identical export content.

The export route returns a Markdown attachment rather than the JSON success envelope. Filenames are encoded safely and never interpolate raw titles into response headers.
