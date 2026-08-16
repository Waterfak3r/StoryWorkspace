export const STUDIO_SECTIONS = ["overview", "story", "entities", "workflow", "outputs", "settings"] as const;

export type StudioSection = (typeof STUDIO_SECTIONS)[number];

export function parseStudioSection(value: string | null | undefined): StudioSection {
  if (value && (STUDIO_SECTIONS as readonly string[]).includes(value)) {
    return value as StudioSection;
  }
  return "overview";
}

export function studioSectionHref(projectId: string, section: StudioSection) {
  if (section === "overview") {
    return `/projects/${projectId}`;
  }
  return `/projects/${projectId}?section=${section}`;
}

export function readSectionParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return parseStudioSection(value[0]);
  }
  return parseStudioSection(value);
}
