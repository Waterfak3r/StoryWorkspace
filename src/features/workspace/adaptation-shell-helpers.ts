import type { Adaptation } from "@/domain/adaptation";

export function sortAdaptations(adaptations: Adaptation[]) {
  return [...adaptations].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function adaptationSelectionAfterDelete(adaptations: Adaptation[], deletedId: string, selectedId: string | null) {
  if (selectedId !== deletedId) {
    return selectedId;
  }
  const remaining = sortAdaptations(adaptations.filter((adaptation) => adaptation.id !== deletedId));
  const deletedIndex = sortAdaptations(adaptations).findIndex((adaptation) => adaptation.id === deletedId);
  return remaining[Math.min(Math.max(deletedIndex, 0), Math.max(remaining.length - 1, 0))]?.id ?? null;
}

export function replaceCanonicalAdaptation(adaptations: Adaptation[], canonical: Adaptation) {
  return sortAdaptations(adaptations.some((adaptation) => adaptation.id === canonical.id)
    ? adaptations.map((adaptation) => adaptation.id === canonical.id ? canonical : adaptation)
    : [...adaptations, canonical]);
}
