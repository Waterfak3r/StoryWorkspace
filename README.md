# Story Workspace

Story Workspace is a long-form narrative workspace for creating and adapting stories across prose and screenplay formats. It keeps the premise, story bible, outline, chapters, reviewable AI drafts, adaptations, and deterministic Markdown export in one quiet local workspace.

## MVP capabilities

- Create, open, rename, and archive projects.
- Store story bible entries with categories for world, character, location, rule, and theme.
- Build an ordered outline with story, act, chapter, and scene nodes.
- Draft chapters in Markdown with debounced autosave, local recovery, conflict review, and version history.
- Select explicit story context for AI actions including brainstorm, continue, rewrite, summarize, consistency, and adapt.
- Review AI output before inserting or replacing chapter prose, or save an adapt result as a screenplay scene.
- Edit screenplay adaptations with the same autosave and conflict safeguards.
- Preview and download a stable Markdown export containing project, bible, outline, chapter, and adaptation sections.
- Use the workspace on desktop and mobile layouts with keyboard focus handling and reduced motion support.

## Requirements

- Node.js 24.x. The expected major version is recorded in `.nvmrc`.
- npm 11 or a compatible npm release.
- Chromium for Playwright browser tests. The application itself does not require a browser download.

## Install and develop

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The development server uses hot reload. For a fresh dependency installation without a lockfile install, `npm install` is also supported.

## Production run

```bash
npm run build
npm run start -- -p 3000
```

Next.js serves the built application on the selected port. Use a process manager and a private filesystem for the database in a hosted environment. There is no authentication or multi-user access layer in this MVP.

## Environment variables

Copy `.env.example` to `.env.local` for local configuration. Empty AI values intentionally disable AI assistance.

| Variable | Default | Purpose |
| --- | --- | --- |
| `STORY_WORKSPACE_DB_PATH` | `.data/story-workspace.db` | SQLite file path. Relative paths resolve from the application working directory. Parent folders are created automatically. |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Private server-side base URL for an OpenAI Responses-compatible provider. The app posts to `/responses`. |
| `AI_API_KEY` | empty | Provider credential. Keep it server-side and out of source control. |
| `AI_MODEL` | empty | Provider model identifier. AI requests are rejected as not configured until both this and `AI_API_KEY` are set. |
| `PLAYWRIGHT_WEB_PORT` | `43140` | Local app port used by `npm run test:e2e`. |
| `PLAYWRIGHT_FAKE_OPENAI_PORT` | `43141` | Local fake provider port used by `npm run test:e2e`. |
| `PLAYWRIGHT_DB_PATH` | `.tmp/playwright/story-workspace.db` | Optional isolated SQLite path for browser tests. It becomes the test process `STORY_WORKSPACE_DB_PATH`; the test runner deletes this file and its sidecars before each run. Never point it at a real story database. |
| `PLAYWRIGHT_AI_API_KEY` | `playwright-local-key` | Optional test-only credential passed to the local fake provider. |
| `PLAYWRIGHT_AI_MODEL` | `playwright-fake-model` | Optional test-only model name passed to the local fake provider. |

The default database is local and is ignored by Git. To use another database, set an absolute path or a path relative to the directory where `npm run dev` or `npm run start` is launched:

```bash
STORY_WORKSPACE_DB_PATH=D:/private/story-workspace.db npm run dev
```

On Windows PowerShell, use `$env:STORY_WORKSPACE_DB_PATH = 'D:\private\story-workspace.db'` before starting the server. SQLite may create `-wal` and `-shm` sidecar files beside the database.

## Architecture and data flow

- `src/app` contains App Router pages and Node.js route handlers. `/` renders the project library and `/projects/{projectId}` renders the narrative workspace.
- `src/domain` contains Zod schemas, limits, and stable domain types.
- `src/server/db` owns the built-in `node:sqlite` connection, schema versioning, repositories, optimistic concurrency, and persistence.
- `src/features` contains the accessible client workspace, navigation, editors, autosave, conflict views, AI review panel, and export preview.
- Browser code calls route handlers under `/api`. It never opens SQLite directly.

The project page reads a complete workspace snapshot from SQLite. Client mutations call the route handlers and replace local state with canonical records. Chapter and adaptation editors debounce changes for 800 milliseconds, send the acknowledged `updatedAt` as a compare-and-swap base, preserve a newer in-flight edit, and retain recoverable local drafts on conflict. AI generation resolves only the selected context on the server, sends a structured Responses request to `AI_BASE_URL`, persists the generation, and returns a reviewable result. Adaptation save consumes a generation exactly once. Export reads the canonical workspace through the export route and renders sections in project, bible, outline, chapter, and adaptation order.

## Verification

Run the unit, static, production, and browser checks with:

```bash
npm test -- --run
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

`npm run test:e2e` builds the app, starts a local Next.js server, starts the auditable fake Responses provider in `e2e/fake-openai.mjs`, and runs Playwright against the isolated `PLAYWRIGHT_DB_PATH`. The test runner deletes that test database and its SQLite sidecars before starting, so the path must be disposable. It does not call a public AI service. The Playwright web servers use fixed ports by default and do not reuse existing processes; override the dedicated port variables if a port is occupied.

Install the browser once before the first browser run:

```bash
npx playwright install chromium
```

The critical path creates a project, saves bible and outline records, autosaves a chapter, generates an explicit-context adapt draft, saves and edits a screenplay adaptation, downloads and inspects Markdown, reloads the project, and checks a mobile navigation drawer for focus and horizontal overflow.

## Data and secrets

Story data is stored in the configured SQLite file and its sidecars. Back up that file when the story is important. API keys are read only by server-side route handlers from environment variables. Do not place credentials in client code, committed files, browser storage, screenshots, or exported Markdown. The bundled fake provider is for local automated tests only and returns deterministic content.

## Phase 0 Story Bible foundation

The local SQLite schema includes an independent `ScriptDocument → DocumentRevision → Scene → SceneRevision` aggregate alongside the existing Chapter model. Document revisions are immutable snapshots: reordering preserves scene UUIDs, and omitted scenes become stateful `deleted` records. Story Bible entities, aliases, evidence sources, canon facts, audit events, and outbox events are project-scoped and exposed through Phase 0 JSON routes. Fact replacement creates a supersede chain; it never overwrites a fact value in place. Mutations accept an expected version and request ID for optimistic concurrency and idempotent retries.

## Phase 1 deterministic scene analysis

The Scripts workspace adds one project-scoped `ScriptDocument` with explicitly saved scene revisions. Schema v15 stores revision-bound analysis runs, entity mentions, evidence anchors, versioned scene-entity links, Canon-only Pending Patches, transactional review decisions, continuity groups, EntityState, immutable Context Snapshots, and immutable Storyboard/ShotSpec content. The v11 additive guards enforce Fact/Inference scope shape and same-project entity references; v12 additionally requires accepted non-null ModelRuns to be succeeded and bound to the Patch source revision, and rejects mixed Patch evidence provenance; v13 adds atomic `add_state` applications and revision-frozen continuity membership; v14 adds project-scoped immutable context content and latest-index guards; v15 binds reviewable visual shots to one frozen Context Snapshot. Together they verify accepted PatchApplication results and generation inputs against their applied payload, evidence, provenance, and source revision. Enqueue is durable and returns immediately; a separate execute command claims a short SQLite lease and performs deterministic projection with fencing, retry, and stale-revision checks.

The local resolver matches exact canonical names and active aliases after NFKC/whitespace/case normalization. Unique matches are confirmed, same-normalized-name matches remain candidates, and `[[character:...]]`, `[[location:...]]`, and `[[prop:...]]` stubs create draft entities for review. No LLM or background queue is required for this slice, and document save never waits for analysis. Evidence and review read models are always filtered by project and scene revision.

## Phase 3 Scene State continuity

Scene revisions select a document-scoped continuity group. Wardrobe, injury, and held-prop changes enter the same reviewable Pending Patch workflow as Canon facts but are applied to independent EntityState records, so temporary state never overwrites Character Base. The resolved-state inspector uses current Scene explicit state, then the nearest earlier carry-forward state in the same continuity group, then an explicit Base fallback; missing and same-tier conflicting values remain visible and blocking. This is a narrative-order MVP, not a general story-time or parallel-world engine.

## Phase 4 inspectable Context Snapshots

The Context Builder reads one current saved SceneRevision, its confirmed SceneEntityLinks, policy-selected active Base Canon Facts, and resolved Scene State. It creates a provider-neutral immutable Snapshot with deterministic hashes plus explicit missing, blocking conflicts, warnings, omitted records, and field-level provenance. `storyboard-default-v1` and `video-default-v1` use structure-aware budgets; candidate links, Inferences, RAG, and Provider calls stay outside this deterministic slice. The Scripts inspector can rebuild or reopen snapshots without changing an older snapshot already referenced by downstream work.

## Phase 5A Storyboard and ShotSpec

An author can turn one loaded Context Snapshot into an ordered Storyboard of structured ShotSpecs. Shot subjects, location, and props are validated against the Snapshot rather than guessed from names. Storyboard content is immutable: revision creates a replacement and preserves the old board, while approval is a versioned CAS lifecycle command. Provider compilation and generation remain separate follow-up units.

## Current limits and next route

This MVP is single-user and local-first. It has no accounts, collaboration, remote database adapter, background job queue, rich text editor, media generation, or provider-specific model management. AI output still needs author review, and a configured Responses-compatible provider is required for live AI assistance. Planned follow-up work can add authentication and shared projects, remote storage, richer export formats, media attachments, provider health controls, and collaborative review without changing the browser mutation boundaries.

The target AI-native Story Bible architecture, phased delivery plan, invariants, and acceptance scenarios are maintained in [docs/story-bible-engineering/README.md](docs/story-bible-engineering/README.md). It is an evolution specification; the MVP documents above remain the source of truth for currently shipped behavior.
