"use client";

import * as React from "react";
import { CaretDown, CaretRight, CaretUp, Check, FloppyDisk, Plus, Trash, TreeStructure } from "@phosphor-icons/react";
import type { OutlineKind, OutlineNode } from "@/domain/narrative";
import {
  getOutlineDescendantIds,
  getOutlineParentChoices,
  getSiblingMoveState,
  moveOutlineNode,
  projectOutlineTree,
} from "./outline-tree";
import { WorkspaceApiError, createOutlineNode, deleteOutlineNode, reorderOutlineNodes, updateOutlineNode } from "./workspace-api";
import { initializeSelectionDraft } from "./workspace-selection";

type OutlineDraft = {
  title: string;
  kind: OutlineKind;
  summary: string;
  parentId: string | null;
};

type OutlineWorkspaceProps = {
  projectId: string;
  nodes: OutlineNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNodesChanged: (nodes: OutlineNode[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onConfirmDiscard?: () => boolean;
};

const kinds: Array<{ value: OutlineKind; label: string }> = [
  { value: "story", label: "Story" },
  { value: "act", label: "Act" },
  { value: "chapter", label: "Chapter" },
  { value: "scene", label: "Scene" },
];

function draftFor(node: OutlineNode | undefined): OutlineDraft {
  return node
    ? { title: node.title, kind: node.kind, summary: node.summary, parentId: node.parentId }
    : { title: "", kind: "story", summary: "", parentId: null };
}

function firstError(error: WorkspaceApiError | null, field: string) {
  return error?.fieldErrors[field]?.[0] ?? null;
}

export function OutlineWorkspace({ projectId, nodes, selectedId, onSelect, onNodesChanged, onDirtyChange, onConfirmDiscard }: OutlineWorkspaceProps) {
  const selectedNode = nodes.find((node) => node.id === selectedId);
  const [draft, setDraft] = React.useState<OutlineDraft>(() => initializeSelectionDraft(selectedId, nodes, (node) => node.id, draftFor).draft);
  const [dirty, setDirty] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [movingId, setMovingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<WorkspaceApiError | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const tree = projectOutlineTree(nodes);

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
    return window.confirm("Discard unsaved changes to this outline node?");
  }

  function selectNode(id: string | null) {
    if (!confirmSwitch()) {
      return;
    }
    onSelect(id);
  }

  function updateDraft(field: keyof OutlineDraft, value: string | null) {
    if (pending) {
      return;
    }
    setDraft((current) => ({ ...current, [field]: value } as OutlineDraft));
    setDirty(true);
    onDirtyChange?.(true);
    setError(null);
    setNotice(null);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const node = selectedNode
        ? await updateOutlineNode(selectedNode.id, draft)
        : await createOutlineNode(projectId, draft);
      onNodesChanged(selectedNode ? nodes.map((current) => current.id === node.id ? node : current) : [...nodes, node]);
      onSelect(node.id);
      setDraft(draftFor(node));
      setDirty(false);
      onDirtyChange?.(false);
      setNotice("Outline node saved.");
    } catch (caught) {
      setError(caught instanceof WorkspaceApiError ? caught : new WorkspaceApiError(0, { code: "INTERNAL_ERROR", message: "The outline node could not be saved. Try again.", retryable: true }));
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!selectedNode || pending) {
      return;
    }
    const hasChildren = nodes.some((node) => node.parentId === selectedNode.id);
    if (hasChildren) {
      setError(new WorkspaceApiError(400, { code: "VALIDATION_ERROR", message: "Move or delete child nodes before deleting this node.", retryable: false }));
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`Delete ${selectedNode.title}?`)) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await deleteOutlineNode(selectedNode.id);
      onNodesChanged(nodes.filter((node) => node.id !== selectedNode.id));
      onSelect(null);
      setDirty(false);
      onDirtyChange?.(false);
      setNotice("Outline node deleted.");
    } catch (caught) {
      setError(caught instanceof WorkspaceApiError ? caught : new WorkspaceApiError(0, { code: "INTERNAL_ERROR", message: "The outline node could not be deleted. Try again.", retryable: true }));
    } finally {
      setPending(false);
    }
  }

  async function handleMove(nodeId: string, direction: "up" | "down") {
    if (movingId || pending) {
      return;
    }
    setMovingId(nodeId);
    setError(null);
    setNotice(null);
    try {
      const orderedIds = moveOutlineNode(nodes, nodeId, direction);
      const canonicalNodes = await reorderOutlineNodes(projectId, { orderedIds });
      onNodesChanged(canonicalNodes);
      setNotice("Outline order saved.");
    } catch (caught) {
      setError(caught instanceof WorkspaceApiError ? caught : new WorkspaceApiError(0, { code: "INTERNAL_ERROR", message: "The outline order could not be saved. Try again.", retryable: true }));
    } finally {
      setMovingId(null);
    }
  }

  const titleError = firstError(error, "title");
  const kindError = firstError(error, "kind");
  const summaryError = firstError(error, "summary");
  const parentError = firstError(error, "parentId");
  const descendantIds = selectedId ? getOutlineDescendantIds(nodes, selectedId) : [];
  const parentChoices = getOutlineParentChoices(nodes, selectedId);

  return (
    <section aria-labelledby="outline-heading" className="min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2 text-sm text-ink-faint"><TreeStructure size={18} weight="regular" aria-hidden="true" /> Outline</div>
          <h2 id="outline-heading" className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">Give the story a shape.</h2>
          <p className="mt-3 max-w-[60ch] text-sm leading-6 text-ink-muted">Build a hierarchy first. Move siblings with buttons when the order changes.</p>
        </div>
        <button type="button" onClick={() => selectNode(null)} disabled={pending || Boolean(movingId)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-raised px-4 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50">
          <Plus size={17} weight="regular" aria-hidden="true" /> New node
        </button>
      </header>

      {nodes.length === 0 ? (
        <div className="mt-7 border-l-2 border-accent pl-4" aria-label="Outline empty state">
          <p className="text-sm font-semibold text-ink">Start at the widest level.</p>
          <p className="mt-2 max-w-[58ch] text-sm leading-6 text-ink-muted">Create a story node, then add acts, chapters, or scenes beneath it. Nothing is added until you save it.</p>
        </div>
      ) : null}

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(260px,0.82fr)_minmax(0,1.18fr)]">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Story structure</h3>
            <span className="font-mono text-xs text-ink-faint">{nodes.length}</span>
          </div>
          <ul aria-label="Outline tree" className="mt-3 max-w-full list-none space-y-1 overflow-x-auto p-0">
            {tree.length > 0 ? tree.map((item) => <OutlineTreeRow key={item.node.id} item={item} selectedId={selectedId} movingId={movingId} onSelect={selectNode} onMove={handleMove} nodes={nodes} pending={pending} />) : <li className="border border-dashed border-line px-4 py-8 text-sm text-ink-faint">Your saved nodes will appear here.</li>}
          </ul>
        </div>

        <form onSubmit={handleSave} className="space-y-6 border-t border-line pt-6 xl:border-t-0 xl:border-l xl:pl-10 xl:pt-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{selectedNode ? "Edit node" : "New node"}</p>
            <p className="mt-2 text-sm text-ink-muted">Parent choices exclude this node and anything below it.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="space-y-2">
              <label htmlFor="outline-title" className="block text-sm font-semibold text-ink">Title</label>
              <input id="outline-title" name="title" value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} disabled={pending} aria-invalid={Boolean(titleError)} aria-describedby={titleError ? "outline-title-error" : undefined} className="min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink shadow-sm outline-none transition-colors placeholder:text-ink-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" placeholder="A clear story beat" />
              {titleError ? <p id="outline-title-error" className="text-xs text-danger">{titleError}</p> : null}
            </div>
            <div className="space-y-2">
              <label htmlFor="outline-kind" className="block text-sm font-semibold text-ink">Kind</label>
              <select id="outline-kind" name="kind" value={draft.kind} onChange={(event) => updateDraft("kind", event.target.value as OutlineKind)} disabled={pending} aria-invalid={Boolean(kindError)} aria-describedby={kindError ? "outline-kind-error" : undefined} className="min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink shadow-sm outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60">
                {kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
              </select>
              {kindError ? <p id="outline-kind-error" className="text-xs text-danger">{kindError}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="outline-parent" className="block text-sm font-semibold text-ink">Parent</label>
            <select id="outline-parent" name="parentId" value={draft.parentId ?? ""} onChange={(event) => updateDraft("parentId", event.target.value || null)} disabled={pending} aria-invalid={Boolean(parentError)} aria-describedby={parentError ? "outline-parent-error" : undefined} className="min-h-11 w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-ink shadow-sm outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-60">
              <option value="">No parent</option>
              {parentChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title} ({choice.kind})</option>)}
            </select>
            {parentError ? <p id="outline-parent-error" className="text-xs text-danger">{parentError}</p> : null}
            {selectedNode && descendantIds.length > 0 ? <p className="text-xs leading-5 text-ink-faint">{descendantIds.length} descendant{descendantIds.length === 1 ? "" : "s"} excluded.</p> : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="outline-summary" className="block text-sm font-semibold text-ink">Summary</label>
            <textarea id="outline-summary" name="summary" value={draft.summary} onChange={(event) => updateDraft("summary", event.target.value)} disabled={pending} aria-invalid={Boolean(summaryError)} aria-describedby={summaryError ? "outline-summary-error" : undefined} rows={5} className="min-h-32 w-full resize-y rounded-lg border border-line bg-surface-raised px-3 py-3 text-sm leading-6 text-ink shadow-sm outline-none transition-colors placeholder:text-ink-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-60" placeholder="What changes here?" />
            {summaryError ? <p id="outline-summary-error" className="text-xs text-danger">{summaryError}</p> : null}
          </div>

          <div aria-live="assertive" aria-atomic="true" className="min-h-6">
            {error ? <p role="alert" className="text-sm text-danger">{error.message}</p> : null}
          </div>
          <div aria-live="polite" aria-atomic="true" className="min-h-6">
            {!error && notice ? <p className="inline-flex items-center gap-2 text-sm text-success"><Check size={16} weight="bold" aria-hidden="true" /> {notice}</p> : null}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <button type="submit" disabled={pending || Boolean(movingId)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong active:translate-y-px disabled:opacity-60"><FloppyDisk size={17} weight="regular" aria-hidden="true" /> {pending ? "Saving" : "Save node"}</button>
            {selectedNode ? <button type="button" onClick={handleDelete} disabled={pending || Boolean(movingId) || nodes.some((node) => node.parentId === selectedNode.id)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-danger/40 px-4 text-sm font-semibold text-danger transition-colors hover:bg-accent-soft active:translate-y-px disabled:opacity-60" title={nodes.some((node) => node.parentId === selectedNode.id) ? "Move or delete child nodes first" : undefined}><Trash size={17} weight="regular" aria-hidden="true" /> Delete node</button> : null}
            {dirty ? <span className="text-xs text-ink-faint">Unsaved changes</span> : null}
          </div>
          {selectedNode && nodes.some((node) => node.parentId === selectedNode.id) ? <p className="text-xs leading-5 text-ink-faint">This node has children. Move or delete them before deleting this node.</p> : null}
        </form>
      </div>
    </section>
  );
}

function OutlineTreeRow({ item, selectedId, movingId, onSelect, onMove, nodes, pending }: { item: ReturnType<typeof projectOutlineTree>[number]; selectedId: string | null; movingId: string | null; onSelect: (id: string) => void; onMove: (id: string, direction: "up" | "down") => void; nodes: OutlineNode[]; pending: boolean }) {
  const moveState = getSiblingMoveState(nodes, item.node.id);
  return (
    <li>
      <div className={`flex min-h-12 items-center gap-2 rounded-lg border px-2 transition-colors ${selectedId === item.node.id ? "border-accent/50 bg-accent-soft" : "border-transparent hover:border-line hover:bg-surface-muted"}`} style={{ marginLeft: `${item.depth * 16}px` }}>
        <button type="button" onClick={() => onSelect(item.node.id)} aria-pressed={selectedId === item.node.id} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm text-ink">
          <CaretRight size={14} weight="regular" className="shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-semibold">{item.node.title}</span>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-ink-faint">{item.node.kind}</span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => onMove(item.node.id, "up")} disabled={!moveState.canMoveUp || movingId !== null || pending} aria-label={`Move ${item.node.title} up`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-raised hover:text-ink disabled:opacity-30"><CaretUp size={17} weight="regular" aria-hidden="true" /></button>
          <button type="button" onClick={() => onMove(item.node.id, "down")} disabled={!moveState.canMoveDown || movingId !== null || pending} aria-label={`Move ${item.node.title} down`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-raised hover:text-ink disabled:opacity-30"><CaretDown size={17} weight="regular" aria-hidden="true" /></button>
        </div>
      </div>
      {item.children.length > 0 ? <ul className="list-none space-y-1 p-0">{item.children.map((child) => <OutlineTreeRow key={child.node.id} item={child} selectedId={selectedId} movingId={movingId} onSelect={onSelect} onMove={onMove} nodes={nodes} pending={pending} />)}</ul> : null}
    </li>
  );
}
