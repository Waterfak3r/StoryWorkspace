import type {
  ComicsStylePresetId,
  StudioContextSnapshot,
  StudioEntity,
  StudioEntityKind,
  StudioGenerateMode,
  StudioProject,
  StudioProjectDialogue,
  StudioProjectSummary,
  StudioScene,
  StudioShot,
  StudioComicsBook,
  StudioPipelineGraph,
  StudioStoryOutline,
  StudioStoryTree,
  StudioStoryTreeVolume,
  StudioStyle,
  StudioWorkflowNode,
} from "@/studio/domain";
import type { StudioParseRun } from "@/studio/parse/schemas";

export type StudioFieldErrors = Record<string, string[]>;

export type StudioErrorEnvelope = {
  code: string;
  message: string;
  fieldErrors?: StudioFieldErrors;
  retryable: boolean;
};

export class StudioRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: StudioFieldErrors;
  readonly retryable: boolean;
  readonly current?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { fieldErrors?: StudioFieldErrors; retryable?: boolean; current?: unknown },
  ) {
    super(message);
    this.name = "StudioRequestError";
    this.status = status;
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
    this.retryable = options?.retryable ?? false;
    this.current = options?.current;
  }
}

type Envelope<T> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: StudioFieldErrors;
    retryable?: boolean;
  };
  current?: unknown;
};

export type StudioWorkspacePayload = {
  root: string;
  projects: StudioProjectSummary[];
};

export type ProviderKeySource = "user" | "env" | "default";

export type TextProtocol = "auto" | "chat" | "responses";

export type PublicTextProviderView = {
  baseUrl: string;
  model: string;
  protocol: TextProtocol;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  source: ProviderKeySource;
};

export type PublicImageProviderView = {
  baseUrl: string;
  model: string;
  size: string;
  quality: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  source: ProviderKeySource;
};

export type PublicProviderSettings = {
  text: PublicTextProviderView;
  image: PublicImageProviderView;
};

export type ProviderSettingsUpdate = {
  text?: {
    baseUrl?: string;
    model?: string;
    protocol?: TextProtocol;
    apiKey?: string;
    clearApiKey?: boolean;
  };
  image?: {
    baseUrl?: string;
    model?: string;
    size?: string;
    quality?: string;
    apiKey?: string;
    clearApiKey?: boolean;
  };
};

export type ScenePath = {
  volumeId: string;
  chapterId: string;
  sceneId: string;
};

export type StorySelection =
  | { kind: "volume"; volumeId: string }
  | { kind: "chapter"; volumeId: string; chapterId: string }
  | { kind: "scene"; volumeId: string; chapterId: string; sceneId: string };

export type SceneDraft = {
  title: string;
  script: string;
  intent: string;
};

export type ScenePatch = {
  title?: string;
  script?: string;
  intent?: string;
  characters?: string[];
  location?: string | null;
  props?: string[];
  costumes?: string[];
  expectedUpdatedAt: string;
};

export type EntityDraft = {
  name: string;
  description: string;
  visualBase: string;
  outfit: string;
  condition: string;
};

function jsonHeaders(init?: RequestInit): HeadersInit {
  return {
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
    ...init?.headers,
  };
}

async function studioRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: jsonHeaders(init),
      cache: "no-store",
    });
  } catch {
    throw new StudioRequestError(0, "NETWORK_ERROR", "The request could not be completed.", { retryable: true });
  }

  const payload = (await response.json().catch(() => ({}))) as Envelope<T>;

  if (!response.ok) {
    throw new StudioRequestError(
      response.status,
      payload.error?.code ?? "INTERNAL_ERROR",
      payload.error?.message ?? "The request could not be completed.",
      {
        fieldErrors: payload.error?.fieldErrors,
        retryable: payload.error?.retryable ?? false,
        current: payload.current,
      },
    );
  }

  if (payload.data === undefined) {
    throw new StudioRequestError(response.status, "INTERNAL_ERROR", "The workspace returned an empty response.", {
      retryable: true,
    });
  }

  return payload.data;
}

export async function getStudioWorkspace() {
  return studioRequest<StudioWorkspacePayload>("/api/studio/workspace");
}

export async function getStudioProviderSettings() {
  return studioRequest<PublicProviderSettings>("/api/studio/settings/providers");
}

export async function saveStudioProviderSettings(input: ProviderSettingsUpdate) {
  return studioRequest<PublicProviderSettings>("/api/studio/settings/providers", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function createStudioProject(title: string) {
  const data = await studioRequest<{ project: StudioProject }>("/api/studio/projects", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return data.project;
}

export async function getStudioProject(projectId: string) {
  const data = await studioRequest<{ project: StudioProject }>(`/api/studio/projects/${projectId}`);
  return data.project;
}

export async function updateStudioProject(projectId: string, input: { title: string; expectedUpdatedAt: string }) {
  const data = await studioRequest<{ project: StudioProject }>(`/api/studio/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.project;
}

export async function getStudioTree(projectId: string): Promise<StudioStoryTree> {
  const data = await studioRequest<{ volumes: StudioStoryTreeVolume[] }>(`/api/studio/projects/${projectId}/tree`);
  return { volumes: data.volumes };
}

export async function getStudioOutline(projectId: string): Promise<StudioStoryOutline> {
  const data = await studioRequest<{ outline: StudioStoryOutline }>(`/api/studio/projects/${projectId}/outline`);
  return data.outline;
}

export type ComicsComposeMode = "page" | "panels";
export type ComicsPageLayout = "2" | "3" | "4" | "auto" | "marvel";

export type StudioComicsStylePreset = {
  id: ComicsStylePresetId;
  label: string;
  visual: string;
};

export type StudioStyleView = {
  style: StudioStyle & {
    compose?: ComicsComposeMode;
    layout?: ComicsPageLayout;
  };
  presets: StudioComicsStylePreset[];
};

export async function getStudioStyle(projectId: string) {
  return studioRequest<StudioStyleView>(`/api/studio/projects/${projectId}/style`);
}

export type SaveStudioStyleInput =
  | ComicsStylePresetId
  | {
      presetId?: ComicsStylePresetId;
      lettering?: "model" | "overlay";
      compose?: ComicsComposeMode;
      layout?: ComicsPageLayout;
    };

export async function saveStudioStyle(
  projectId: string,
  input: SaveStudioStyleInput,
) {
  const body = typeof input === "string" ? { presetId: input } : input;
  return studioRequest<StudioStyleView>(`/api/studio/projects/${projectId}/style`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function getStudioComics(projectId: string): Promise<StudioComicsBook> {
  const data = await studioRequest<{ book: StudioComicsBook }>(`/api/studio/projects/${projectId}/comics`);
  return data.book;
}

export async function createStudioVolume(projectId: string) {
  const data = await studioRequest<{ volume: { id: string; title: string; updatedAt: string } }>(
    `/api/studio/projects/${projectId}/volumes`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.volume;
}

export async function createStudioChapter(projectId: string, volumeId: string) {
  const data = await studioRequest<{ chapter: { id: string; title: string; updatedAt: string } }>(
    `/api/studio/projects/${projectId}/volumes/${volumeId}/chapters`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.chapter;
}

export async function createStudioScene(projectId: string, volumeId: string, chapterId: string) {
  const data = await studioRequest<{ scene: StudioScene }>(
    `/api/studio/projects/${projectId}/volumes/${volumeId}/chapters/${chapterId}/scenes`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.scene;
}

export async function deleteStudioVolume(projectId: string, volumeId: string) {
  return studioRequest<{ deleted: true }>(`/api/studio/projects/${projectId}/volumes/${volumeId}`, {
    method: "DELETE",
  });
}

export async function deleteStudioChapter(projectId: string, volumeId: string, chapterId: string) {
  return studioRequest<{ deleted: true }>(
    `/api/studio/projects/${projectId}/volumes/${volumeId}/chapters/${chapterId}`,
    { method: "DELETE" },
  );
}

export async function deleteStudioScene(
  projectId: string,
  volumeId: string,
  chapterId: string,
  sceneId: string,
) {
  return studioRequest<{ deleted: true }>(
    `/api/studio/projects/${projectId}/volumes/${volumeId}/chapters/${chapterId}/scenes/${sceneId}`,
    { method: "DELETE" },
  );
}

export function sceneUrl(projectId: string, path: ScenePath) {
  return `/api/studio/projects/${projectId}/volumes/${path.volumeId}/chapters/${path.chapterId}/scenes/${path.sceneId}`;
}

export async function getStudioScene(projectId: string, path: ScenePath) {
  const data = await studioRequest<{ scene: StudioScene }>(sceneUrl(projectId, path));
  return data.scene;
}

export async function updateStudioScene(projectId: string, path: ScenePath, input: ScenePatch) {
  const data = await studioRequest<{ scene: StudioScene }>(sceneUrl(projectId, path), {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.scene;
}

export async function directStudioScene(projectId: string, path: ScenePath) {
  const data = await studioRequest<{ scene: StudioScene }>(`${sceneUrl(projectId, path)}/director`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.scene;
}

export async function confirmStudioSceneDialogue(projectId: string, path: ScenePath) {
  const data = await studioRequest<{ scene: StudioScene }>(`${sceneUrl(projectId, path)}/dialogue/confirm`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return data.scene;
}

export async function confirmStudioProjectDialogue(projectId: string) {
  const data = await studioRequest<{ scenes: StudioScene[] }>(
    `/api/studio/projects/${projectId}/dialogue/confirm`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.scenes;
}

export async function listStudioShots(projectId: string, path: ScenePath) {
  const data = await studioRequest<{ shots: StudioShot[] }>(`${sceneUrl(projectId, path)}/shots`);
  return data.shots;
}

export async function updateStudioShot(
  projectId: string,
  path: ScenePath,
  shotId: string,
  input: ShotDraft & { expectedUpdatedAt: string },
) {
  const data = await studioRequest<{ shot: StudioShot }>(`${sceneUrl(projectId, path)}/shots/${shotId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.shot;
}

export async function getStudioContextSnapshot(projectId: string, path: ScenePath, shotId: string) {
  const data = await studioRequest<{ snapshot: StudioContextSnapshot }>(
    `${sceneUrl(projectId, path)}/context?shotId=${encodeURIComponent(shotId)}`,
  );
  return data.snapshot;
}

export async function generateStudioShot(
  projectId: string,
  path: ScenePath,
  shotId: string,
  mode?: StudioGenerateMode,
) {
  const data = await studioRequest<{ shot: StudioShot; node: StudioWorkflowNode; continuityConstraints: string }>(
    `${sceneUrl(projectId, path)}/shots/${shotId}/generate`,
    { method: "POST", body: JSON.stringify(mode ? { mode } : {}) },
  );
  return data;
}

export async function lockStudioShot(projectId: string, path: ScenePath, shotId: string, locked: boolean) {
  const data = await studioRequest<{ shot: StudioShot; node: StudioWorkflowNode }>(
    `${sceneUrl(projectId, path)}/shots/${shotId}/lock`,
    { method: "POST", body: JSON.stringify({ locked }) },
  );
  return data;
}

export function studioImageUrl(projectId: string, relativePath: string) {
  const trimmed = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !trimmed.startsWith("outputs/images/")
    && !trimmed.startsWith("outputs/comics/")
    && !trimmed.startsWith("assets/images/")
  ) {
    return "";
  }
  return `/api/studio/projects/${projectId}/files/${trimmed.split("/").map(encodeURIComponent).join("/")}`;
}

export async function getStudioWorkflow(projectId: string) {
  return studioRequest<{
    pipeline: StudioPipelineGraph;
    nodes: StudioWorkflowNode[];
    dialogue: StudioProjectDialogue;
  }>(`/api/studio/projects/${projectId}/workflow`);
}

export async function rerunStudioWorkflowNode(projectId: string, shotId: string) {
  const data = await studioRequest<{ shot: StudioShot; node: StudioWorkflowNode; continuityConstraints: string }>(
    `/api/studio/projects/${projectId}/workflow/nodes/${shotId}/rerun`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data;
}

export type StudioWorkflowStartResult = {
  directed: string[];
  confirmed: string[];
  generated: string[];
  skipped: string[];
};

export async function startStudioWorkflow(projectId: string): Promise<StudioWorkflowStartResult> {
  const data = await studioRequest<{ data?: StudioWorkflowStartResult } | StudioWorkflowStartResult>(
    `/api/studio/projects/${projectId}/workflow/start`,
    { method: "POST", body: JSON.stringify({}) },
  );
  if ("data" in data && data.data) {
    return data.data;
  }
  return data as StudioWorkflowStartResult;
}

export type ShotDraft = {
  purpose: string;
  action: string;
  camera: string;
};

export function shotDraftFrom(shot: StudioShot): ShotDraft {
  return { purpose: shot.purpose, action: shot.action, camera: shot.camera };
}

export function shotDraftsEqual(left: ShotDraft, right: ShotDraft) {
  return left.purpose === right.purpose && left.action === right.action && left.camera === right.camera;
}

export async function listStudioEntities(projectId: string, kind: StudioEntityKind) {
  const data = await studioRequest<{ entities: StudioEntity[] }>(
    `/api/studio/projects/${projectId}/entities?kind=${kind}`,
  );
  return data.entities;
}

export async function createStudioEntity(projectId: string, input: { kind: StudioEntityKind; name: string }) {
  const data = await studioRequest<{ entity: StudioEntity }>(`/api/studio/projects/${projectId}/entities`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.entity;
}

export async function getStudioEntity(projectId: string, entityId: string) {
  const data = await studioRequest<{ entity: StudioEntity }>(`/api/studio/projects/${projectId}/entities/${entityId}`);
  return data.entity;
}

export async function completeStudioEntityReference(projectId: string, entityId: string) {
  const data = await studioRequest<{ entity: StudioEntity; relativePath: string }>(
    `/api/studio/projects/${projectId}/entities/${entityId}/references/complete`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.entity;
}

export async function uploadStudioEntityReference(projectId: string, entityId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch(`/api/studio/projects/${projectId}/entities/${entityId}/references`, {
      method: "POST",
      body,
      cache: "no-store",
    });
  } catch {
    throw new StudioRequestError(0, "NETWORK_ERROR", "The request could not be completed.", { retryable: true });
  }

  const payload = (await response.json().catch(() => ({}))) as Envelope<{ entity: StudioEntity }>;
  if (!response.ok) {
    throw new StudioRequestError(
      response.status,
      payload.error?.code ?? "INTERNAL_ERROR",
      payload.error?.message ?? "The request could not be completed.",
      {
        fieldErrors: payload.error?.fieldErrors,
        retryable: payload.error?.retryable ?? false,
        current: (payload as { current?: unknown }).current,
      },
    );
  }
  if (!payload.data?.entity) {
    throw new StudioRequestError(response.status, "INTERNAL_ERROR", "The workspace returned an empty response.", {
      retryable: true,
    });
  }
  return payload.data.entity;
}

export async function updateStudioEntity(
  projectId: string,
  entityId: string,
  input: {
    name: string;
    description: string;
    visual: { base: string; references: string[] };
    states: { default: { outfit: string; condition: string } };
    expectedUpdatedAt: string;
  },
) {
  const data = await studioRequest<{ entity: StudioEntity }>(`/api/studio/projects/${projectId}/entities/${entityId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.entity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readConflictScene(error: StudioRequestError): StudioScene | null {
  const value = error.current;
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || typeof value.updatedAt !== "string") {
    return null;
  }
  if (typeof value.title !== "string" || typeof value.script !== "string" || typeof value.intent !== "string") {
    return null;
  }
  return value as StudioScene;
}

export function readConflictEntity(error: StudioRequestError): StudioEntity | null {
  const value = error.current;
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.id !== "string" || typeof value.updatedAt !== "string" || typeof value.name !== "string") {
    return null;
  }
  if (value.kind !== "character" && value.kind !== "location") {
    return null;
  }
  return value as StudioEntity;
}

export function sceneDraftFrom(scene: StudioScene): SceneDraft {
  return { title: scene.title, script: scene.script, intent: scene.intent };
}

export function sceneDraftsEqual(left: SceneDraft, right: SceneDraft) {
  return left.title === right.title && left.script === right.script && left.intent === right.intent;
}

export function entityDraftFrom(entity: StudioEntity): EntityDraft {
  return {
    name: entity.name,
    description: entity.description,
    visualBase: entity.visual.base,
    outfit: entity.states.default.outfit,
    condition: entity.states.default.condition,
  };
}

export function entityDraftsEqual(left: EntityDraft, right: EntityDraft) {
  return (
    left.name === right.name
    && left.description === right.description
    && left.visualBase === right.visualBase
    && left.outfit === right.outfit
    && left.condition === right.condition
  );
}

export async function listStudioParseRuns(projectId: string) {
  const data = await studioRequest<{ runs: StudioParseRun[] }>(`/api/studio/projects/${projectId}/parse`);
  return data.runs;
}

export async function parseStudioText(projectId: string, text: string) {
  const data = await studioRequest<{ run: StudioParseRun }>(`/api/studio/projects/${projectId}/parse`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return data.run;
}

export async function confirmStudioParseRun(
  projectId: string,
  runId: string,
  input?: { overwriteCanon?: string[]; volumeId?: string; chapterId?: string },
) {
  const body: { overwriteCanon?: string[]; volumeId?: string; chapterId?: string } = {};
  if (input?.overwriteCanon) {
    body.overwriteCanon = input.overwriteCanon;
  }
  if (input?.volumeId) {
    body.volumeId = input.volumeId;
  }
  if (input?.chapterId) {
    body.chapterId = input.chapterId;
  }

  const data = await studioRequest<{ run: StudioParseRun; scenes: StudioScene[]; entities: StudioEntity[] }>(
    `/api/studio/projects/${projectId}/parse/${runId}/confirm`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  return data;
}

export async function rejectStudioParseRun(projectId: string, runId: string) {
  const data = await studioRequest<{ run: StudioParseRun }>(
    `/api/studio/projects/${projectId}/parse/${runId}/reject`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return data.run;
}

export function listScenePaths(tree: StudioStoryTree): ScenePath[] {
  const paths: ScenePath[] = [];
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      for (const scene of chapter.scenes) {
        paths.push({ volumeId: volume.id, chapterId: chapter.id, sceneId: scene.id });
      }
    }
  }
  return paths;
}

export function findScenePathInTree(tree: StudioStoryTree, sceneId: string): ScenePath | null {
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      if (chapter.scenes.some((scene) => scene.id === sceneId)) {
        return { volumeId: volume.id, chapterId: chapter.id, sceneId };
      }
    }
  }
  return null;
}

export function firstScenePath(tree: StudioStoryTree): ScenePath | null {
  for (const volume of tree.volumes) {
    for (const chapter of volume.chapters) {
      const scene = chapter.scenes[0];
      if (scene) {
        return { volumeId: volume.id, chapterId: chapter.id, sceneId: scene.id };
      }
    }
  }
  return null;
}

export function firstStorySelection(tree: StudioStoryTree): StorySelection | null {
  const scene = firstScenePath(tree);
  if (scene) {
    return { kind: "scene", ...scene };
  }

  for (const volume of tree.volumes) {
    const chapter = volume.chapters[0];
    if (chapter) {
      return { kind: "chapter", volumeId: volume.id, chapterId: chapter.id };
    }
  }

  const volume = tree.volumes[0];
  return volume ? { kind: "volume", volumeId: volume.id } : null;
}

export function storySelectionExists(tree: StudioStoryTree, selected: StorySelection): boolean {
  const volume = tree.volumes.find((item) => item.id === selected.volumeId);
  if (!volume) {
    return false;
  }
  if (selected.kind === "volume") {
    return true;
  }
  const chapter = volume.chapters.find((item) => item.id === selected.chapterId);
  if (!chapter) {
    return false;
  }
  if (selected.kind === "chapter") {
    return true;
  }
  return chapter.scenes.some((item) => item.id === selected.sceneId);
}

export function countStoryTree(tree: StudioStoryTree) {
  let chapters = 0;
  let scenes = 0;
  for (const volume of tree.volumes) {
    chapters += volume.chapters.length;
    for (const chapter of volume.chapters) {
      scenes += chapter.scenes.length;
    }
  }
  return { volumes: tree.volumes.length, chapters, scenes };
}
