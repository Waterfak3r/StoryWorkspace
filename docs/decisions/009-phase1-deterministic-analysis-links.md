# ADR 009: Revision-bound deterministic scene analysis and links

- Status: Accepted for Phase 1
- Date: 2026-08-11

## Context

Phase 1 needs a reviewable scene/entity vertical slice while document saves remain fast and reliable. Analysis output must not move across scene revisions, leak across projects, or let an old worker overwrite a newer projection. The current application is a local Next.js + SQLite single-user MVP; a hosted queue, PostgreSQL, and model provider are not available assumptions.

## Decisions

### Revision-bound anchors

Every `entity_mentions` row and its `evidence_sources` row carries the immutable `sceneRevisionId`. `anchorStart`/`anchorEnd` are offsets in that scene revision only. A reanalysis marks prior active projections stale, retains rejected feedback, and writes fresh mentions; the read model excludes stale evidence from current links. Immutable document/scene revisions and evidence provenance prevent direct SQL edits from invalidating hashes or offsets.

### Explicit SQLite enqueue/execute lease

`POST .../analysis-runs` performs one `BEGIN IMMEDIATE` transaction: it validates the document's current scene revision, checks the semantic tuple and request-key fingerprint, marks obsolete work/projections stale, and inserts a queued run. It never starts background work. A separate execute command claims a lease token and expiry, runs the deterministic analyzer, and commits projection, succeeded status, and completion audit/outbox together. Projection and terminal status updates require the same unexpired lease token, so a reclaimed worker is fenced. Failures mark only the run failed and leave document content unchanged.

### Alias and resolver policy

The Phase 1 resolver normalizes NFKC, case, and whitespace, then matches exact canonical names and active aliases for Character, Location, and Prop entities. A unique entity is an auto-confirmed link; any same-normalized-name ambiguity, including across entity types, creates candidate links only. Explicit `[[character:name]]`, `[[location:name]]`, and `[[prop:name]]` notation creates a draft entity/alias and a candidate link. No LLM call is made by this analyzer.

### Review and feedback

Link review is a project-scoped CAS command requiring `expectedVersion`, `expectedSceneRevisionId`, and `requestId`. Confirming one candidate rejects siblings transactionally. Rejected link/mention fingerprints suppress the same revision's reappearance, and confirmed/rejected decisions survive analyzer-version reanalysis. Entity archival/merge is blocked while confirmed scene links still point at the entity; migration/redirect UX is deferred.

## Consequences and deferrals

The local worker is durable and retryable but not a distributed queue. There is no Organization/Event domain, remote storage, RAG, provider orchestration, or LLM resolution in this phase. Link roles and deterministic exact matching are intentionally small; open-world inference, patch workflows, entity merge migration, and hosted leases remain later ADRs. The schema is version 8 and all new routes require an explicit project scope.
