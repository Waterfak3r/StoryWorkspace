"use client";

import * as React from "react";
import { Copy, MagicWand, X } from "@phosphor-icons/react";
import type { AiAction, AiContext, AiGenerateResponse } from "@/domain/ai";
import type { BibleEntry, Chapter, OutlineNode } from "@/domain/narrative";
import { WorkspaceApiError } from "./workspace-api";
import { useI18n } from "@/features/i18n/LocaleProvider";

export type AiAssistantStatus = "idle" | "generating" | "error" | "accepting" | "accepted";
export type AiAcceptMode = "insert" | "replace";

type AiAssistantProps = {
  action: AiAction;
  instruction: string;
  context: AiContext;
  bibleEntries: BibleEntry[];
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
  result: AiGenerateResponse | null;
  status: AiAssistantStatus;
  error: WorkspaceApiError | null;
  selectedProseIncluded: boolean;
  replaceSelectionEnabled: boolean;
  onActionChange: (action: AiAction) => void;
  onInstructionChange: (instruction: string) => void;
  onContextToggle: (group: keyof AiContext, id: string, checked: boolean) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onInsert: () => void;
  onReplace: () => void;
  onCopy: () => void;
  onDismiss: () => void;
  onSaveAdaptation?: () => void;
  adaptationSavePending?: boolean;
  adaptationSaved?: boolean;
  onClose?: () => void;
  closeDisabled?: boolean;
};

const actionLabels: Record<AiAction, { label: string; help: string }> = {
  brainstorm: { label: "Brainstorm", help: "Generate several concrete directions." },
  continue: { label: "Continue", help: "Carry the selected material forward." },
  rewrite: { label: "Rewrite", help: "Revise selected prose to fit the instruction." },
  summarize: { label: "Summarize", help: "Condense selected story material." },
  consistency: { label: "Consistency check", help: "Spot continuity risks and grounded fixes." },
  adapt: { label: "Adapt", help: "Shape the material into another structured format." },
};

function countReferences(context: AiContext) {
  return context.bibleEntryIds.length + context.outlineNodeIds.length + context.chapterIds.length;
}

function selectionText(context: AiContext, group: keyof AiContext) {
  return context[group];
}

function ContextGroup({
  label,
  group,
  options,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  group: keyof AiContext;
  options: Array<{ id: string; label: string; detail: string }>;
  selected: string[];
  disabled: boolean;
  onToggle: (group: keyof AiContext, id: string, checked: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="border-t border-line pt-4">
      <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t(label)}</legend>
      {options.length === 0 ? <p className="mt-2 text-xs leading-5 text-ink-faint">{t("No {label} records available.", { label: t(label).toLowerCase() })}</p> : null}
      <div className="mt-2 space-y-1">
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label key={option.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm hover:bg-surface-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onToggle(group, option.id, event.target.checked)} className="h-4 w-4 accent-accent" />
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{option.label}</span>
                <span className="block truncate text-xs text-ink-faint">{option.detail}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AiAssistant({
  action,
  instruction,
  context,
  bibleEntries,
  outlineNodes,
  chapters,
  result,
  status,
  error,
  selectedProseIncluded,
  replaceSelectionEnabled,
  onActionChange,
  onInstructionChange,
  onContextToggle,
  onGenerate,
  onCancel,
  onInsert,
  onReplace,
  onCopy,
  onDismiss,
  onSaveAdaptation,
  adaptationSavePending = false,
  adaptationSaved = false,
  onClose,
  closeDisabled = false,
}: AiAssistantProps) {
  const { t } = useI18n();
  const idPrefix = React.useId().replaceAll(":", "");
  const actionId = `${idPrefix}-ai-action`;
  const instructionId = `${idPrefix}-ai-instruction`;
  const resultHeadingId = `${idPrefix}-ai-result-heading`;
  const busy = status === "generating" || status === "accepting" || adaptationSavePending;
  const accepted = status === "accepted" || (result !== null && result.generation.acceptedVersionId !== null);
  const adaptResult = result?.generation.action === "adapt";
  const generationConsumed = error?.code === "AI_GENERATION_ALREADY_CONSUMED" && error.consumedBy !== null;
  const actionHelp = actionLabels[action];
  const selectedCount = countReferences(context);

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy={busy}>
      <header className="border-b border-line px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint"><MagicWand size={16} weight="regular" aria-hidden="true" /> {t("AI assist")}</div>
            <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-ink">{t("Reviewable draft")}</h2>
          </div>
          {onClose ? <button type="button" onClick={onClose} disabled={closeDisabled} aria-label={t("Close AI assist")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"><X size={18} weight="regular" aria-hidden="true" /></button> : null}
        </div>
        <p className="mt-2 text-sm leading-5 text-ink-muted">{t("Choose context, generate a draft, then decide what belongs in the chapter.")}</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div>
          <label htmlFor={actionId} className="text-sm font-semibold text-ink">{t("Action")}</label>
          <select id={actionId} value={action} onChange={(event) => onActionChange(event.target.value as AiAction)} disabled={busy} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink focus:border-accent">
            {Object.entries(actionLabels).map(([value, option]) => <option key={value} value={value}>{t(option.label)}</option>)}
          </select>
          <p className="mt-2 text-xs leading-5 text-ink-faint">{t(actionHelp.help)}</p>
        </div>

        <div className="mt-5">
          <label htmlFor={instructionId} className="text-sm font-semibold text-ink">{t("Instruction")}</label>
          <textarea id={instructionId} value={instruction} onChange={(event) => onInstructionChange(event.target.value)} disabled={busy} rows={4} maxLength={4000} placeholder={t("What should the assistant help you explore?")} className="mt-2 w-full resize-y rounded-lg border border-line bg-surface-raised px-3 py-3 text-sm leading-6 text-ink focus:border-accent" />
          <p className="mt-2 text-xs text-ink-faint">{t("{count}/4000 characters", { count: instruction.length })}</p>
        </div>

        <div className="mt-6 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">{t("Context")}</p>
            <span className="text-xs text-ink-faint">{t("{count} selected", { count: selectedCount })}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-ink-faint">{t("Only selected records are resolved on the server.")}</p>
          <div className="mt-4 space-y-5">
            <ContextGroup label="Story bible" group="bibleEntryIds" selected={selectionText(context, "bibleEntryIds")} disabled={busy} onToggle={onContextToggle} options={bibleEntries.map((entry) => ({ id: entry.id, label: entry.title, detail: entry.category }))} />
            <ContextGroup label="Outline" group="outlineNodeIds" selected={selectionText(context, "outlineNodeIds")} disabled={busy} onToggle={onContextToggle} options={outlineNodes.map((node) => ({ id: node.id, label: node.title, detail: node.kind }))} />
            <ContextGroup label="Chapters" group="chapterIds" selected={selectionText(context, "chapterIds")} disabled={busy} onToggle={onContextToggle} options={chapters.map((chapter) => ({ id: chapter.id, label: chapter.title, detail: chapter.status }))} />
          </div>
        </div>

        <div className="mt-6 border-y border-line py-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-ink">{t("Selected prose")}</span>
            <span className={selectedProseIncluded ? "text-accent-strong" : "text-ink-faint"}>{selectedProseIncluded ? t("Included") : t("None")}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-ink-faint">{t("Capture a passage in the editor before generating a rewrite.")}</p>
          {action === "rewrite" && !selectedProseIncluded ? <p role="status" className="mt-2 text-xs text-danger">{t("Select prose before using Rewrite.")}</p> : null}
        </div>

        {error ? <div role="alert" className="mt-5 border-l-2 border-danger pl-3 text-sm leading-6 text-danger">{error.message}</div> : null}
        {status === "generating" ? (
          <div className="mt-5 space-y-3" role="status" aria-live="polite" aria-label={t("Generating AI draft")}>
            <div className="h-3 w-28 animate-pulse rounded bg-surface-muted" />
            <div className="h-24 animate-pulse rounded-lg bg-surface-muted" />
            <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm font-semibold text-ink-muted hover:border-accent hover:text-accent">{t("Cancel generation")}</button>
          </div>
        ) : null}
        {status === "accepting" ? <p role="status" aria-live="polite" className="mt-5 border-l-2 border-accent pl-3 text-sm text-ink-muted">{t("Accepting this reviewed draft.")}</p> : null}
        {status === "accepted" ? <p role="status" aria-live="polite" className="mt-5 border-l-2 border-success pl-3 text-sm text-success">{t("AI draft accepted into the chapter history.")}</p> : null}
        {adaptationSaved ? <p role="status" aria-live="polite" className="mt-5 border-l-2 border-success pl-3 text-sm text-success">{t("AI draft saved as an adaptation.")}</p> : null}

        {status !== "generating" ? (
          <button type="button" onClick={onGenerate} disabled={busy || instruction.trim().length === 0 || (action === "rewrite" && !selectedProseIncluded)} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60">{status === "error" ? t("Try generation again") : t("Generate draft")}</button>
        ) : null}

        {result ? (
          <section aria-labelledby={resultHeadingId} className="mt-7 border-t border-line pt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id={resultHeadingId} className="text-sm font-semibold text-ink">{t("Draft result")}</h3>
                <p className="mt-1 text-xs text-ink-faint">{t(actionLabels[result.generation.action].label)} · {t("{count} references", { count: result.references.length })}</p>
              </div>
              <button type="button" onClick={onDismiss} disabled={busy} aria-label={t("Dismiss AI draft")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50"><X size={17} weight="regular" aria-hidden="true" /></button>
            </div>
            <pre className="mt-4 max-h-[38vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-raised p-4 text-sm leading-6 text-ink">{result.generation.generatedMarkdown}</pre>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={onInsert} disabled={busy || accepted || generationConsumed} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-3 text-sm font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:opacity-50">{t("Insert")}</button>
              <button type="button" onClick={onReplace} disabled={busy || accepted || generationConsumed || !replaceSelectionEnabled} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-3 text-sm font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">{t("Replace selection")}</button>
              <button type="button" onClick={onCopy} disabled={status === "generating" || status === "accepting"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:opacity-50 sm:col-span-2"><Copy size={16} weight="regular" aria-hidden="true" /> {t("Copy")}</button>
              {adaptResult && !accepted && onSaveAdaptation ? <button type="button" onClick={onSaveAdaptation} disabled={busy || generationConsumed || adaptationSavePending || adaptationSaved} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2">{adaptationSavePending ? t("Saving adaptation") : adaptationSaved ? t("Saved as adaptation") : t("Save as adaptation")}</button> : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
