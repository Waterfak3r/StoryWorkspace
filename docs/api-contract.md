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

Expected codes include `VALIDATION_ERROR`, `NOT_FOUND`, `EDIT_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `ANALYSIS_STALE`, `AI_NOT_CONFIGURED`, `AI_TIMEOUT`, `AI_AUTHENTICATION_ERROR`, `AI_RATE_LIMITED`, `AI_PROVIDER_ERROR`, `AI_INVALID_RESPONSE`, `AI_GENERATION_ALREADY_ACCEPTED`, `AI_GENERATION_ALREADY_CONSUMED`, and `INTERNAL_ERROR`. An edit conflict includes the canonical `currentChapter`, `currentAdaptation`, `currentLink`, or `currentStoryboard` for the affected resource. A consumed generation includes `consumedBy` (`chapter` or `adaptation`) and, for an adaptation consumer, a typed `currentAdaptation`. Route handlers log diagnostic details server-side but return no stack traces or secrets.

Phase 2 adds `PATCH_CONFLICT` and `PATCH_RESOLVED`; both include the canonical `patch`/`currentPatch` and are non-retryable until the author reviews the proposal.

## HTTP behavior

- `GET` is read-only and returns 200 or 404.
- `POST` creates a resource and returns 201 with its canonical representation.
- `PATCH` accepts only documented fields and returns the updated representation.
- Project archival is a `PATCH` status change, not physical deletion.
- Malformed JSON and schema failures return 400 with field errors when available.
- Missing records return 404. Stale autosaves return 409. Unexpected failures return 500.

Phase 0 Story Bible routes:

- `/api/projects/{projectId}/documents`: list/create ScriptDocuments.
- `/api/documents/{documentId}` and `/api/documents/{documentId}/revisions`: read/update metadata and save immutable revisions. These short resource routes require an explicit `projectId` query parameter; project-nested variants carry the same scope in the path. A revision save accepts `baseVersion`, `requestId`, and an ordered `scenes` set; IDs are retained across reorder and omitted scenes are marked deleted.
- `/api/projects/{projectId}/entities`, `/api/entities/{entityId}/aliases`, `/api/projects/{projectId}/evidence-sources`, and `/api/projects/{projectId}/facts`: project-scoped Entity/Alias/Evidence/Canon Fact commands.
- `/api/facts/{factId}/supersede` and `/api/facts/{factId}/retract`: append/supersede or statefully retract a fact. Short entity, evidence, and fact routes require `projectId`; Fact values are never updated in place.
- `/api/projects/{projectId}/schema-registry`, `/api/projects/{projectId}/audit-events`, and `/api/projects/{projectId}/outbox-events`: inspect the code-owned predicate registry and transactional audit/outbox records.

Phase 1 deterministic analysis and scene-link routes:

- `/api/projects/{projectId}/scenes/{sceneId}/analysis-runs`: `POST` enqueues a current scene revision and returns `202` (`queued`) or `200` for a semantic/request-idempotent replay; `GET` lists project/scene/revision-scoped runs.
- `/api/projects/{projectId}/analysis/runs/{runId}/execute`: explicit `POST` lease/execute command. It returns a fenced `queued`, `running`, `succeeded`, `failed`, or `stale` run and never runs from document save.
- `/api/projects/{projectId}/scenes/{sceneId}/entity-review`: `GET` returns the selected current (or explicitly requested historical) revision's `analysisRun`, runs, mentions, links, entities, aliases, and evidenceSources. Evidence is strictly limited to returned mention evidence IDs.
- `/api/projects/{projectId}/scenes/{sceneId}/entity-links/{linkId}`: `GET` and `PATCH` read/review one link. `PATCH` requires `expectedVersion`, `expectedSceneRevisionId`, and `requestId`; confirming one candidate rejects sibling candidates in the same group transactionally.

Analysis requests are project-scoped and revision-bound. Canonical names and active aliases are normalized deterministically; unique matches may be confirmed, while same-normalized-name matches and explicit `[[character:...]]`, `[[location:...]]`, or `[[prop:...]]` stubs remain review candidates. Each run has a durable semantic idempotency tuple `(projectId, sceneRevisionId, analyzerVersion, contentHash)` plus a request-key mapping that includes its input fingerprint. A short SQLite lease token fences old executors before projection and completion. This slice has no hosted queue, LLM analyzer, Organization/Event model, or remote coordination.

Phase 2 Canon / Inference / Pending Patch routes:

- `GET /api/projects/{projectId}/patches?status=&sceneRevisionId=` lists project-scoped review records. Invalid status values return 400.
- `POST /api/projects/{projectId}/scenes/{sceneId}/fact-patches` creates a deterministic schema-validated fact candidate and its Evidence, ModelRun, Inference, and Pending Patch provenance.
- `GET /api/projects/{projectId}/scenes/{sceneId}/patch-review?sceneRevisionId=` returns current-revision `patches`, `inferences`, `modelRuns`, `evidenceSources`, `applications`, and project-scoped target/result `facts`.
- `GET /api/projects/{projectId}/patches/{patchId}` reads one patch together with its applications and any resulting Facts or EntityStates; `POST` on `accept`, `accept-edited`, and `reject` requires `expectedVersion` and `requestId`.

Accept runs a source-revision/evidence/target-version/schema/cardinality check in one transaction. It creates or supersedes a Canon Fact only after the Patch is accepted, records `patch_applications.applied_payload_json`, emits `patch.accepted` and `story_bible.changed`, and returns 409 for hard conflicts. `accept-edited` permits changing only the schema-valid value; subject, predicate, valueType, scope, and scene/range bounds remain bound to the reviewed Patch. Rejected proposals dismiss their active Inference. Repeated semantic proposals for the same SceneRevision are suppressed even when request IDs differ.

Phase 3 continuity and Scene State routes:

- `GET /api/projects/{projectId}/documents/{documentId}/continuity-groups` lists document-scoped groups. Every document owns one server-created default `main` group; `POST` idempotently creates a non-default flashback, dream, parallel, or custom group.
- Scene revision create payloads carry `continuityGroupId`. Existing documents receive a default main group, and every immutable SceneRevision freezes the group used for that revision.
- `POST /api/projects/{projectId}/scenes/{sceneId}/state-patches` proposes a current-revision `add_state` Patch for `wardrobe.current`, `state.injury`, or `state.held_prop`, with exact Evidence, `subjectEntityId`, required entity `baseVersion`, carry-forward, priority, and optional valid-to Scene. One held-prop Patch carries one same-project Prop UUID; the resolver aggregates multiple active rows.
- `GET /api/projects/{projectId}/scenes/{sceneId}/resolved-state?sceneRevisionId=&entityId=` resolves confirmed linked entities by default or one explicitly requested same-project entity. It returns per-field `explicit`, `carried`, `base`, `missing`, or `conflict` results, complete source IDs, and `hasBlockingConflicts`.

State acceptance uses the existing Patch endpoints and transaction. `accept-edited` may change only the state value. The workspace disables revision-bound proposal and review commands while a Scene revision is dirty, so a locally selected continuity group must be saved and frozen before State review. The resolver reads no future narrative rank and never carries across a continuity group; single-valued same-tier and same-priority conflicts are returned rather than resolved by last-write-wins, while `state.held_prop` aggregates unique entity references.

Phase 4 Context Builder routes:

- `POST /api/projects/{projectId}/contexts/build` accepts a current `sceneId`/`sceneRevisionId`, matching `storyboard` or `video` purpose and code-owned policy ID, `allowInferred=false`, `requestId`, and actor. It returns 201 for a new immutable Snapshot or 200 for a request/semantic replay.
- `GET /api/projects/{projectId}/contexts?sceneId=&sceneRevisionId=&purpose=&policyId=&latest=` lists project-scoped snapshots with strictly validated filters.
- `GET /api/projects/{projectId}/contexts/{contextId}` reads one immutable Snapshot by project scope.

Snapshot content is provider-neutral and contains the frozen Scene, included confirmed-link entities, policy-selected Base Facts, resolved State, structural budget metadata, `missing`, `conflicts`, `warnings`, `omitted`, and provenance. Candidate links, Inference, RAG, assets, and Provider requests are not included in this slice. Dirty Scene revisions cannot start a build in the workspace. Request IDs use a full input fingerprint; identical content is semantically deduplicated by stable content hash without mutating prior content.

Phase 5A Storyboard routes:

- `POST /api/projects/{projectId}/scenes/{sceneId}/storyboards` atomically creates and seals one immutable Storyboard with all ordered ShotSpecs from a same-project Context Snapshot. No partially written aggregate is readable. Optional `supersedesStoryboardId` plus expected version creates a replacement and supersedes the old board.
- `GET /api/projects/{projectId}/scenes/{sceneId}/storyboards?contextSnapshotId=&status=` lists strict project/Scene-scoped summaries with ShotSpecs.
- `GET /api/projects/{projectId}/storyboards/{storyboardId}` reads one complete Storyboard by project scope.
- `POST /api/projects/{projectId}/storyboards/{storyboardId}/approve` uses expected version and request ID to transition draft to approved idempotently.

Shot subjects, location and prop IDs must be present in the bound Snapshot with the matching entity type. Content cannot be updated; editing creates a replacement Storyboard and preserves the older Storyboard/ShotSpec input.

## SQLite invariants

- Every connection enables foreign keys, a finite busy timeout, and WAL when backed by a file.
- Schema bootstrap is idempotent and versioned with `PRAGMA user_version`.
- Phase 0–5A migrations bring the local schema to version 15 from the MVP baseline. New cross-project references are checked in repositories and SQLite project-guard triggers; revisions, evidence, analysis identities, patch payload/provenance, Fact values, EntityState values, Context Snapshot content, and ShotSpec content are immutable, with only documented lifecycle/version/latest transitions. Pending Patches are Canon-only review commands with operation-specific target/baseVersion and application-result shape; Patch status/version and Inference lifecycle transitions are trigger-guarded. v11 enforces Fact/Inference scope shape and same-project resolvable entity references; v12 requires accepted non-null ModelRuns to be succeeded and source-bound; v13 adds document-scoped continuity, state provenance, and atomic `add_state` acceptance; v14 additively stores provider-neutral Context Snapshots whose latest index can change without changing content; v15 binds immutable Storyboards/ShotSpecs to a Snapshot and uses CAS lifecycle transitions. A new revision that removes accepted text evidence creates a reviewable Fact retract suggestion; it never directly mutates Canon.
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
