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

## Workspace layout

- Left rail: project identity, story bible, outline, chapters, adaptations.
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
- `src/features`: project, bible, outline, chapter, AI, adaptation, and export UI.

Feature UI must call route handlers, not repositories. Repositories must not import React or HTTP types. Prompts must not import database primitives.

## Delivery slices

1. Project library plus persistent project creation.
2. Workspace shell plus story bible, outline, and chapter CRUD.
3. Chapter autosave, snapshots, context selection, and AI adapter.
4. Structured adaptation, Markdown export, responsive states, and documentation.
5. Automated critical-path verification, accessibility pass, and release cleanup.

## Quality gates

Every slice must pass formatting, lint, typecheck, relevant tests, and a production build. The final MVP additionally requires a fresh-install run, persistence verification after a production build and restart, Playwright critical-path smoke coverage, AI failure-path verification, keyboard navigation, responsive checks, and a complete README.
