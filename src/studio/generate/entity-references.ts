import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { StudioEntityKind } from "../domain";
import { nextNumberedId } from "../domain";
import { StudioValidationError } from "../errors";
import { readEntity, readProject, updateEntity } from "../fs";
import { assertStudioId, resolveUnderWorkspace } from "../fs/paths";
import { getWorkspaceRoot } from "../fs/workspace";

export const MAX_ENTITY_REFERENCE_IMAGES = 4;

const KIND_RANK: Record<StudioEntityKind, number> = {
  character: 0,
  costume: 1,
  location: 2,
  prop: 3,
};

const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*\.(png|jpg|jpeg|webp)$/i;

export type EntityReferenceSource = {
  id: string;
  name: string;
  kind: StudioEntityKind;
  visual: { references: readonly string[] };
};

export type LoadedEntityReferenceImage = {
  entityId: string;
  entityName: string;
  kind: StudioEntityKind;
  relativePath: string;
  filename: string;
  mime: string;
  bytes: Buffer;
};

export function loadEntityReferenceImages(
  projectId: string,
  entities: readonly EntityReferenceSource[],
): LoadedEntityReferenceImage[] {
  readProject(projectId);
  const ordered = [...entities].sort((left, right) => {
    const rank = KIND_RANK[left.kind] - KIND_RANK[right.kind];
    if (rank !== 0) {
      return rank;
    }
    return left.id.localeCompare(right.id);
  });

  const loaded: LoadedEntityReferenceImage[] = [];
  const seenEntities = new Set<string>();

  for (const entity of ordered) {
    if (loaded.length >= MAX_ENTITY_REFERENCE_IMAGES || seenEntities.has(entity.id)) {
      continue;
    }
    for (const relativePath of entity.visual.references) {
      const file = tryResolveEntityReferenceFile(projectId, relativePath);
      if (!file) {
        continue;
      }
      loaded.push({
        entityId: entity.id,
        entityName: entity.name,
        kind: entity.kind,
        relativePath: file.relativePath,
        filename: `${entity.id}-${path.basename(file.relativePath)}`,
        mime: file.mime,
        bytes: fs.readFileSync(file.absolutePath),
      });
      seenEntities.add(entity.id);
      break;
    }
  }

  return loaded;
}

export function identityReferencePromptLines(refs: readonly LoadedEntityReferenceImage[]): string[] {
  if (refs.length === 0) {
    return [];
  }
  return [
    "Match identity from the attached reference images. Do not invent a new likeness.",
    ...refs.map(
      (ref, index) =>
        `Attached image ${index + 1}: ${ref.kind} ${ref.entityName} (${ref.relativePath}). Keep this exact appearance.`,
    ),
  ];
}

export function addEntityReferenceImage(
  projectId: string,
  entityId: string,
  bytes: Buffer,
  originalName: string,
): { entity: ReturnType<typeof readEntity>; relativePath: string } {
  const entity = readEntity(projectId, entityId);
  const ext = extensionFor(bytes, originalName);
  const existing = entity.visual.references
    .map((item) => path.posix.basename(item.replace(/\\/g, "/")))
    .map((name) => name.replace(/\.[^.]+$/, ""));
  const stem = nextNumberedId("ref", existing);
  const relativePath = `assets/images/${entity.id}/${stem}${ext}`;
  const absolutePath = resolveEntityReferenceAbsolute(projectId, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);

  const next = updateEntity(projectId, entity.id, {
    visual: { ...entity.visual, references: [...entity.visual.references, relativePath] },
    expectedUpdatedAt: entity.updatedAt,
  });
  return { entity: next, relativePath };
}

export function tryResolveEntityReferenceFile(
  projectId: string,
  relativePath: string,
): { relativePath: string; absolutePath: string; mime: string } | null {
  try {
    return resolveEntityReferenceFile(projectId, relativePath);
  } catch {
    return null;
  }
}

export function resolveEntityReferenceFile(
  projectId: string,
  relativePath: string,
): { relativePath: string; absolutePath: string; mime: string } {
  const project = assertStudioId(projectId, "projectId");
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (parts.length !== 4 || parts[0] !== "assets" || parts[1] !== "images") {
    throw new StudioValidationError("Invalid reference path.", "path");
  }

  const entityId = assertStudioId(parts[2] ?? "", "entityId");
  const file = parts[3] ?? "";
  if (!FILE_NAME_PATTERN.test(file)) {
    throw new StudioValidationError("Invalid reference path.", "path");
  }

  readProject(project);
  const absolutePath = resolveEntityReferenceAbsolute(project, normalized);
  if (!fs.existsSync(absolutePath)) {
    throw new StudioValidationError("Reference image not found.", "path");
  }
  return { relativePath: normalized, absolutePath, mime: mimeFor(file) };
}

function resolveEntityReferenceAbsolute(projectId: string, relativePath: string): string {
  const parts = relativePath.replace(/\\/g, "/").split("/");
  return resolveUnderWorkspace(getWorkspaceRoot(), [projectId, ...parts]);
}

function extensionFor(bytes: Buffer, originalName: string): ".png" | ".jpg" | ".webp" {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return ".png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ".jpg";
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return ".webp";
  }
  const lower = originalName.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    throw new StudioValidationError("Reference image bytes do not match the file type.");
  }
  throw new StudioValidationError("Reference image must be a PNG, JPEG, or WebP file.");
}

function mimeFor(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/jpeg";
}
