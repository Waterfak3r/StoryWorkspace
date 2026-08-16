"use client";

import * as React from "react";
import { BookOpenText, Check, FloppyDisk, Plus, Trash } from "@phosphor-icons/react";
import type { BibleCategory, BibleEntry } from "@/domain/narrative";
import { WorkspaceApiError, createBibleEntry, deleteBibleEntry, updateBibleEntry } from "./workspace-api";
import { initializeSelectionDraft } from "./workspace-selection";
import { useI18n } from "@/features/i18n/LocaleProvider";

type BibleDraft = {
  title: string;
  category: BibleCategory;
  body: string;
};

type StoryBibleWorkspaceProps = {
  projectId: string;
  entries: BibleEntry[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onEntryCreated: (entry: BibleEntry) => void;
  onEntryReplaced: (entry: BibleEntry) => void;
  onEntryDeleted: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onConfirmDiscard?: () => boolean;
};

const categories: Array<{ value: BibleCategory; label: string; detail: string }> = [
  { value: "world", label: "World", detail: "Places, history, and conditions" },
  { value: "character", label: "Character", detail: "People, wants, and pressure" },
  { value: "location", label: "Location", detail: "Specific settings and texture" },
  { value: "rule", label: "Rule", detail: "Limits, customs, and systems" },
  { value: "theme", label: "Theme", detail: "Ideas the story keeps testing" },
];

function draftFor(entry: BibleEntry | undefined): BibleDraft {
  return entry
    ? { title: entry.title, category: entry.category, body: entry.body }
    : { title: "", category: "world", body: "" };
}

function firstError(error: WorkspaceApiError | null, field: string) {
  return error?.fieldErrors[field]?.[0] ?? null;
}

export function StoryBibleWorkspace({
  projectId,
  entries,
  selectedId,
  onSelect,
  onEntryCreated,
  onEntryReplaced,
  onEntryDeleted,
  onDirtyChange,
  onConfirmDiscard,
}: StoryBibleWorkspaceProps) {
  const { t } = useI18n();
  const selectedEntry = entries.find((entry) => entry.id === selectedId);
  const [draft, setDraft] = React.useState<BibleDraft>(() => initializeSelectionDraft(selectedId, entries, (entry) => entry.id, draftFor).draft);
  const [dirty, setDirty] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<WorkspaceApiError | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function confirmSwitch() {
    if (!dirty) {
      return true;
    }
    if (onConfirmDiscard) {
      return onConfirmDiscard();
    }
    if (typeof window === "undefined") {
      return true;
    }
    return window.confirm(t("Discard unsaved changes to this entry?"));
  }

  function selectEntry(id: string | null) {
    if (!confirmSwitch()) {
      return;
    }
    onSelect(id);
  }

  function updateDraft(field: keyof BibleDraft, value: string) {
    if (pending) {
      return;
    }
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    onDirtyChange?.(true);
    setNotice(null);
    setError(null);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const entry = selectedEntry
        ? await updateBibleEntry(selectedEntry.id, draft)
        : await createBibleEntry(projectId, draft);
      if (selectedEntry) {
        onEntryReplaced(entry);
      } else {
        onEntryCreated(entry);
      }
      setDraft(draftFor(entry));
      setDirty(false);
      onDirtyChange?.(false);
      setNotice(t("Entry saved."));
    } catch (caught) {
      setError(caught instanceof WorkspaceApiError ? caught : new WorkspaceApiError(0, { code: "INTERNAL_ERROR", message: t("The entry could not be saved. Try again."), retryable: true }));
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!selectedEntry || pending) {
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(t("Delete {title}?", { title: selectedEntry.title }))) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await deleteBibleEntry(selectedEntry.id);
      onEntryDeleted(selectedEntry.id);
      setDirty(false);
      onDirtyChange?.(false);
      setNotice(t("Entry deleted."));
    } catch (caught) {
      setError(caught instanceof WorkspaceApiError ? caught : new WorkspaceApiError(0, { code: "INTERNAL_ERROR", message: t("The entry could not be deleted. Try again."), retryable: true }));
    } finally {
      setPending(false);
    }
  }

  const titleError = firstError(error, "title");
  const categoryError = firstError(error, "category");
  const bodyError = firstError(error, "body");

  return (
    <section aria-labelledby="story-bible-heading" className="min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-ink-faint"><BookOpenText size={18} weight="regular" aria-hidden="true" /> {t("Story bible")}</div>
          <h2 id="story-bible-heading" className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{t("Keep the story consistent.")}</h2>
          <p className="mt-3 max-w-[60ch] text-sm leading-6 text-ink-muted">{t("Collect the details you want close while the manuscript changes.")}</p>
        </div>
        <button type="button" onClick={() => selectEntry(null)} disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-4 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50">
          <Plus size={17} weight="regular" aria-hidden="true" /> {t("New entry")}
        </button>
      </header>

      {entries.length === 0 ? (
        <div className="mt-7 border-l-2 border-accent pl-4" aria-label={t("Story bible empty state")}>
          <p className="text-sm font-semibold text-ink">{t("Start with one useful truth.")}</p>
          <p className="mt-2 max-w-[58ch] text-sm leading-6 text-ink-muted">{t("Try a person who wants something, a place with a cost, or a rule the story cannot ignore. Nothing is added until you save it.")}</p>
        </div>
      ) : null}

      <form onSubmit={handleSave} className="mt-8 max-w-[780px] space-y-6">
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            <label htmlFor="bible-title" className="block text-sm font-semibold text-ink">{t("Title")}</label>
            <input id="bible-title" name="title" value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} disabled={pending} aria-invalid={Boolean(titleError)} aria-describedby={titleError ? "bible-title-error" : undefined} className="min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink shadow-sm outline-none transition-colors placeholder:text-ink-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" placeholder={t("A clear name")} />
            {titleError ? <p id="bible-title-error" className="text-xs text-danger">{titleError}</p> : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="bible-category" className="block text-sm font-semibold text-ink">{t("Category")}</label>
            <select id="bible-category" name="category" value={draft.category} onChange={(event) => updateDraft("category", event.target.value as BibleCategory)} disabled={pending} aria-invalid={Boolean(categoryError)} aria-describedby={categoryError ? "bible-category-error" : undefined} className="min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink shadow-sm outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60">
              {categories.map((category) => <option key={category.value} value={category.value}>{t(category.label)}</option>)}
            </select>
            {categoryError ? <p id="bible-category-error" className="text-xs text-danger">{categoryError}</p> : null}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="bible-body" className="block text-sm font-semibold text-ink">{t("Markdown body")}</label>
          <p id="bible-body-help" className="text-xs leading-5 text-ink-faint">{t("Use short notes, lists, or links to keep this entry easy to scan.")}</p>
          <textarea id="bible-body" name="body" value={draft.body} onChange={(event) => updateDraft("body", event.target.value)} disabled={pending} aria-invalid={Boolean(bodyError)} aria-describedby={`bible-body-help${bodyError ? " bible-body-error" : ""}`} rows={12} className="min-h-52 w-full resize-y rounded-lg border border-line bg-surface-raised px-3 py-3 font-mono text-sm leading-6 text-ink shadow-sm outline-none transition-colors placeholder:text-ink-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" placeholder={t("Write the detail as Markdown")} />
          {bodyError ? <p id="bible-body-error" className="text-xs text-danger">{bodyError}</p> : null}
        </div>

        <div aria-live="assertive" aria-atomic="true" className="min-h-6">
          {error ? <p role="alert" className="text-sm text-danger">{error.message}</p> : null}
        </div>
        <div aria-live="polite" aria-atomic="true" className="min-h-6">
          {!error && notice ? <p className="inline-flex items-center gap-2 text-sm text-success"><Check size={16} weight="bold" aria-hidden="true" /> {notice}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong active:translate-y-px disabled:opacity-60">
            <FloppyDisk size={17} weight="regular" aria-hidden="true" /> {pending ? t("Saving") : t("Save entry")}
          </button>
          {selectedEntry ? <button type="button" onClick={handleDelete} disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-danger/40 px-4 text-sm font-semibold text-danger transition-colors hover:bg-accent-soft active:translate-y-px disabled:opacity-60"><Trash size={17} weight="regular" aria-hidden="true" /> {t("Delete entry")}</button> : null}
          {dirty ? <span className="text-xs text-ink-faint">{t("Unsaved changes")}</span> : null}
        </div>
      </form>
    </section>
  );
}
