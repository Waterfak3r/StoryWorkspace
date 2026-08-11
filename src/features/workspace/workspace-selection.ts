export type SelectionDraftState<TDraft> = {
  draft: TDraft;
  dirty: false;
  error: null;
  notice: null;
};

/**
 * Keeps the form remount contract explicit: a null selection is a new record,
 * while every canonical record gets its own stable React key.
 */
export function workspaceSelectionKey(scope: string, selectedId: string | null) {
  return `${scope}:${selectedId ?? "new"}`;
}

/**
 * A confirmed selection change starts from canonical data and clears transient
 * form state. The workspace components apply this through their keyed mount.
 */
export function initializeSelectionDraft<TRecord, TDraft>(
  selectedId: string | null,
  records: readonly TRecord[],
  getId: (record: TRecord) => string,
  draftFor: (record: TRecord | undefined) => TDraft,
): SelectionDraftState<TDraft> {
  const selectedRecord = selectedId === null ? undefined : records.find((record) => getId(record) === selectedId);
  return {
    draft: draftFor(selectedRecord),
    dirty: false,
    error: null,
    notice: null,
  };
}
