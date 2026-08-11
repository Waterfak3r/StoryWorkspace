"use client";

import * as React from "react";
import type { Adaptation } from "@/domain/adaptation";
import {
  AdaptationAutosaveCoordinator,
  type AdaptationAutosaveState,
  type AdaptationDraftPatch,
} from "./adaptation-autosave";
import type { AdaptationDraftStorage } from "./adaptation-draft-storage";
import { updateAdaptation } from "./workspace-api";

export type UseAdaptationAutosaveResult = {
  loading: boolean;
  state: AdaptationAutosaveState | null;
  getState: () => AdaptationAutosaveState | null;
  edit: (patch: AdaptationDraftPatch) => void;
  retry: () => Promise<boolean>;
  flush: () => Promise<boolean>;
  useServerVersion: () => boolean;
  keepMyDraft: () => Promise<boolean>;
};

function sessionStorageBoundary(): AdaptationDraftStorage | undefined {
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

export function useAdaptationAutosave({
  projectId,
  adaptation,
  onAdaptationChanged,
}: {
  projectId: string;
  adaptation: Adaptation;
  onAdaptationChanged: (adaptation: Adaptation) => void;
}): UseAdaptationAutosaveResult {
  const coordinatorRef = React.useRef<AdaptationAutosaveCoordinator | null>(null);
  const adaptationIdentity = `${projectId}:${adaptation.id}`;
  const initialAdaptationRef = React.useRef(adaptation);
  const callbackRef = React.useRef(onAdaptationChanged);
  const acknowledgedRevisionRef = React.useRef(adaptation.updatedAt);
  const [state, setState] = React.useState<AdaptationAutosaveState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [mountedIdentity, setMountedIdentity] = React.useState<string | null>(null);

  React.useEffect(() => {
    initialAdaptationRef.current = adaptation;
    callbackRef.current = onAdaptationChanged;
  }, [adaptation, onAdaptationChanged]);

  React.useEffect(() => {
    let active = true;
    const coordinator = new AdaptationAutosaveCoordinator({
      projectId,
      adaptation: initialAdaptationRef.current,
      storage: sessionStorageBoundary(),
      saveAdaptation: updateAdaptation,
    });
    coordinatorRef.current = coordinator;
    acknowledgedRevisionRef.current = coordinator.getState().acknowledgedUpdatedAt;
    setState(coordinator.getState());
    setLoading(false);
    setMountedIdentity(adaptationIdentity);

    const unsubscribe = coordinator.subscribe(() => {
      if (!active) {
        return;
      }
      const nextState = coordinator.getState();
      setState(nextState);
      if (nextState.acknowledgedUpdatedAt !== acknowledgedRevisionRef.current) {
        acknowledgedRevisionRef.current = nextState.acknowledgedUpdatedAt;
        callbackRef.current(nextState.acknowledgedAdaptation);
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
  }, [adaptationIdentity, projectId]);

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
  const edit = React.useCallback((patch: AdaptationDraftPatch) => coordinatorRef.current?.edit(patch), []);
  const retry = React.useCallback(() => coordinatorRef.current?.retry() ?? Promise.resolve(false), []);
  const flush = React.useCallback(() => coordinatorRef.current?.flush() ?? Promise.resolve(true), []);
  const useServerVersion = React.useCallback(() => coordinatorRef.current?.useServerVersion() ?? false, []);
  const keepMyDraft = React.useCallback(() => coordinatorRef.current?.keepMyDraft() ?? Promise.resolve(false), []);

  const ready = !loading && mountedIdentity === adaptationIdentity;
  return {
    loading: !ready,
    state: ready ? state : null,
    getState,
    edit,
    retry,
    flush,
    useServerVersion,
    keepMyDraft,
  };
}
