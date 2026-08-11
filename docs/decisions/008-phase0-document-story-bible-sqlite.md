# ADR 008: Phase 0 document and Story Bible aggregates on SQLite

## Context

The MVP already persists Chapters and outline scenes. The Story Bible engineering specification requires stable prose Scenes, immutable revisions, and project isolation, but migrating Chapter behavior or introducing PostgreSQL would expand the Phase 0 boundary.

## Decision

Keep the modular monolith and add an independent `script_documents → document_revisions → scenes → scene_revisions` aggregate in SQLite schema migration 5. A document revision writes the complete scene set in one transaction. Existing scene IDs are retained and only `narrative_rank` changes on reorder; omitted scenes remain as stateful `deleted` rows. Every SceneRevision stores the parent `documentRevisionId` and a SHA-256 content hash.

Add project-scoped `entities`, `entity_aliases`, `facts`, and `evidence_sources`, with a code-owned predicate registry. Canon Fact values are append-only: a replacement inserts a new Fact and marks the previous Fact superseded; retraction changes only lifecycle status. Mutating commands carry an expected version and request ID. `idempotency_keys`, `audit_events`, and `outbox_events` are written in the same transaction as the domain change.

Repository checks are complemented by SQLite triggers for project-matching foreign references. Evidence `revisionId` is explicitly a SceneRevision identifier; the API also exposes `sceneRevisionId` to make that binding unambiguous.

## Trade-offs and migration

The existing Chapter/outline tables remain unchanged. SQLite triggers provide the project-scope invariant without rebuilding MVP tables; a future PostgreSQL migration can replace them with composite foreign keys/RLS. Phase 0 does not run analysis, infer facts, create SceneEntityLinks, or call providers. Those consumers must use immutable document/scene revisions and evidence IDs.

## Verification

The Phase 0 tests cover v4-to-v5 bootstrap, scene reorder/deletion, stale revision conflicts, fact supersede chains, predicate validation, cross-project IDs, database guards, and duplicate request IDs.
