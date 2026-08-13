# MVP Architecture

## Product boundary

The MVP is a local-first, single-user long-form narrative workspace. It must let an author create a project, maintain a story bible and outline, draft chapters with selected AI context, produce one structured adaptation, and export Markdown.

Authentication, billing, realtime collaboration, media generation, and cloud sync are deliberately outside the first release.

## Stack

- Runtime and package manager: Node.js 24.x and npm, locked by `engines` and `.nvmrc`.
- Application: Next.js App Router with TypeScript.
- Styling: Tailwind CSS v4 with custom semantic tokens.
- Accessible primitives: Radix UI only where native elements are insufficient.
- Icons: Phosphor Icons with one consistent weight.
- Validation: Zod at every external boundary.
- Persistence: Node's built-in `node:sqlite`, stored under `.data/story-workspace.db`.
- Tests: Vitest for domain and repository tests; Playwright for the release critical path.
- AI: a server-only OpenAI-compatible adapter implemented with `fetch`.

## Runtime model

Use one deployable Next.js application. React Server Components read initial data; client islands own editing, autosave, dialogs, and AI interactions. Every page that reads SQLite is explicitly `force-dynamic`, and every route importing server persistence uses the Node.js runtime. Route handlers are the sole mutation boundary. Database and AI modules must be server-only.

No browser code may read API keys or access SQLite. Generated content is always returned as a draft for user review and never overwrites prose without an explicit action.

## Primary routes

- `/`: project library with create, open, rename, archive, and empty states.
- `/projects/[projectId]`: three-region writing workspace.
- `/api/projects`: list and create projects.
- `/api/projects/[projectId]`: read, update, and archive a project.
- `/api/projects/[projectId]/workspace`: read the complete working set.
- `/api/projects/[projectId]/bible`: create and update bible entries.
- `/api/projects/[projectId]/outline`: create, reorder, and update outline nodes.
- `/api/projects/[projectId]/chapters`: create and list chapters.
- `/api/chapters/[chapterId]`: read, autosave, and snapshot a chapter.
- `/api/chapters/[chapterId]/restore`: restore a stored version as a new current version.
- `/api/ai/generate`: generate a reviewed draft from selected context.
- `/api/projects/[projectId]/adaptations`: list and create manual or reviewed-AI adaptation drafts.
- `/api/adaptations/[adaptationId]`: update or delete an adaptation draft.
- `/api/projects/[projectId]/export`: download project Markdown.
- `/api/projects/[projectId]/scenes/[sceneId]/analysis-runs`: enqueue and list deterministic scene analysis.
- `/api/projects/[projectId]/analysis/runs/[runId]/execute`: explicitly claim/execute one durable analysis run.
- `/api/projects/[projectId]/scenes/[sceneId]/entity-review`: read revision-bound runs, mentions, links, entities, aliases, and evidence.
- `/api/projects/[projectId]/scenes/[sceneId]/entity-links/[linkId]`: project-scoped link read and CAS review.

## Workspace layout

- Left rail: project identity, story bible, outline, chapters, adaptations, Scripts.
- Center: the active editor or structured form.
- Right rail: context picker and AI action panel.
- Below 1024px, the side regions become drawers; the editor remains primary.

The visual system uses cool neutral surfaces, a single restrained vermilion accent, 12px containers, 8px controls, pill-shaped status only, and system-aware light/dark tokens. Motion is limited to feedback and state transitions.

## Data model

- `projects`: identity, premise, genre, status, timestamps.
- `bible_entries`: project, category, title, body, position, timestamps.
- `outline_nodes`: project, optional parent, kind, title, summary, position.
- `chapters`: project, optional outline node with `ON DELETE SET NULL`, title, summary, body, position, status, timestamps.
- `chapter_versions`: chapter, body, source, optional AI action, instruction, resolved context reference IDs, created timestamp.
- `adaptations`: project, screenplay-scene format, title, body, order, optional source-generation provenance, timestamps.

Phase 0 adds a separate authoring aggregate without changing Chapter behavior:

- `script_documents`: project-owned document identity and optimistic `version`.
- `document_revisions`: immutable document snapshots with a content hash.
- `scenes`: stable scene UUIDs, narrative rank, and stateful deletion status.
- `scene_revisions`: immutable scene content tied to exactly one document revision and its content hash.
- `entities`, `entity_aliases`, `facts`, and `evidence_sources`: project-scoped Story Bible records. Fact values are append-only; replacement creates a `supersedes_fact_id` chain.
- `audit_events`, `outbox_events`, and `idempotency_keys`: transactional observability and retry boundaries.

Phase 1 extends the same aggregate with deterministic, revision-bound analysis:

- `analysis_runs`: queued/running/succeeded/failed/stale runs with attempt, lease token, analyzer version, content hash, and semantic/request idempotency.
- `entity_mentions` and `evidence_sources`: immutable surface/offset fingerprints tied to one scene revision and run; stale/rejected lifecycle never changes the stored anchor.
- `scene_entity_links` and `scene_entity_link_mentions`: project-scoped candidate/confirmed/rejected/stale links with CAS versions and mention aggregation.

Phase 2 adds an explicit provenance and review plane:

- `model_runs`: deterministic fact-extractor/revalidation runs bound to one source SceneRevision.
- `inferences` and `inference_evidence`: independently stored `inferred` candidates; promotion never edits their truth class.
- `pending_patches`, `patch_evidence`, and `patch_applications`: immutable payload/provenance with pending/accepted/rejected/expired/superseded CAS state. Accepted patches create or supersede Canon Facts in one transaction and emit `story_bible.changed`.
- `promoted_from_inference_id` on `facts`: a traceable link from the resulting Canon Fact to its reviewed Inference.

Phase 3 adds revision-bound continuity and temporary state without changing Character Base facts:

- `continuity_groups`: document-scoped main, flashback, dream, parallel, or custom continuity lanes. Scene revisions freeze the selected group.
- `entity_states`: append-only Canon scene state for wardrobe, injury, and held props with evidence, carry-forward, priority, and lifecycle metadata.
- `add_state` Pending Patches and PatchApplications: the existing review transaction creates EntityState results; there is no separate state acceptance path.
- resolved Scene state: current explicit state wins over same-group carried state, which wins over mapped Base Canon; missing and same-tier conflicts remain explicit.

Phase 4 adds the deterministic boundary between authoring knowledge and generation:

- `context_snapshots`: project/SceneRevision-scoped immutable provider-neutral content with purpose, code-owned policy version, input/content hashes, and a mutable latest index only.
- Context Builder: confirmed current-revision links → policy-selected active Base Facts → resolved Character State → structured budget → missing/conflict/warning/omitted/provenance output.
- Context Inspector: reads the persisted Snapshot rather than recomputing presentation-only context. Candidate links, Inference, RAG, assets, and Provider requests are explicitly outside this first context slice.

Phase 5A adds the first immutable visual-planning boundary:

- Storyboard: one project/SceneRevision/Context Snapshot-bound visual plan whose complete Shot set is atomically sealed before it becomes readable, with draft, approved, and superseded lifecycle.
- ShotSpec: immutable ordered structured action, subject, composition, timing, and continuity constraints; all entity IDs resolve through the bound Snapshot.
- Storyboard revision: creates a replacement aggregate and atomically supersedes the expected old version instead of overwriting Shot content.

Phase 5B adds a provider boundary without a provider side effect:

- Approved reference-image metadata is project/entity-scoped and immutable; it does not claim a stored image binary.
- Prompt Compiler consumes only one approved immutable Shot, its frozen Context Snapshot, the code-owned `fake-video-v1` capability profile, selected reference versions, and explicit parameters.
- Immutable CompiledGenerationRequest content records stable prompt segments, asset roles, normalized parameters, warnings, omissions, compiler/profile versions, and hashes.
- Fake Video Adapter validates and prepares the exact `fake://video/generate` request preview.

Phase 5C closes the local generation lifecycle:

- Immutable Generation Manifest freezes one compiled request together with its Context/Storyboard/Shot source chain, exact prepared request, parameters, provider/model/profile/compiler versions, and stable hashes.
- One versioned Generation Job uses queued/running/succeeded/failed CAS transitions. A terminal result is immutable and retains a deterministic `fake://video/results/...` URI plus normalized metadata.
- The Fake Adapter exercises validate/prepare/submit/getStatus/normalizeResult without network, credentials, charges, or media binaries. Its project-scoped submission ledger proves request replay and timeout recovery do not duplicate a provider submit.

The schema is currently v17. SQLite migrations add project guards, immutable revision/provenance triggers, analysis identity guards, lease/status fencing, confirmed-link tombstone guards, fact/state status and version invariants, Patch/Inference provenance guards, immutable Context content guards, and immutable downstream generation-input guards. Phase 2 v10 makes Pending Patch commands Canon-only and enforces operation-specific target/base-version shape at the database boundary; v11 adds scope-shape and same-project entity-reference guards plus operation-specific accepted Fact/Application provenance checks; v12 fences accepted patches to succeeded ModelRuns bound to the source revision and rejects mixed Patch/Inference evidence provenance. Phase 3 v13 adds continuity groups, immutable revision membership, EntityState, and atomic `add_state` applications while preserving v12 review history. Phase 4 v14 additively stores deterministic Context Snapshots; only the latest index may change. Phase 5A v15 stores immutable Storyboard and ShotSpec content. Phase 5B v16 stores approved reference metadata and immutable compiler/Fake Adapter previews. Phase 5C v17 stores immutable Manifests/results, CAS-safe jobs, and a Fake-only exactly-once submission ledger. The analysis worker remains an explicit local enqueue/execute protocol; hosted queues, RAG, live Story Bible extractors, object storage, and real Provider generation are not claimed.

SQLite triggers reject cross-project references for the new aggregates in addition to repository checks. The predicate schema registry is code-owned in `src/domain/story-bible.ts`; clients cannot introduce arbitrary fact paths.

All records use application-generated UUIDs. Foreign keys cascade within a project. Reordering uses integer positions. Timestamps are ISO-8601 UTC strings at API boundaries.

## AI contract

Supported actions are `brainstorm`, `continue`, `rewrite`, `summarize`, `consistency`, and `adapt`. A request contains an action, user instruction, selected context references, and optional selected prose. The server resolves references, applies size limits, constructs the prompt, and calls the configured provider.

Environment variables:

- `AI_BASE_URL`, defaulting to the OpenAI API base URL.
- `AI_API_KEY`, required for live generation.
- `AI_MODEL`, required for live generation.

Missing configuration returns a typed `AI_NOT_CONFIGURED` response. Provider failures return a recoverable error and never mutate story data. Accepted AI content records its action, instruction, and resolved context references so authors can trace its origin.

## Module boundaries

- `src/domain`: types, schemas, policies, and pure transformations.
- `src/server/db`: connection, schema bootstrap, and repositories.
- `src/server/ai`: context assembly, prompts, and provider adapter.
- `src/server/export`: deterministic Markdown rendering.
- `src/components`: reusable visual and interaction primitives.
- `src/features`: project, bible, outline, chapter, AI, adaptation, Scripts analysis/review, and export UI.

Feature UI must call route handlers, not repositories. Repositories must not import React or HTTP types. Prompts must not import database primitives.

## Delivery slices

1. Project library plus persistent project creation.
2. Workspace shell plus story bible, outline, and chapter CRUD.
3. Chapter autosave, snapshots, context selection, and AI adapter.
4. Structured adaptation, Markdown export, responsive states, and documentation.
5. Automated critical-path verification, accessibility pass, and release cleanup.

## Quality gates

Every slice must pass formatting, lint, typecheck, relevant tests, and a production build. The final MVP additionally requires a fresh-install run, persistence verification after a production build and restart, Playwright critical-path smoke coverage, AI failure-path verification, keyboard navigation, responsive checks, and a complete README.
