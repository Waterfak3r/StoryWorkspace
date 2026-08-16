"use client";

import Link from "next/link";
import { ArrowLeft, BookOpenText, CaretRight, FileText, FilmScript, Notebook, Plus, Trash, TreeStructure } from "@phosphor-icons/react";
import type { Chapter, BibleEntry, OutlineNode } from "@/domain/narrative";
import type { Adaptation } from "@/domain/adaptation";
import type { Project } from "@/domain/project";
import type { ScriptDocument } from "@/domain/document";
import { projectOutlineTree } from "./outline-tree";
import { useI18n } from "@/features/i18n/LocaleProvider";

export type WorkspaceSection = "bible" | "outline" | "chapters" | "adaptations" | "scripts";

type WorkspaceNavigatorProps = {
  project: Project;
  activeSection: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
  bibleEntries: BibleEntry[];
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
  adaptations: Adaptation[];
  scriptDocuments: ScriptDocument[];
  selectedBibleId: string | null;
  selectedOutlineId: string | null;
  selectedChapterId: string | null;
  selectedAdaptationId: string | null;
  selectedScriptDocumentId: string | null;
  onBibleSelect: (id: string) => void;
  onOutlineSelect: (id: string) => void;
  onChapterSelect: (id: string) => void;
  onChapterCreate: () => void;
  onChapterDelete: (id: string) => void;
  onAdaptationSelect: (id: string) => void;
  onAdaptationCreate: () => void;
  onAdaptationDelete: (id: string) => void;
  onScriptDocumentSelect: (id: string) => void;
  onScriptDocumentCreate: () => void;
  onScriptDocumentRetry?: () => void;
  chapterMutationPending?: boolean;
  chapterError?: string | null;
  adaptationMutationPending?: boolean;
  adaptationError?: string | null;
  scriptDocumentLoading?: boolean;
  scriptDocumentError?: string | null;
  scriptMutationPending?: boolean;
  navigationPending?: boolean;
  onLibraryNavigate?: () => void;
};

const sectionItems: Array<{ id: WorkspaceSection; label: string; detail: string; countKey: "bible" | "outline" | "chapters" | "adaptations" | "scripts"; Icon: typeof BookOpenText }> = [
  { id: "bible", label: "Story bible", detail: "World, people, and rules", countKey: "bible", Icon: BookOpenText },
  { id: "outline", label: "Outline", detail: "Shape the story structure", countKey: "outline", Icon: TreeStructure },
  { id: "chapters", label: "Chapters", detail: "Write the manuscript", countKey: "chapters", Icon: Notebook },
  { id: "adaptations", label: "Adaptations", detail: "Prepare another format", countKey: "adaptations", Icon: FilmScript },
  { id: "scripts", label: "Scripts", detail: "Edit stable scenes", countKey: "scripts", Icon: FileText },
];

const bibleCategoryLabels: Record<BibleEntry["category"], string> = {
  world: "World",
  character: "Character",
  location: "Location",
  rule: "Rule",
  theme: "Theme",
};

function countFor(item: Pick<WorkspaceNavigatorProps, "bibleEntries" | "outlineNodes" | "chapters" | "adaptations" | "scriptDocuments">, key: (typeof sectionItems)[number]["countKey"]) {
  if (key === "bible") return item.bibleEntries.length;
  if (key === "outline") return item.outlineNodes.length;
  if (key === "chapters") return item.chapters.length;
  if (key === "adaptations") return item.adaptations.length;
  return item.scriptDocuments.length;
}

export function WorkspaceNavigator({
  project,
  activeSection,
  onSectionChange,
  bibleEntries,
  outlineNodes,
  chapters,
  adaptations,
  scriptDocuments,
  selectedBibleId,
  selectedOutlineId,
  selectedChapterId,
  selectedAdaptationId,
  selectedScriptDocumentId,
  onBibleSelect,
  onOutlineSelect,
  onChapterSelect,
  onChapterCreate,
  onChapterDelete,
  onAdaptationSelect,
  onAdaptationCreate,
  onAdaptationDelete,
  onScriptDocumentSelect,
  onScriptDocumentCreate,
  onScriptDocumentRetry,
  chapterMutationPending = false,
  chapterError = null,
  adaptationMutationPending = false,
  adaptationError = null,
  scriptDocumentLoading = false,
  scriptDocumentError = null,
  scriptMutationPending = false,
  navigationPending = false,
  onLibraryNavigate,
}: WorkspaceNavigatorProps) {
  const { t } = useI18n();
  const tree = projectOutlineTree(outlineNodes);

  return (
    <aside className="flex min-h-0 w-full flex-col bg-surface lg:w-[260px] lg:border-r lg:border-line">
      <div className="border-b border-line px-5 py-5">
        <Link href="/" aria-disabled={navigationPending || chapterMutationPending || adaptationMutationPending || scriptMutationPending} onNavigate={(event) => { if (onLibraryNavigate) { event.preventDefault(); onLibraryNavigate(); } }} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink ${navigationPending || chapterMutationPending || adaptationMutationPending || scriptMutationPending ? "cursor-wait opacity-60" : ""}`}>
          <ArrowLeft size={18} weight="regular" aria-hidden="true" />
          {t("Project library")}
        </Link>
        <div className="mt-5 min-w-0">
          <p className="truncate text-base font-semibold tracking-[-0.02em] text-ink">{project.title}</p>
          <p className="mt-1 text-xs text-ink-faint">{t("Writing workspace")}</p>
        </div>
      </div>

      <nav aria-label={t("Workspace sections")} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {sectionItems.map(({ id, label, detail, countKey, Icon }) => {
            const active = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSectionChange(id)}
                disabled={navigationPending || chapterMutationPending || adaptationMutationPending || scriptMutationPending}
                aria-pressed={active}
                className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors active:translate-y-px ${active ? "bg-accent-soft text-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`}
              >
                <Icon size={19} weight={active ? "bold" : "regular"} className={active ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{t(label)}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">{t(detail)}</span>
                </span>
                 <span className="font-mono text-[11px] text-ink-faint">{countFor({ bibleEntries, outlineNodes, chapters, adaptations, scriptDocuments }, countKey)}</span>
              </button>
            );
          })}
        </div>

        {activeSection === "bible" ? (
          <div className="mt-7">
            <div className="flex items-center justify-between px-3">
              <p className="text-xs font-semibold text-ink">{t("Entries")}</p>
              <span className="text-xs text-ink-faint">{bibleEntries.length}</span>
            </div>
            {bibleEntries.length > 0 ? (
              <div className="mt-2 space-y-1">
                {bibleEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onBibleSelect(entry.id)}
                    aria-pressed={selectedBibleId === entry.id}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors active:translate-y-px ${selectedBibleId === entry.id ? "bg-surface-raised font-semibold text-ink shadow-sm" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`}
                  >
                    <CaretRight size={14} weight="regular" className={selectedBibleId === entry.id ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                    <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">{t(bibleCategoryLabels[entry.category])}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 px-3 text-xs leading-5 text-ink-faint">{t("Your first entry can hold a person, place, or rule.")}</p>
            )}
          </div>
        ) : null}

        {activeSection === "outline" ? (
          <div className="mt-7">
            <div className="flex items-center justify-between px-3">
              <p className="text-xs font-semibold text-ink">{t("Nodes")}</p>
              <span className="text-xs text-ink-faint">{outlineNodes.length}</span>
            </div>
            {tree.length > 0 ? (
              <div className="mt-2 space-y-1">
                {tree.map((item) => (
                  <NavigatorOutlineNode key={item.node.id} item={item} selectedId={selectedOutlineId} onSelect={onOutlineSelect} />
                ))}
              </div>
            ) : (
              <p className="mt-3 px-3 text-xs leading-5 text-ink-faint">{t("Start with a story, act, chapter, or scene.")}</p>
            )}
          </div>
        ) : null}

        {activeSection === "chapters" ? (
          <ChapterNavigatorList
            chapters={chapters}
            selectedChapterId={selectedChapterId}
            onSelect={onChapterSelect}
            onCreate={onChapterCreate}
            onDelete={onChapterDelete}
            mutationPending={chapterMutationPending}
            navigationPending={navigationPending}
            error={chapterError}
          />
        ) : null}

        {activeSection === "adaptations" ? (
          <AdaptationNavigatorList
            adaptations={adaptations}
            selectedAdaptationId={selectedAdaptationId}
            onSelect={onAdaptationSelect}
            onCreate={onAdaptationCreate}
            onDelete={onAdaptationDelete}
            mutationPending={adaptationMutationPending}
            navigationPending={navigationPending}
            error={adaptationError}
          />
        ) : null}

        {activeSection === "scripts" ? (
          <ScriptDocumentNavigatorList
            documents={scriptDocuments}
            selectedDocumentId={selectedScriptDocumentId}
            onSelect={onScriptDocumentSelect}
            onCreate={onScriptDocumentCreate}
            onRetry={onScriptDocumentRetry}
            navigationPending={navigationPending}
            scriptMutationPending={scriptMutationPending}
            loading={scriptDocumentLoading}
            error={scriptDocumentError}
          />
        ) : null}
      </nav>
    </aside>
  );
}

function ScriptDocumentNavigatorList({
  documents,
  selectedDocumentId,
  onSelect,
  onCreate,
  onRetry,
  navigationPending,
  scriptMutationPending,
  loading,
  error,
}: {
  documents: ScriptDocument[];
  selectedDocumentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRetry?: () => void;
  navigationPending: boolean;
  scriptMutationPending: boolean;
  loading: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-7">
      <div className="flex items-center justify-between gap-3 px-3">
        <div>
          <p className="text-xs font-semibold text-ink">{t("Scripts")}</p>
          <p className="mt-1 text-xs text-ink-faint">{t("Edit stable scenes")}</p>
        </div>
        <button type="button" onClick={onCreate} disabled={navigationPending || scriptMutationPending || loading} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50" aria-label={t("New script document")}>
          <Plus size={17} weight="regular" aria-hidden="true" />
        </button>
      </div>
      {loading ? <p className="mt-3 px-3 text-xs text-ink-faint">{t("Loading script documents.")}</p> : null}
      {error ? <div className="mt-3 px-3"><p role="alert" className="border-l-2 border-danger pl-3 text-xs leading-5 text-danger">{error}</p>{onRetry ? <button type="button" onClick={onRetry} disabled={loading || navigationPending} className="mt-3 min-h-10 rounded-md border border-line px-3 text-xs font-semibold text-ink-muted hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">{t("Retry list")}</button> : null}</div> : null}
      {!loading && documents.length === 0 ? <p className="mt-4 border-l-2 border-line px-3 text-xs leading-5 text-ink-faint">{t("No script documents yet. Create the first one.")}</p> : null}
      {documents.length > 0 ? (
        <ul aria-label={t("Script documents")} className="mt-3 space-y-1">
          {documents.map((document) => {
            const selected = selectedDocumentId === document.id;
            return (
              <li key={document.id} className={`min-w-0 rounded-lg ${selected ? "bg-surface-raised shadow-sm" : "hover:bg-surface-muted"}`}>
                <button type="button" onClick={() => onSelect(document.id)} disabled={navigationPending || scriptMutationPending} aria-pressed={selected} className={`flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"}`}>
                  <CaretRight size={14} weight="regular" className={selected ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-words">{document.title || t("Untitled script")}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-ink-faint">{document.kind}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function AdaptationNavigatorList({
  adaptations,
  selectedAdaptationId,
  onSelect,
  onCreate,
  onDelete,
  mutationPending,
  navigationPending,
  error,
}: {
  adaptations: Adaptation[];
  selectedAdaptationId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  mutationPending: boolean;
  navigationPending: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-7">
      <div className="flex items-center justify-between gap-3 px-3">
        <div>
          <p className="text-xs font-semibold text-ink">{t("Adaptations")}</p>
          <p className="mt-1 text-xs text-ink-faint">{t("Prepare another format")}</p>
        </div>
        <button type="button" onClick={onCreate} disabled={mutationPending || navigationPending} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50" aria-label={t("New adaptation")}>
          <Plus size={17} weight="regular" aria-hidden="true" />
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 border-l-2 border-danger px-3 text-xs leading-5 text-danger">{error}</p> : null}
      {mutationPending ? <p role="status" aria-live="polite" className="mt-3 px-3 text-xs text-ink-faint">{t("Saving adaptation change.")}</p> : null}
      {adaptations.length === 0 ? (
        <p className="mt-4 border-l-2 border-line px-3 text-xs leading-5 text-ink-faint">{t("No adaptations yet. Create a screenplay scene.")}</p>
      ) : (
        <div className="mt-3 space-y-1">
          {adaptations.map((adaptation) => {
            const selected = selectedAdaptationId === adaptation.id;
            return (
              <div key={adaptation.id} className={`flex min-w-0 items-stretch rounded-lg ${selected ? "bg-surface-raised shadow-sm" : "hover:bg-surface-muted"}`}>
                <button type="button" onClick={() => onSelect(adaptation.id)} disabled={navigationPending || mutationPending} aria-pressed={selected} className={`flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-l-lg px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"}`}>
                  <CaretRight size={14} weight="regular" className={selected ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{adaptation.title || t("Untitled adaptation")}</span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">{t("Scene")}</span>
                </button>
                <button type="button" onClick={() => onDelete(adaptation.id)} disabled={navigationPending || mutationPending} aria-label={t("Delete {title}", { title: adaptation.title || t("Untitled adaptation") })} className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-r-lg text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50">
                  <Trash size={16} weight="regular" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChapterNavigatorList({
  chapters,
  selectedChapterId,
  onSelect,
  onCreate,
  onDelete,
  mutationPending,
  navigationPending,
  error,
}: {
  chapters: Chapter[];
  selectedChapterId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  mutationPending: boolean;
  navigationPending: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-7">
      <div className="flex items-center justify-between gap-3 px-3">
        <div>
          <p className="text-xs font-semibold text-ink">{t("Chapters")}</p>
          <p className="mt-1 text-xs text-ink-faint">{t("Write the manuscript")}</p>
        </div>
        <button type="button" onClick={onCreate} disabled={mutationPending || navigationPending} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50" aria-label={t("New chapter")}>
          <Plus size={17} weight="regular" aria-hidden="true" />
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 border-l-2 border-danger px-3 text-xs leading-5 text-danger">{error}</p> : null}
      {mutationPending ? <p role="status" aria-live="polite" className="mt-3 px-3 text-xs text-ink-faint">{t("Saving chapter change.")}</p> : null}
      {chapters.length === 0 ? (
        <p className="mt-4 border-l-2 border-line px-3 text-xs leading-5 text-ink-faint">{t("No chapters yet. Create the first page.")}</p>
      ) : (
        <div className="mt-3 space-y-1">
          {chapters.map((chapter) => {
            const selected = selectedChapterId === chapter.id;
            return (
              <div key={chapter.id} className={`flex min-w-0 items-stretch rounded-lg ${selected ? "bg-surface-raised shadow-sm" : "hover:bg-surface-muted"}`}>
                <button type="button" onClick={() => onSelect(chapter.id)} disabled={navigationPending || mutationPending} aria-pressed={selected} className={`flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-l-lg px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"}`}>
                  <CaretRight size={14} weight="regular" className={selected ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{chapter.title || t("Untitled chapter")}</span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">{chapter.status}</span>
                </button>
                <button type="button" onClick={() => onDelete(chapter.id)} disabled={navigationPending || mutationPending} aria-label={t("Delete {title}", { title: chapter.title || t("Untitled chapter") })} className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-r-lg text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50">
                  <Trash size={16} weight="regular" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavigatorOutlineNode({ item, selectedId, onSelect }: { item: ReturnType<typeof projectOutlineTree>[number]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(item.node.id)}
        aria-pressed={selectedId === item.node.id}
        className={`flex min-h-11 w-full items-center gap-2 rounded-lg pr-2 text-left text-sm transition-colors active:translate-y-px ${selectedId === item.node.id ? "bg-surface-raised font-semibold text-ink shadow-sm" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`}
        style={{ paddingLeft: `${12 + item.depth * 14}px` }}
      >
        <CaretRight size={14} weight="regular" className={selectedId === item.node.id ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.node.title}</span>
        <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">{item.node.kind}</span>
      </button>
      {item.children.map((child) => <NavigatorOutlineNode key={child.node.id} item={child} selectedId={selectedId} onSelect={onSelect} />)}
    </div>
  );
}
