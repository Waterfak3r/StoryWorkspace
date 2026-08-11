"use client";

import Link from "next/link";
import { ArrowLeft, BookOpenText, CaretRight, FilmScript, Notebook, Plus, Trash, TreeStructure } from "@phosphor-icons/react";
import type { Chapter, BibleEntry, OutlineNode } from "@/domain/narrative";
import type { Adaptation } from "@/domain/adaptation";
import type { Project } from "@/domain/project";
import { projectOutlineTree } from "./outline-tree";

export type WorkspaceSection = "bible" | "outline" | "chapters" | "adaptations";

type WorkspaceNavigatorProps = {
  project: Project;
  activeSection: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
  bibleEntries: BibleEntry[];
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
  adaptations: Adaptation[];
  selectedBibleId: string | null;
  selectedOutlineId: string | null;
  selectedChapterId: string | null;
  selectedAdaptationId: string | null;
  onBibleSelect: (id: string) => void;
  onOutlineSelect: (id: string) => void;
  onChapterSelect: (id: string) => void;
  onChapterCreate: () => void;
  onChapterDelete: (id: string) => void;
  onAdaptationSelect: (id: string) => void;
  onAdaptationCreate: () => void;
  onAdaptationDelete: (id: string) => void;
  chapterMutationPending?: boolean;
  chapterError?: string | null;
  adaptationMutationPending?: boolean;
  adaptationError?: string | null;
  navigationPending?: boolean;
  onLibraryNavigate?: () => void;
};

const sectionItems: Array<{ id: WorkspaceSection; label: string; detail: string; countKey: "bible" | "outline" | "chapters" | "adaptations"; Icon: typeof BookOpenText }> = [
  { id: "bible", label: "Story bible", detail: "World, people, and rules", countKey: "bible", Icon: BookOpenText },
  { id: "outline", label: "Outline", detail: "Shape the story structure", countKey: "outline", Icon: TreeStructure },
  { id: "chapters", label: "Chapters", detail: "Write the manuscript", countKey: "chapters", Icon: Notebook },
  { id: "adaptations", label: "Adaptations", detail: "Prepare another format", countKey: "adaptations", Icon: FilmScript },
];

const bibleCategoryLabels: Record<BibleEntry["category"], string> = {
  world: "World",
  character: "Character",
  location: "Location",
  rule: "Rule",
  theme: "Theme",
};

function countFor(item: Pick<WorkspaceNavigatorProps, "bibleEntries" | "outlineNodes" | "chapters" | "adaptations">, key: (typeof sectionItems)[number]["countKey"]) {
  if (key === "bible") return item.bibleEntries.length;
  if (key === "outline") return item.outlineNodes.length;
  if (key === "chapters") return item.chapters.length;
  return item.adaptations.length;
}

export function WorkspaceNavigator({
  project,
  activeSection,
  onSectionChange,
  bibleEntries,
  outlineNodes,
  chapters,
  adaptations,
  selectedBibleId,
  selectedOutlineId,
  selectedChapterId,
  selectedAdaptationId,
  onBibleSelect,
  onOutlineSelect,
  onChapterSelect,
  onChapterCreate,
  onChapterDelete,
  onAdaptationSelect,
  onAdaptationCreate,
  onAdaptationDelete,
  chapterMutationPending = false,
  chapterError = null,
  adaptationMutationPending = false,
  adaptationError = null,
  navigationPending = false,
  onLibraryNavigate,
}: WorkspaceNavigatorProps) {
  const tree = projectOutlineTree(outlineNodes);

  return (
    <aside className="flex min-h-0 w-full flex-col bg-surface lg:w-[260px] lg:border-r lg:border-line">
      <div className="border-b border-line px-5 py-5">
        <Link href="/" aria-disabled={navigationPending || chapterMutationPending || adaptationMutationPending} onNavigate={(event) => { if (onLibraryNavigate) { event.preventDefault(); onLibraryNavigate(); } }} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink ${navigationPending || chapterMutationPending || adaptationMutationPending ? "cursor-wait opacity-60" : ""}`}>
          <ArrowLeft size={18} weight="regular" aria-hidden="true" />
          Project library
        </Link>
        <div className="mt-5 min-w-0">
          <p className="truncate text-base font-semibold tracking-[-0.02em] text-ink">{project.title}</p>
          <p className="mt-1 text-xs text-ink-faint">Writing workspace</p>
        </div>
      </div>

      <nav aria-label="Workspace sections" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {sectionItems.map(({ id, label, detail, countKey, Icon }) => {
            const active = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSectionChange(id)}
                disabled={navigationPending || chapterMutationPending || adaptationMutationPending}
                aria-pressed={active}
                className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors active:translate-y-px ${active ? "bg-accent-soft text-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`}
              >
                <Icon size={19} weight={active ? "bold" : "regular"} className={active ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-faint">{detail}</span>
                </span>
                <span className="font-mono text-[11px] text-ink-faint">{countFor({ bibleEntries, outlineNodes, chapters, adaptations }, countKey)}</span>
              </button>
            );
          })}
        </div>

        {activeSection === "bible" ? (
          <div className="mt-7">
            <div className="flex items-center justify-between px-3">
              <p className="text-xs font-semibold text-ink">Entries</p>
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
                    <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">{bibleCategoryLabels[entry.category]}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 px-3 text-xs leading-5 text-ink-faint">Your first entry can hold a person, place, or rule.</p>
            )}
          </div>
        ) : null}

        {activeSection === "outline" ? (
          <div className="mt-7">
            <div className="flex items-center justify-between px-3">
              <p className="text-xs font-semibold text-ink">Nodes</p>
              <span className="text-xs text-ink-faint">{outlineNodes.length}</span>
            </div>
            {tree.length > 0 ? (
              <div className="mt-2 space-y-1">
                {tree.map((item) => (
                  <NavigatorOutlineNode key={item.node.id} item={item} selectedId={selectedOutlineId} onSelect={onOutlineSelect} />
                ))}
              </div>
            ) : (
              <p className="mt-3 px-3 text-xs leading-5 text-ink-faint">Start with a story, act, chapter, or scene.</p>
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
      </nav>
    </aside>
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
  return (
    <div className="mt-7">
      <div className="flex items-center justify-between gap-3 px-3">
        <div>
          <p className="text-xs font-semibold text-ink">Adaptations</p>
          <p className="mt-1 text-xs text-ink-faint">Prepare another format</p>
        </div>
        <button type="button" onClick={onCreate} disabled={mutationPending || navigationPending} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50" aria-label="New adaptation">
          <Plus size={17} weight="regular" aria-hidden="true" />
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 border-l-2 border-danger px-3 text-xs leading-5 text-danger">{error}</p> : null}
      {mutationPending ? <p role="status" aria-live="polite" className="mt-3 px-3 text-xs text-ink-faint">Saving adaptation change.</p> : null}
      {adaptations.length === 0 ? (
        <p className="mt-4 border-l-2 border-line px-3 text-xs leading-5 text-ink-faint">No adaptations yet. Create a screenplay scene.</p>
      ) : (
        <div className="mt-3 space-y-1">
          {adaptations.map((adaptation) => {
            const selected = selectedAdaptationId === adaptation.id;
            return (
              <div key={adaptation.id} className={`flex min-w-0 items-stretch rounded-lg ${selected ? "bg-surface-raised shadow-sm" : "hover:bg-surface-muted"}`}>
                <button type="button" onClick={() => onSelect(adaptation.id)} disabled={navigationPending || mutationPending} aria-pressed={selected} className={`flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-l-lg px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"}`}>
                  <CaretRight size={14} weight="regular" className={selected ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{adaptation.title || "Untitled adaptation"}</span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">Scene</span>
                </button>
                <button type="button" onClick={() => onDelete(adaptation.id)} disabled={navigationPending || mutationPending} aria-label={`Delete ${adaptation.title || "Untitled adaptation"}`} className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-r-lg text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50">
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
  return (
    <div className="mt-7">
      <div className="flex items-center justify-between gap-3 px-3">
        <div>
          <p className="text-xs font-semibold text-ink">Chapters</p>
          <p className="mt-1 text-xs text-ink-faint">Write the manuscript</p>
        </div>
        <button type="button" onClick={onCreate} disabled={mutationPending || navigationPending} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50" aria-label="New chapter">
          <Plus size={17} weight="regular" aria-hidden="true" />
        </button>
      </div>
      {error ? <p role="alert" className="mt-3 border-l-2 border-danger px-3 text-xs leading-5 text-danger">{error}</p> : null}
      {mutationPending ? <p role="status" aria-live="polite" className="mt-3 px-3 text-xs text-ink-faint">Saving chapter change.</p> : null}
      {chapters.length === 0 ? (
        <p className="mt-4 border-l-2 border-line px-3 text-xs leading-5 text-ink-faint">No chapters yet. Create the first page.</p>
      ) : (
        <div className="mt-3 space-y-1">
          {chapters.map((chapter) => {
            const selected = selectedChapterId === chapter.id;
            return (
              <div key={chapter.id} className={`flex min-w-0 items-stretch rounded-lg ${selected ? "bg-surface-raised shadow-sm" : "hover:bg-surface-muted"}`}>
                <button type="button" onClick={() => onSelect(chapter.id)} disabled={navigationPending || mutationPending} aria-pressed={selected} className={`flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-l-lg px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "font-semibold text-ink" : "text-ink-muted hover:text-ink"}`}>
                  <CaretRight size={14} weight="regular" className={selected ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{chapter.title || "Untitled chapter"}</span>
                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-faint">{chapter.status}</span>
                </button>
                <button type="button" onClick={() => onDelete(chapter.id)} disabled={navigationPending || mutationPending} aria-label={`Delete ${chapter.title || "Untitled chapter"}`} className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-r-lg text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50">
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
