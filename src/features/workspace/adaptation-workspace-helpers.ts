import type { AdaptationAutosaveStatus, AdaptationDraft } from "./adaptation-autosave";

export function adaptationStatusLabel(status: AdaptationAutosaveStatus) {
  if (status === "saved") return "Saved";
  if (status === "dirty") return "Unsaved";
  if (status === "saving") return "Saving";
  if (status === "failed") return "Could not save";
  return "Review conflict";
}

export function adaptationConflictDraft(draft: AdaptationDraft, recoveryDraft: AdaptationDraft | null) {
  return recoveryDraft ?? draft;
}
