# ADR 006: Reviewable AI drafts and trusted acceptance

## Status

Accepted for MVP Slice 3.

## Context

AI output must remain reviewable and must not overwrite manuscript text. When an author accepts AI text, chapter history must retain trustworthy action, instruction, and resolved context provenance without allowing the browser to invent that provenance.

## Request boundary

Generation is project-scoped and targets the active chapter. The request contains:

- one action: `brainstorm`, `continue`, `rewrite`, `summarize`, `consistency`, or `adapt`;
- an instruction;
- explicit bible-entry, outline-node, and chapter ID lists;
- optional selected prose copied from the editor at request time.

The server validates ownership for the target and every reference, rejects duplicate IDs and oversized input, resolves current stored content, and treats all story text as untrusted data. No browser-supplied context text or AI metadata is trusted.

The MVP request to `POST /api/ai/generate` is `{ projectId, targetChapterId, action, instruction, context: { bibleEntryIds, outlineNodeIds, chapterIds }, selectedProse? }`. Instruction is limited to 4,000 characters, selected prose to 20,000 characters, references to 50 total, resolved context to 80,000 characters, and generated Markdown to 30,000 characters. Empty instructions, duplicate references, cross-project references, and over-budget context are rejected without calling the provider. `rewrite` additionally requires selected prose.

Resolved references are ordered by group (`bible`, `outline`, `chapter`), then stored position and ID. The response summary for each reference contains only its ID, group, title, and subtype. Context selection starts empty in every mounted chapter workspace.

## Persistent generation record

A successful provider response creates an `ai_generations` record before it is returned. The record stores a UUID, project ID, target chapter ID, action, instruction, resolved reference IDs, generated Markdown, creation time, and optional accepted chapter-version ID. Provider failures create no record.

The response returns the generation ID, generated Markdown, action, and resolved reference summaries. It does not mutate the chapter.

Generation records are server evidence, not an autonomous workflow. A draft may be copied or dismissed without a manuscript mutation. One generation may be accepted into its target chapter at most once.

## Acceptance boundary

`POST /api/chapters/[chapterId]/ai-accept` receives a generation ID, the final full chapter body composed by the client, and `baseUpdatedAt`.

In one transaction the server:

1. verifies that the generation exists, is unaccepted, and targets the same project and chapter;
2. applies optimistic concurrency to update the chapter body;
3. inserts a chapter version containing the resulting full body with source `ai` and metadata copied only from the generation record;
4. links the generation to that version.

A stale base returns the same 409 chapter conflict used by autosave and changes nothing. Repeating an accepted generation returns a stable validation conflict and never creates duplicate history.

`POST /api/chapters/[chapterId]/ai-accept` accepts only `{ generationId, body, baseUpdatedAt }` and returns the canonical chapter plus its new AI chapter version. It never accepts action, instruction, or reference provenance from the browser. An already accepted generation returns `AI_GENERATION_ALREADY_ACCEPTED`; a generation belonging to another target is treated as not found.

The chapter editor first flushes ordinary local edits. `Insert` composes at the current caret. `Replace selection` is enabled only while the captured text and local edit sequence still match. Acceptance enters the autosave session as one serialized mutation, so a normal save cannot race it.

## Provider adapter

The provider module is server-only and receives a model, structured prompt messages or input, an abort signal, and bounded output size. Configuration comes only from `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`.

Missing configuration, timeout, authentication/rate/provider failure, cancellation, malformed upstream JSON, and empty output map to stable safe errors. Logs contain request IDs and sizes but no key, selected prose, full context, prompt, or output.

The adapter calls `${AI_BASE_URL}/responses` with the configured model, `store: false`, a 30-second timeout, and an explicit output token cap. It requests strict structured output through `text.format` with a single `{ markdown: string }` JSON Schema, then validates both the Responses payload and the decoded object. `AI_BASE_URL` defaults to `https://api.openai.com/v1`; key and model remain required. No provider SDK is needed for this server-only boundary.

Stable errors are `AI_NOT_CONFIGURED` (503, not retryable), `AI_TIMEOUT` (504, retryable), `AI_AUTHENTICATION_ERROR` (502, not retryable), `AI_RATE_LIMITED` (429, retryable), `AI_PROVIDER_ERROR` (502, retryable), and `AI_INVALID_RESPONSE` (502, retryable). A caller cancellation aborts the upstream request and creates no generation record.

## Prompt construction

One system policy defines the writing-assistant role, action contract, output-as-Markdown requirement, and instruction hierarchy. Resolved story material is placed in a labelled untrusted context block separated from the user instruction. Action modules add only the minimum output shape needed for that action.

Context order is deterministic by requested group then stored position. The server rejects context above the configured character budget rather than silently dropping references.

## UI review surface

The context rail is opt-in and starts with no references selected. It always shows action, instruction, selected reference count, and whether selected prose is included. Generation has cancel, timeout, missing-configuration, and retryable provider states.

The result is a draft panel with `Insert`, `Replace selection`, `Copy`, and `Dismiss`. No result is inserted automatically. While an acceptance is pending, its source draft remains visible.

Generate first flushes the active chapter so server-resolved chapter context is current. Selection coordinates, selected text, and the autosave edit sequence are captured with the request. `Replace selection` remains enabled only when all three still match. `Insert` composes against the latest saved body at the textarea caret. Either acceptance disables manuscript edits for the short mutation, submits the resulting complete body, and applies only the returned canonical chapter. A stale acceptance enters the existing two-version conflict review and preserves the AI draft for retry.

The assistant is a 340-360px right rail on wide screens and a focus-trapped drawer below that breakpoint. Generation may be cancelled or abandoned during navigation because it has no manuscript side effect; an acceptance participates in the chapter leave guard until its canonical result is applied.

## Tests

Cover request limits, cross-project rejection, deterministic context assembly, prompt-injection delimiters, timeout/error mapping, abort, malformed responses, generation persistence, forged provenance rejection, atomic accept, duplicate accept, stale accept rollback, and exact AI chapter-version provenance.
