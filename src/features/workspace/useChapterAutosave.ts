"use client";

import * as React from "react";
import type { Chapter } from "@/domain/narrative";
import {
  ChapterAutosaveCoordinator,
  type ChapterAutosaveState,
  type ChapterDraft,
  type ChapterDraftPatch,
} from "./chapter-autosave";
import type { ChapterDraftStorage } from "./chapter-draft-storage";
import { createManualChapterVersion, updateChapter } from "./workspace-api";

export type UseChapterAutosaveResult = {
  loading: boolean;
  state: ChapterAutosaveState | null;
  getState: () => ChapterAutosaveState | null;
  edit: (patch: ChapterDraftPatch) => void;
  retry: () => Promise<boolean>;
  flush: () => Promise<boolean>;
  useServerVersion: () => boolean;
  keepMyDraft: () => Promise<boolean>;
  applyCanonicalChapter: (chapter: Chapter) => boolean;
  reportExternalConflict: (chapter: Chapter, draft?: ChapterDraft) => boolean;
};

function sessionStorageBoundary(): ChapterDraftStorage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const storage = window.sessionStorage;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  } catch {
    return undefined;
  }
}

export function useChapterAutosave({
  projectId,
  chapter,
  onChapterChanged,
}: {
  projectId: string;
  chapter: Chapter;
  onChapterChanged: (chapter: Chapter) => void;
}): UseChapterAutosaveResult {
  const coordinatorRef = React.useRef<ChapterAutosaveCoordinator | null>(null);
  const chapterIdentity = `${projectId}:${chapter.id}`;
  const initialChapterRef = React.useRef(chapter);
  const callbackRef = React.useRef(onChapterChanged);
  const acknowledgedRevisionRef = React.useRef(chapter.updatedAt);
  const [state, setState] = React.useState<ChapterAutosaveState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [mountedIdentity, setMountedIdentity] = React.useState<string | null>(null);

  React.useEffect(() => {
    initialChapterRef.current = chapter;
    callbackRef.current = onChapterChanged;
  }, [chapter, onChapterChanged]);

  React.useEffect(() => {
    let active = true;
    const coordinator = new ChapterAutosaveCoordinator({
      projectId,
      chapter: initialChapterRef.current,
      storage: sessionStorageBoundary(),
      saveChapter: updateChapter,
      createManualSnapshot: async (chapterId) => createManualChapterVersion(chapterId),
    });
    coordinatorRef.current = coordinator;
    acknowledgedRevisionRef.current = coordinator.getState().acknowledgedUpdatedAt;
    setState(coordinator.getState());
    setLoading(false);
    setMountedIdentity(chapterIdentity);

    const unsubscribe = coordinator.subscribe(() => {
      if (!active) {
        return;
      }
      const nextState = coordinator.getState();
      setState(nextState);
      if (nextState.acknowledgedUpdatedAt !== acknowledgedRevisionRef.current) {
        acknowledgedRevisionRef.current = nextState.acknowledgedUpdatedAt;
        callbackRef.current(nextState.acknowledgedChapter);
      }
    });

    return () => {
      active = false;
      unsubscribe();
      coordinator.dispose();
      if (coordinatorRef.current === coordinator) {
        coordinatorRef.current = null;
      }
    };
  }, [chapterIdentity, projectId]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !state || !["dirty", "saving", "failed", "conflict"].includes(state.status)) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state]);

  const getState = React.useCallback(() => coordinatorRef.current?.getState() ?? null, []);
  const edit = React.useCallback((patch: ChapterDraftPatch) => {
    coordinatorRef.current?.edit(patch);
  }, []);
  const retry = React.useCallback(() => coordinatorRef.current?.retry() ?? Promise.resolve(false), []);
  const flush = React.useCallback(() => coordinatorRef.current?.flush() ?? Promise.resolve(true), []);
  const useServerVersion = React.useCallback(() => coordinatorRef.current?.useServerVersion() ?? false, []);
  const keepMyDraft = React.useCallback(() => coordinatorRef.current?.keepMyDraft() ?? Promise.resolve(false), []);
  const applyCanonicalChapter = React.useCallback((canonical: Chapter) => coordinatorRef.current?.applyCanonicalChapter(canonical) ?? false, []);
  const reportExternalConflict = React.useCallback((canonical: Chapter, draft?: ChapterDraft) => coordinatorRef.current?.reportExternalConflict(canonical, draft) ?? false, []);

  const ready = !loading && mountedIdentity === chapterIdentity;

  return {
    loading: !ready,
    state: ready ? state : null,
    getState,
    edit,
    retry,
    flush,
    useServerVersion,
    keepMyDraft,
    applyCanonicalChapter,
    reportExternalConflict,
  };
}
