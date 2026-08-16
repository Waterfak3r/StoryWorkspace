"use client";

import { useCallback, useEffect, useRef } from "react";

export const STUDIO_AUTOSAVE_MS = 800;

export function useDebouncedSave(options: {
  revision: string;
  dirty: boolean;
  blocked: boolean;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  debounceMs?: number;
}) {
  const saveRef = useRef(options.save);
  const isDirtyRef = useRef(options.isDirty);
  const blockedRef = useRef(options.blocked);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const debounceMs = options.debounceMs ?? STUDIO_AUTOSAVE_MS;

  useEffect(() => {
    saveRef.current = options.save;
    isDirtyRef.current = options.isDirty;
    blockedRef.current = options.blocked;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const run = useCallback(async (): Promise<boolean> => {
    if (blockedRef.current) {
      return false;
    }
    if (inflightRef.current) {
      const previous = await inflightRef.current;
      if (blockedRef.current) {
        return false;
      }
      if (!isDirtyRef.current()) {
        return previous;
      }
    }
    if (!isDirtyRef.current()) {
      return true;
    }

    const request = saveRef.current();
    inflightRef.current = request;
    try {
      return await request;
    } finally {
      if (inflightRef.current === request) {
        inflightRef.current = null;
      }
    }
  }, []);

  const flush = useCallback(async () => {
    clearTimer();
    return run();
  }, [clearTimer, run]);

  useEffect(() => {
    if (!options.dirty || options.blocked) {
      return;
    }
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void run();
    }, debounceMs);
    return clearTimer;
  }, [options.revision, options.dirty, options.blocked, debounceMs, clearTimer, run]);

  useEffect(() => clearTimer, [clearTimer]);

  return flush;
}
