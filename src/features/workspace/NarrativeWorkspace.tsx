"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { List, X } from "@phosphor-icons/react";
import type { Adaptation } from "@/domain/adaptation";
import type { ScriptDocument } from "@/domain/document";
import type { BibleEntry, Chapter, OutlineNode } from "@/domain/narrative";
import type { Project } from "@/domain/project";
import { ChapterWorkspace, type ChapterWorkspaceHandle } from "./ChapterWorkspace";
import { AdaptationWorkspace, type AdaptationWorkspaceHandle } from "./AdaptationWorkspace";
import { OutlineWorkspace } from "./OutlineWorkspace";
import { WorkspaceApiError, createChapter, createManualAdaptation, createScriptDocument, deleteAdaptation, deleteChapter, listScriptDocuments } from "./workspace-api";
import { chapterSelectionAfterDelete, replaceCanonicalChapter, sortChapters } from "./chapter-shell-helpers";
import { replaceCanonicalRecord } from "./outline-tree";
import { StoryBibleWorkspace } from "./StoryBibleWorkspace";
import { WorkspaceNavigator, type WorkspaceSection } from "./WorkspaceNavigator";
import { workspaceSelectionKey } from "./workspace-selection";
import { adaptationSelectionAfterDelete, replaceCanonicalAdaptation, sortAdaptations } from "./adaptation-shell-helpers";
import { ExportProjectDialog } from "./ExportProjectDialog";

const ScriptsWorkspace = dynamic(() => import("./ScriptsWorkspace").then((module) => module.ScriptsWorkspace), {
  ssr: false,
  loading: () => <div className="min-h-32 text-sm text-ink-muted">Loading Scripts…</div>,
});

export type WorkspaceInitialData = {
  project: Project;
  bibleEntries: BibleEntry[];
  outlineNodes: OutlineNode[];
  chapters: Chapter[];
  adaptations: Adaptation[];
};

type NarrativeWorkspaceProps = {
  initialWorkspace: WorkspaceInitialData;
};

export function NarrativeWorkspace({ initialWorkspace }: NarrativeWorkspaceProps) {
  const router = useRouter();
  const { project } = initialWorkspace;
  const [activeSection, setActiveSection] = React.useState<WorkspaceSection>("bible");
  const [bibleEntries, setBibleEntries] = React.useState(initialWorkspace.bibleEntries);
  const [outlineNodes, setOutlineNodes] = React.useState(initialWorkspace.outlineNodes);
  const [chapters, setChapters] = React.useState(() => sortChapters(initialWorkspace.chapters));
  const [adaptations, setAdaptations] = React.useState(() => sortAdaptations(initialWorkspace.adaptations));
  const [scriptDocuments, setScriptDocuments] = React.useState<ScriptDocument[]>([]);
  const [selectedBibleId, setSelectedBibleId] = React.useState<string | null>(initialWorkspace.bibleEntries[0]?.id ?? null);
  const [selectedOutlineId, setSelectedOutlineId] = React.useState<string | null>(initialWorkspace.outlineNodes[0]?.id ?? null);
  const [selectedChapterId, setSelectedChapterId] = React.useState<string | null>(() => sortChapters(initialWorkspace.chapters)[0]?.id ?? null);
  const [selectedAdaptationId, setSelectedAdaptationId] = React.useState<string | null>(() => sortAdaptations(initialWorkspace.adaptations)[0]?.id ?? null);
  const [selectedScriptDocumentId, setSelectedScriptDocumentId] = React.useState<string | null>(null);
  const [bibleDirty, setBibleDirty] = React.useState(false);
  const [outlineDirty, setOutlineDirty] = React.useState(false);
  const [scriptDirty, setScriptDirty] = React.useState(false);
  const [navigationPending, setNavigationPending] = React.useState(false);
  const [chapterMutationPending, setChapterMutationPending] = React.useState(false);
  const [chapterError, setChapterError] = React.useState<string | null>(null);
  const [adaptationMutationPending, setAdaptationMutationPending] = React.useState(false);
  const [adaptationError, setAdaptationError] = React.useState<string | null>(null);
  const [scriptDocumentLoading, setScriptDocumentLoading] = React.useState(false);
  const [scriptDocumentError, setScriptDocumentError] = React.useState<string | null>(null);
  const [scriptMutationPending, setScriptMutationPending] = React.useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = React.useState(false);
  const drawerRef = React.useRef<HTMLDivElement>(null);
  const chapterRef = React.useRef<ChapterWorkspaceHandle>(null);
  const adaptationRef = React.useRef<AdaptationWorkspaceHandle>(null);
  const navigationPendingRef = React.useRef(false);
  const chapterMutationPendingRef = React.useRef(false);
  const adaptationMutationPendingRef = React.useRef(false);
  const scriptMutationPendingRef = React.useRef(false);
  const scriptDocumentsLoadedRef = React.useRef(false);

  const confirmBibleDiscard = React.useCallback(() => {
    if (!bibleDirty) {
      return true;
    }
    return typeof window === "undefined" || window.confirm("Discard unsaved changes to this entry?");
  }, [bibleDirty]);

  const confirmOutlineDiscard = React.useCallback(() => {
    if (!outlineDirty) {
      return true;
    }
    return typeof window === "undefined" || window.confirm("Discard unsaved changes to this outline node?");
  }, [outlineDirty]);

  const confirmScriptDiscard = React.useCallback(() => {
    if (!scriptDirty) {
      return true;
    }
    return typeof window === "undefined" || window.confirm("Discard unsaved script changes?");
  }, [scriptDirty]);

  const setNavigationBusy = React.useCallback((busy: boolean) => {
    navigationPendingRef.current = busy;
    setNavigationPending(busy);
  }, []);

  const setChapterMutationBusy = React.useCallback((busy: boolean) => {
    chapterMutationPendingRef.current = busy;
    setChapterMutationPending(busy);
  }, []);

  const setAdaptationMutationBusy = React.useCallback((busy: boolean) => {
    adaptationMutationPendingRef.current = busy;
    setAdaptationMutationPending(busy);
  }, []);

  const setScriptMutationBusy = React.useCallback((busy: boolean) => {
    scriptMutationPendingRef.current = busy;
    setScriptMutationPending(busy);
  }, []);

  const flushCurrentChapter = React.useCallback(() => chapterRef.current?.flush() ?? Promise.resolve(true), []);
  const flushCurrentAdaptation = React.useCallback(() => adaptationRef.current?.flush() ?? Promise.resolve(true), []);
  const flushActiveDocument = React.useCallback(() => {
    if (activeSection === "chapters") {
      return flushCurrentChapter();
    }
    if (activeSection === "adaptations") {
      return flushCurrentAdaptation();
    }
    return Promise.resolve(true);
  }, [activeSection, flushCurrentAdaptation, flushCurrentChapter]);

  const loadScriptDocuments = React.useCallback(async (force = false) => {
    if (scriptDocumentLoading || (scriptDocumentsLoadedRef.current && !force)) {
      return;
    }
    setScriptDocumentLoading(true);
    setScriptDocumentError(null);
    try {
      const documents = await listScriptDocuments(project.id);
      setScriptDocuments(documents);
      setSelectedScriptDocumentId((current) => current && documents.some((document) => document.id === current)
        ? current
        : documents[0]?.id ?? null);
      scriptDocumentsLoadedRef.current = true;
    } catch (error) {
      setScriptDocumentError(error instanceof WorkspaceApiError ? error.message : "The script documents could not be loaded. Try again.");
    } finally {
      setScriptDocumentLoading(false);
    }
  }, [project.id, scriptDocumentLoading]);

  const retryScriptDocuments = React.useCallback(() => {
    void loadScriptDocuments(true);
  }, [loadScriptDocuments]);

  const requestSectionChange = React.useCallback(async (section: WorkspaceSection) => {
    if (section === activeSection) {
      setMobileNavigationOpen(false);
      return;
    }
    if (navigationPendingRef.current || chapterMutationPendingRef.current || adaptationMutationPendingRef.current || scriptMutationPendingRef.current) {
      return;
    }
    if (activeSection === "bible" && !confirmBibleDiscard()) {
      return;
    }
    if (activeSection === "outline" && !confirmOutlineDiscard()) {
      return;
    }
    if (activeSection === "scripts" && !confirmScriptDiscard()) {
      return;
    }
    setNavigationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      if (activeSection === "bible") {
        setBibleDirty(false);
      }
      if (activeSection === "outline") {
        setOutlineDirty(false);
      }
      if (activeSection === "scripts") {
        setScriptDirty(false);
      }
      setActiveSection(section);
      setChapterError(null);
      setMobileNavigationOpen(false);
      if (section === "scripts") {
        void loadScriptDocuments();
      }
    } finally {
      setNavigationBusy(false);
    }
  }, [activeSection, confirmBibleDiscard, confirmOutlineDiscard, confirmScriptDiscard, flushActiveDocument, loadScriptDocuments, setNavigationBusy]);

  const requestBibleSelect = React.useCallback(async (id: string) => {
    const changingSelection = id !== selectedBibleId || activeSection !== "bible";
    if (!changingSelection) {
      setMobileNavigationOpen(false);
      return;
    }
    if (navigationPendingRef.current || chapterMutationPendingRef.current || adaptationMutationPendingRef.current || scriptMutationPendingRef.current) {
      return;
    }
    if (activeSection === "bible" && !confirmBibleDiscard()) {
      return;
    }
    if (activeSection === "outline" && !confirmOutlineDiscard()) {
      return;
    }
    if (activeSection === "scripts" && !confirmScriptDiscard()) {
      return;
    }
    setNavigationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      if (activeSection === "bible") {
        setBibleDirty(false);
      }
      if (activeSection === "outline") {
        setOutlineDirty(false);
      }
      if (activeSection === "scripts") {
        setScriptDirty(false);
      }
      setActiveSection("bible");
      setSelectedBibleId(id);
      setChapterError(null);
      setMobileNavigationOpen(false);
    } finally {
      setNavigationBusy(false);
    }
  }, [activeSection, confirmBibleDiscard, confirmOutlineDiscard, confirmScriptDiscard, flushActiveDocument, selectedBibleId, setNavigationBusy]);

  const requestOutlineSelect = React.useCallback(async (id: string) => {
    const changingSelection = id !== selectedOutlineId || activeSection !== "outline";
    if (!changingSelection) {
      setMobileNavigationOpen(false);
      return;
    }
    if (navigationPendingRef.current || chapterMutationPendingRef.current || adaptationMutationPendingRef.current || scriptMutationPendingRef.current) {
      return;
    }
    if (activeSection === "bible" && !confirmBibleDiscard()) {
      return;
    }
    if (activeSection === "outline" && !confirmOutlineDiscard()) {
      return;
    }
    if (activeSection === "scripts" && !confirmScriptDiscard()) {
      return;
    }
    setNavigationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      if (activeSection === "bible") {
        setBibleDirty(false);
      }
      if (activeSection === "outline") {
        setOutlineDirty(false);
      }
      if (activeSection === "scripts") {
        setScriptDirty(false);
      }
      setActiveSection("outline");
      setSelectedOutlineId(id);
      setChapterError(null);
      setMobileNavigationOpen(false);
    } finally {
      setNavigationBusy(false);
    }
  }, [activeSection, confirmBibleDiscard, confirmOutlineDiscard, confirmScriptDiscard, flushActiveDocument, selectedOutlineId, setNavigationBusy]);

  const requestChapterSelect = React.useCallback(async (id: string) => {
    const changingSelection = id !== selectedChapterId || activeSection !== "chapters";
    if (!changingSelection) {
      setMobileNavigationOpen(false);
      return;
    }
    if (navigationPendingRef.current || chapterMutationPendingRef.current || adaptationMutationPendingRef.current || scriptMutationPendingRef.current) {
      return;
    }
    if (activeSection === "bible" && !confirmBibleDiscard()) {
      return;
    }
    if (activeSection === "outline" && !confirmOutlineDiscard()) {
      return;
    }
    if (activeSection === "scripts" && !confirmScriptDiscard()) {
      return;
    }
    setNavigationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      if (activeSection === "bible") {
        setBibleDirty(false);
      }
      if (activeSection === "outline") {
        setOutlineDirty(false);
      }
      if (activeSection === "scripts") {
        setScriptDirty(false);
      }
      setSelectedChapterId(id);
      setActiveSection("chapters");
      setChapterError(null);
      setMobileNavigationOpen(false);
    } finally {
      setNavigationBusy(false);
    }
  }, [activeSection, confirmBibleDiscard, confirmOutlineDiscard, confirmScriptDiscard, flushActiveDocument, selectedChapterId, setNavigationBusy]);

  const requestAdaptationSelect = React.useCallback(async (id: string) => {
    const changingSelection = id !== selectedAdaptationId || activeSection !== "adaptations";
    if (!changingSelection) {
      setMobileNavigationOpen(false);
      return;
    }
    if (navigationPendingRef.current || chapterMutationPendingRef.current || adaptationMutationPendingRef.current || scriptMutationPendingRef.current) {
      return;
    }
    if (activeSection === "bible" && !confirmBibleDiscard()) {
      return;
    }
    if (activeSection === "outline" && !confirmOutlineDiscard()) {
      return;
    }
    if (activeSection === "scripts" && !confirmScriptDiscard()) {
      return;
    }
    setNavigationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      if (activeSection === "bible") {
        setBibleDirty(false);
      }
      if (activeSection === "outline") {
        setOutlineDirty(false);
      }
      if (activeSection === "scripts") {
        setScriptDirty(false);
      }
      setSelectedAdaptationId(id);
      setActiveSection("adaptations");
      setAdaptationError(null);
      setMobileNavigationOpen(false);
    } finally {
      setNavigationBusy(false);
    }
  }, [activeSection, confirmBibleDiscard, confirmOutlineDiscard, confirmScriptDiscard, flushActiveDocument, selectedAdaptationId, setNavigationBusy]);

  const requestScriptDocumentSelect = React.useCallback(async (id: string) => {
    const changingSelection = id !== selectedScriptDocumentId || activeSection !== "scripts";
    if (!changingSelection) {
      setMobileNavigationOpen(false);
      return;
    }
    if (navigationPendingRef.current || chapterMutationPendingRef.current || adaptationMutationPendingRef.current || scriptMutationPendingRef.current) {
      return;
    }
    if (activeSection === "bible" && !confirmBibleDiscard()) {
      return;
    }
    if (activeSection === "outline" && !confirmOutlineDiscard()) {
      return;
    }
    if (activeSection === "scripts" && !confirmScriptDiscard()) {
      return;
    }
    setNavigationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      if (activeSection === "bible") {
        setBibleDirty(false);
      }
      if (activeSection === "outline") {
        setOutlineDirty(false);
      }
      if (activeSection === "scripts") {
        setScriptDirty(false);
      }
      setSelectedScriptDocumentId(id);
      setActiveSection("scripts");
      setScriptDocumentError(null);
      setMobileNavigationOpen(false);
    } finally {
      setNavigationBusy(false);
    }
  }, [activeSection, confirmBibleDiscard, confirmOutlineDiscard, confirmScriptDiscard, flushActiveDocument, selectedScriptDocumentId, setNavigationBusy]);

  const requestLibraryNavigation = React.useCallback(() => {
    if (navigationPendingRef.current || chapterMutationPendingRef.current || adaptationMutationPendingRef.current || scriptMutationPendingRef.current) {
      return;
    }
    if (activeSection === "bible" && !confirmBibleDiscard()) {
      return;
    }
    if (activeSection === "outline" && !confirmOutlineDiscard()) {
      return;
    }
    if (activeSection === "scripts" && !confirmScriptDiscard()) {
      return;
    }

    const navigate = async () => {
      setNavigationBusy(true);
      try {
        if (!(await flushActiveDocument())) {
          setNavigationBusy(false);
          return;
        }
        router.push("/");
      } catch {
        setNavigationBusy(false);
      }
    };
    void navigate();
  }, [activeSection, confirmBibleDiscard, confirmOutlineDiscard, confirmScriptDiscard, flushActiveDocument, router, setNavigationBusy]);

  React.useEffect(() => {
    if (!bibleDirty && !outlineDirty && !scriptDirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [bibleDirty, outlineDirty, scriptDirty]);

  React.useEffect(() => {
    if (!mobileNavigationOpen || typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(max-width: 1023px)");
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const drawer = drawerRef.current;
    const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";
    const focusFirst = () => drawer?.querySelector<HTMLElement>(focusableSelector)?.focus();
    const frame = window.requestAnimationFrame(focusFirst);
    const closeOnDesktop = () => {
      if (!media.matches) {
        setMobileNavigationOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavigationOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawer) {
        return;
      }
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    media.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, [mobileNavigationOpen]);

  function appendBibleEntry(entry: BibleEntry) {
    setBibleEntries((current) => [...current, entry].sort(comparePosition));
    setSelectedBibleId(entry.id);
    setBibleDirty(false);
  }

  function replaceBibleEntry(entry: BibleEntry) {
    setBibleEntries((current) => replaceCanonicalRecord(current, entry).sort(comparePosition));
    setBibleDirty(false);
  }

  function removeBibleEntry(id: string) {
    setBibleEntries((current) => current.filter((entry) => entry.id !== id));
    setSelectedBibleId(null);
    setBibleDirty(false);
  }

  function replaceOutlineNodes(nodes: OutlineNode[]) {
    setOutlineNodes(nodes);
  }

  const replaceChapter = React.useCallback((canonical: Chapter) => {
    setChapters((current) => replaceCanonicalChapter(current, canonical));
  }, []);

  const replaceAdaptation = React.useCallback((canonical: Adaptation) => {
    setAdaptations((current) => replaceCanonicalAdaptation(current, canonical));
  }, []);

  const handleAdaptationCreated = React.useCallback((canonical: Adaptation) => {
    setAdaptations((current) => replaceCanonicalAdaptation(current, canonical));
    setSelectedAdaptationId(canonical.id);
    setActiveSection("adaptations");
    setAdaptationError(null);
    setMobileNavigationOpen(false);
  }, []);

  const handleChapterCreate = React.useCallback(async () => {
    if (chapterMutationPendingRef.current || navigationPendingRef.current) {
      return;
    }
    setChapterError(null);
    setChapterMutationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      const created = await createChapter(project.id, { title: "Untitled chapter" });
      setChapters((current) => sortChapters([...current, created]));
      setSelectedChapterId(created.id);
      setActiveSection("chapters");
      setChapterError(null);
      setMobileNavigationOpen(false);
    } catch (error) {
      setChapterError(error instanceof WorkspaceApiError ? error.message : "The chapter could not be created. Try again.");
    } finally {
      setChapterMutationBusy(false);
    }
  }, [flushActiveDocument, project.id, setChapterMutationBusy]);

  const handleChapterDelete = React.useCallback(async (id: string) => {
    if (chapterMutationPendingRef.current || navigationPendingRef.current) {
      return;
    }
    const target = chapters.find((chapter) => chapter.id === id);
    if (!target) {
      return;
    }
    setChapterError(null);
    setChapterMutationBusy(true);
    try {
      if (activeSection === "chapters" && !(await flushCurrentChapter())) {
        return;
      }
      if (typeof window !== "undefined" && !window.confirm(`Delete ${target.title || "Untitled chapter"}?`)) {
        return;
      }
      await deleteChapter(id);
      setChapters((current) => sortChapters(current.filter((chapter) => chapter.id !== id)));
      setSelectedChapterId((current) => chapterSelectionAfterDelete(chapters, id, current));
      setChapterError(null);
    } catch (error) {
      setChapterError(error instanceof WorkspaceApiError ? error.message : "The chapter could not be deleted. Try again.");
    } finally {
      setChapterMutationBusy(false);
    }
  }, [activeSection, chapters, flushCurrentChapter, setChapterMutationBusy]);

  const handleAdaptationCreate = React.useCallback(async () => {
    if (chapterMutationPendingRef.current || adaptationMutationPendingRef.current || navigationPendingRef.current) {
      return;
    }
    setAdaptationError(null);
    setAdaptationMutationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      const created = await createManualAdaptation(project.id, {
        origin: "manual",
        format: "screenplay_scene",
        title: "Untitled adaptation",
        body: "",
      });
      setAdaptations((current) => sortAdaptations([...current, created]));
      setSelectedAdaptationId(created.id);
      setActiveSection("adaptations");
      setAdaptationError(null);
      setMobileNavigationOpen(false);
    } catch (error) {
      setAdaptationError(error instanceof WorkspaceApiError ? error.message : "The adaptation could not be created. Try again.");
    } finally {
      setAdaptationMutationBusy(false);
    }
  }, [flushActiveDocument, project.id, setAdaptationMutationBusy]);

  const handleAdaptationDelete = React.useCallback(async (id: string) => {
    if (chapterMutationPendingRef.current || adaptationMutationPendingRef.current || navigationPendingRef.current) {
      return;
    }
    const target = adaptations.find((item) => item.id === id);
    if (!target) {
      return;
    }
    setAdaptationError(null);
    setAdaptationMutationBusy(true);
    try {
      if (activeSection === "adaptations" && !(await flushCurrentAdaptation())) {
        return;
      }
      if (typeof window !== "undefined" && !window.confirm(`Delete ${target.title || "Untitled adaptation"}?`)) {
        return;
      }
      await deleteAdaptation(id);
      setAdaptations((current) => sortAdaptations(current.filter((item) => item.id !== id)));
      setSelectedAdaptationId((current) => adaptationSelectionAfterDelete(adaptations, id, current));
      setAdaptationError(null);
    } catch (error) {
      setAdaptationError(error instanceof WorkspaceApiError ? error.message : "The adaptation could not be deleted. Try again.");
    } finally {
      setAdaptationMutationBusy(false);
    }
  }, [activeSection, adaptations, flushCurrentAdaptation, setAdaptationMutationBusy]);

  const handleScriptDocumentCreate = React.useCallback(async () => {
    if (scriptMutationPendingRef.current || navigationPendingRef.current || chapterMutationPendingRef.current || adaptationMutationPendingRef.current) {
      return;
    }
    if (activeSection === "scripts" && !confirmScriptDiscard()) {
      return;
    }
    setScriptDocumentError(null);
    setScriptMutationBusy(true);
    try {
      if (!(await flushActiveDocument())) {
        return;
      }
      const created = await createScriptDocument(project.id, {
        title: "Untitled script",
        kind: "screenplay",
        requestId: `script-create-${Date.now()}`,
        actorId: "local-user",
        scenes: [],
      });
      setScriptDocuments((current) => [...current.filter((document) => document.id !== created.id), created]);
      scriptDocumentsLoadedRef.current = true;
      setScriptDirty(false);
      setSelectedScriptDocumentId(created.id);
      setActiveSection("scripts");
      setScriptDocumentError(null);
      setMobileNavigationOpen(false);
    } catch (error) {
      setScriptDocumentError(error instanceof WorkspaceApiError ? error.message : "The script document could not be created. Try again.");
    } finally {
      setScriptMutationBusy(false);
    }
  }, [activeSection, confirmScriptDiscard, flushActiveDocument, project.id, setScriptMutationBusy]);

  const selectedScriptDocument = scriptDocuments.find((document) => document.id === selectedScriptDocumentId) ?? null;
  const handleScriptDocumentChanged = React.useCallback((canonical: ScriptDocument) => {
    setScriptDocuments((current) => current.map((document) => document.id === canonical.id ? canonical : document));
  }, []);

  const activeLabel = activeSection === "bible" ? "Story bible" : activeSection === "outline" ? "Outline" : activeSection === "chapters" ? "Chapters" : activeSection === "adaptations" ? "Adaptations" : "Scripts";
  const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId) ?? null;
  const selectedAdaptation = adaptations.find((adaptation) => adaptation.id === selectedAdaptationId) ?? null;
  const activeTitle = activeSection === "bible"
    ? (bibleEntries.find((entry) => entry.id === selectedBibleId)?.title ?? "Story bible")
    : activeSection === "outline"
      ? (outlineNodes.find((node) => node.id === selectedOutlineId)?.title ?? "Outline")
      : activeSection === "chapters"
        ? (selectedChapter?.title ?? "Chapters")
        : activeSection === "adaptations"
          ? (selectedAdaptation?.title ?? activeLabel)
          : (selectedScriptDocument?.title ?? activeLabel);

  return (
    <main className="min-h-[100dvh] bg-canvas text-ink">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[1440px]">
        <div className="hidden shrink-0 lg:flex lg:w-[260px]">
          <WorkspaceNavigator
            project={project}
            activeSection={activeSection}
            onSectionChange={requestSectionChange}
            bibleEntries={bibleEntries}
            outlineNodes={outlineNodes}
             chapters={chapters}
             adaptations={adaptations}
             scriptDocuments={scriptDocuments}
            selectedBibleId={selectedBibleId}
            selectedOutlineId={selectedOutlineId}
             selectedChapterId={selectedChapterId}
             selectedAdaptationId={selectedAdaptationId}
             selectedScriptDocumentId={selectedScriptDocumentId}
            onBibleSelect={requestBibleSelect}
            onOutlineSelect={requestOutlineSelect}
            onChapterSelect={requestChapterSelect}
            onChapterCreate={handleChapterCreate}
            onChapterDelete={handleChapterDelete}
            onAdaptationSelect={requestAdaptationSelect}
            onAdaptationCreate={handleAdaptationCreate}
             onAdaptationDelete={handleAdaptationDelete}
             onScriptDocumentSelect={requestScriptDocumentSelect}
             onScriptDocumentCreate={handleScriptDocumentCreate}
             onScriptDocumentRetry={retryScriptDocuments}
            chapterMutationPending={chapterMutationPending}
            chapterError={chapterError}
            adaptationMutationPending={adaptationMutationPending}
             adaptationError={adaptationError}
             scriptDocumentLoading={scriptDocumentLoading}
             scriptDocumentError={scriptDocumentError}
             scriptMutationPending={scriptMutationPending}
             navigationPending={navigationPending}
            onLibraryNavigate={requestLibraryNavigation}
          />
        </div>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur-sm">
            <div className="flex min-h-[76px] items-center gap-4 px-5 sm:px-8 lg:px-10">
              <button type="button" onClick={() => setMobileNavigationOpen(true)} aria-label="Open workspace navigation" aria-expanded={mobileNavigationOpen} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-surface-raised text-ink lg:hidden"><List size={20} weight="regular" aria-hidden="true" /></button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink-faint">{project.title} <span aria-hidden="true">/</span> {activeLabel}</p>
                <h1 className="mt-1 truncate text-lg font-semibold tracking-[-0.025em] text-ink">{activeTitle}</h1>
              </div>
              <ExportProjectDialog
                projectId={project.id}
                projectTitle={project.title}
                counts={{
                  bibleEntries: bibleEntries.length,
                  outlineNodes: outlineNodes.length,
                  chapters: chapters.length,
                  adaptations: adaptations.length,
                }}
                bibleDirty={bibleDirty}
                outlineDirty={outlineDirty}
                flushActiveDocument={flushActiveDocument}
                 disabled={navigationPending || chapterMutationPending || adaptationMutationPending || scriptMutationPending}
              />
            </div>
          </header>

          <div className="px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
            {activeSection === "bible" ? (
              <StoryBibleWorkspace
                key={workspaceSelectionKey("bible", selectedBibleId)}
                projectId={project.id}
                entries={bibleEntries}
                selectedId={selectedBibleId}
                onSelect={setSelectedBibleId}
                onEntryCreated={appendBibleEntry}
                onEntryReplaced={replaceBibleEntry}
                onEntryDeleted={removeBibleEntry}
                onDirtyChange={setBibleDirty}
                onConfirmDiscard={confirmBibleDiscard}
              />
            ) : null}
            {activeSection === "outline" ? (
              <OutlineWorkspace
                key={workspaceSelectionKey("outline", selectedOutlineId)}
                projectId={project.id}
                nodes={outlineNodes}
                selectedId={selectedOutlineId}
                onSelect={setSelectedOutlineId}
                onNodesChanged={replaceOutlineNodes}
                onDirtyChange={setOutlineDirty}
                onConfirmDiscard={confirmOutlineDiscard}
              />
            ) : null}
            {activeSection === "chapters" ? (
              selectedChapter ? (
                <ChapterWorkspace
                  key={selectedChapter.id}
                  ref={chapterRef}
                  projectId={project.id}
                  chapter={selectedChapter}
                  bibleEntries={bibleEntries}
                  outlineNodes={outlineNodes}
                  chapters={chapters}
                  onChapterChanged={replaceChapter}
                  onAdaptationCreated={handleAdaptationCreated}
                />
              ) : (
                <ChapterEmptySection onCreate={handleChapterCreate} pending={chapterMutationPending} error={chapterError} />
              )
            ) : null}
            {activeSection === "adaptations" ? (
              selectedAdaptation ? (
                <AdaptationWorkspace
                  key={selectedAdaptation.id}
                  ref={adaptationRef}
                  projectId={project.id}
                  adaptation={selectedAdaptation}
                  onAdaptationChanged={replaceAdaptation}
                />
              ) : (
                <AdaptationEmptySection onCreate={handleAdaptationCreate} pending={adaptationMutationPending} error={adaptationError} />
              )
            ) : null}
            {activeSection === "scripts" ? (
              <ScriptsWorkspace
                key={workspaceSelectionKey("scripts", selectedScriptDocumentId)}
                projectId={project.id}
                document={selectedScriptDocument}
                onDocumentChanged={handleScriptDocumentChanged}
                onCreateDocument={handleScriptDocumentCreate}
                onDirtyChange={setScriptDirty}
              />
            ) : null}
          </div>
        </div>
      </div>

      {mobileNavigationOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" aria-label="Workspace navigation drawer">
          <button type="button" aria-label="Close workspace navigation" onClick={() => setMobileNavigationOpen(false)} className="absolute inset-0 bg-ink/35" />
          <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="Workspace navigation" className="relative h-full w-[min(88vw,340px)] bg-surface shadow-xl">
            <button type="button" onClick={() => setMobileNavigationOpen(false)} aria-label="Close workspace navigation" className="absolute right-3 top-3 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-surface-raised text-ink"><X size={19} weight="regular" aria-hidden="true" /></button>
            <WorkspaceNavigator
              project={project}
              activeSection={activeSection}
              onSectionChange={requestSectionChange}
              bibleEntries={bibleEntries}
              outlineNodes={outlineNodes}
               chapters={chapters}
               adaptations={adaptations}
               scriptDocuments={scriptDocuments}
              selectedBibleId={selectedBibleId}
              selectedOutlineId={selectedOutlineId}
               selectedChapterId={selectedChapterId}
               selectedAdaptationId={selectedAdaptationId}
               selectedScriptDocumentId={selectedScriptDocumentId}
              onBibleSelect={requestBibleSelect}
              onOutlineSelect={requestOutlineSelect}
              onChapterSelect={requestChapterSelect}
              onChapterCreate={handleChapterCreate}
              onChapterDelete={handleChapterDelete}
              onAdaptationSelect={requestAdaptationSelect}
              onAdaptationCreate={handleAdaptationCreate}
               onAdaptationDelete={handleAdaptationDelete}
               onScriptDocumentSelect={requestScriptDocumentSelect}
               onScriptDocumentCreate={handleScriptDocumentCreate}
               onScriptDocumentRetry={retryScriptDocuments}
              chapterMutationPending={chapterMutationPending}
              chapterError={chapterError}
              adaptationMutationPending={adaptationMutationPending}
               adaptationError={adaptationError}
               scriptDocumentLoading={scriptDocumentLoading}
               scriptDocumentError={scriptDocumentError}
               scriptMutationPending={scriptMutationPending}
              navigationPending={navigationPending}
              onLibraryNavigate={requestLibraryNavigation}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function comparePosition<T extends { position: number; id: string }>(left: T, right: T) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function ChapterEmptySection({ onCreate, pending, error }: { onCreate: () => void; pending: boolean; error: string | null }) {
  return (
    <section aria-labelledby="chapter-empty-heading" className="max-w-[780px]">
      <header className="border-b border-line pb-6">
        <p className="text-sm text-ink-faint">Manuscript</p>
        <h2 id="chapter-empty-heading" className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">Start with the first chapter.</h2>
        <p className="mt-3 max-w-[60ch] text-sm leading-6 text-ink-muted">Create a blank chapter, then shape the draft with autosave and history.</p>
      </header>
      {error ? <p role="alert" className="mt-6 border-l-2 border-danger pl-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-8 border-l-2 border-line pl-4">
        <p className="text-sm font-semibold text-ink">No chapters yet</p>
        <p className="mt-2 max-w-[54ch] text-sm leading-6 text-ink-muted">Your first chapter becomes the place where the outline turns into prose.</p>
        <button type="button" onClick={onCreate} disabled={pending} className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Creating chapter" : "New chapter"}</button>
      </div>
    </section>
  );
}

function AdaptationEmptySection({ onCreate, pending, error }: { onCreate: () => void; pending: boolean; error: string | null }) {
  return (
    <section aria-labelledby="adaptation-empty-heading" className="max-w-[780px]">
      <header className="border-b border-line pb-6">
        <p className="text-sm text-ink-faint">Screenplay</p>
        <h2 id="adaptation-empty-heading" className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">Start an adaptation.</h2>
        <p className="mt-3 max-w-[60ch] text-sm leading-6 text-ink-muted">Create a screenplay scene and keep its Markdown draft beside the story.</p>
      </header>
      <div className="mt-8 border-l-2 border-line pl-4">
        <p className="text-sm font-semibold text-ink">No adaptations yet</p>
        <p className="mt-2 max-w-[54ch] text-sm leading-6 text-ink-muted">A saved AI adaptation or a blank scene will appear here.</p>
        {error ? <p role="alert" className="mt-5 border-l-2 border-danger pl-3 text-sm text-danger">{error}</p> : null}
        <button type="button" onClick={onCreate} disabled={pending} className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Creating adaptation" : "New adaptation"}</button>
      </div>
    </section>
  );
}
