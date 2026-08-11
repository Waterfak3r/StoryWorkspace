export type ExportPreviewCounts = {
  bibleEntries: number;
  outlineNodes: number;
  chapters: number;
  adaptations: number;
};

export type ExportPreviewSection = {
  id: "project" | "bible" | "outline" | "chapters" | "adaptations";
  label: string;
  count: number;
};

export function exportPreviewSections(counts: ExportPreviewCounts): ExportPreviewSection[] {
  return [
    { id: "project", label: "Project", count: 1 },
    { id: "bible", label: "Story bible entries", count: counts.bibleEntries },
    { id: "outline", label: "Outline nodes", count: counts.outlineNodes },
    { id: "chapters", label: "Chapters", count: counts.chapters },
    { id: "adaptations", label: "Adaptations", count: counts.adaptations },
  ];
}
