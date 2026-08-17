import { z } from "zod";

import { STUDIO_SLUG_REGEX } from "./ids";

export const STUDIO_SCHEMA_VERSION = 1 as const;

export const studioIdSchema = z
  .string()
  .regex(STUDIO_SLUG_REGEX, "Id must be a lowercase slug of 1–63 characters");

// Zod 4: z.string().datetime is deprecated; timestamps are ISO-8601 like 2026-03-27T00:00:00.000Z.
export const studioTimestampSchema = z.iso.datetime();

export const projectRecordSchema = z.strictObject({
  schemaVersion: z.literal(STUDIO_SCHEMA_VERSION),
  id: studioIdSchema,
  title: z.string().min(1),
  createdAt: studioTimestampSchema,
  updatedAt: studioTimestampSchema,
});

export const projectSummarySchema = z.strictObject({
  id: studioIdSchema,
  title: z.string().min(1),
  updatedAt: studioTimestampSchema,
});

export const volumeRecordSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string().min(1),
  updatedAt: studioTimestampSchema,
});

export const chapterRecordSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string().min(1),
  updatedAt: studioTimestampSchema,
});

export const parseProvenanceSchema = z.strictObject({
  source: z.literal("parse"),
  parseRunId: studioIdSchema,
  confirmedAt: studioTimestampSchema,
});

export const shotStatusSchema = z.enum(["pending", "success", "failed", "locked"]);

export const shotRecordSchema = z.strictObject({
  id: studioIdSchema,
  scene_id: studioIdSchema,
  purpose: z.string(),
  action: z.string(),
  camera: z.string(),
  continuity_from: z.string().nullable(),
  status: shotStatusSchema,
  selected_image: z.string().nullable(),
  updatedAt: studioTimestampSchema,
});

export const sceneRecordSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string(),
  script: z.string(),
  intent: z.string(),
  characters: z.array(z.string()),
  location: z.string().nullable(),
  props: z.array(z.string()),
  costumes: z.array(z.string()).default([]),
  shots: z.array(shotRecordSchema).default([]),
  updatedAt: studioTimestampSchema,
  provenance: parseProvenanceSchema.optional(),
  canonFields: z.array(z.string()).optional(),
});

export const STUDIO_ENTITY_KINDS = ["character", "location", "prop", "costume"] as const;

export const entityKindSchema = z.enum(STUDIO_ENTITY_KINDS);

export const ENTITY_KIND_DIRS: Record<(typeof STUDIO_ENTITY_KINDS)[number], string> = {
  character: "characters",
  location: "locations",
  prop: "props",
  costume: "costumes",
};

export const entityVisualSchema = z.strictObject({
  base: z.string(),
  references: z.array(z.string()),
});

export const entityDefaultStateSchema = z.strictObject({
  outfit: z.string(),
  condition: z.string(),
});

export const entityStatesSchema = z.strictObject({
  default: entityDefaultStateSchema,
});

export const entityRecordSchema = z.strictObject({
  id: studioIdSchema,
  kind: entityKindSchema,
  name: z.string().min(1),
  description: z.string(),
  visual: entityVisualSchema,
  states: entityStatesSchema,
  updatedAt: studioTimestampSchema,
  provenance: parseProvenanceSchema.optional(),
  canonFields: z.array(z.string()).optional(),
});

export const COMICS_STYLE_PRESET_IDS = [
  "sequential-ink",
  "shonen-manga",
  "ligne-claire",
  "watercolor-indie",
  "noir-comics",
] as const;

export const comicsStylePresetIdSchema = z.enum(COMICS_STYLE_PRESET_IDS);

export const styleRecordSchema = z.strictObject({
  id: z.literal("default"),
  presetId: comicsStylePresetIdSchema.optional(),
  label: z.string(),
  visual: z.string(),
  updatedAt: studioTimestampSchema,
});

export const updateStyleInputSchema = z.strictObject({
  presetId: comicsStylePresetIdSchema,
});

export const DEFAULT_COMICS_STYLE_PRESET_ID = "sequential-ink" as const;

export const DEFAULT_COMICS_STYLE_VISUAL =
  "Sequential comic stills; consistent inked character designs reused across shots; muted watercolor palette; cinematic comic framing; no photorealism; leave space for speech balloons.";

export const storyOutlineEntityRefSchema = z.strictObject({
  id: studioIdSchema,
  kind: entityKindSchema,
  name: z.string(),
});

export const storyOutlineBeatSchema = z.strictObject({
  id: studioIdSchema,
  purpose: z.string(),
  action: z.string(),
  camera: z.string(),
});

export const storyOutlineSceneSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string(),
  intent: z.string(),
  plot: z.string(),
  environment: storyOutlineEntityRefSchema.nullable(),
  entities: z.array(storyOutlineEntityRefSchema),
  beats: z.array(storyOutlineBeatSchema),
});

export const storyOutlineChapterSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string(),
  scenes: z.array(storyOutlineSceneSchema),
});

export const storyOutlineVolumeSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string(),
  chapters: z.array(storyOutlineChapterSchema),
});

export const storyTimelineCharacterSchema = z.strictObject({
  id: studioIdSchema,
  name: z.string(),
});

export const storyTimelineEventSchema = z.strictObject({
  id: studioIdSchema,
  sequence: z.number().int().min(0),
  title: z.string(),
  volumeId: studioIdSchema,
  chapterId: studioIdSchema,
  sceneId: studioIdSchema,
  summary: z.string(),
  participantIds: z.array(studioIdSchema),
});

export const storyTimelineIntersectionSchema = z.strictObject({
  characterId: studioIdSchema,
  eventId: studioIdSchema,
});

export const storyTimelineConnectionSchema = z.strictObject({
  fromEventId: studioIdSchema,
  toEventId: studioIdSchema,
});

export const storyTimelineSchema = z.strictObject({
  axis: z.literal("sequence"),
  events: z.array(storyTimelineEventSchema),
  characters: z.array(storyTimelineCharacterSchema),
  intersections: z.array(storyTimelineIntersectionSchema),
  connections: z.array(storyTimelineConnectionSchema),
});

export const storyOutlineSchema = z.strictObject({
  projectId: studioIdSchema,
  title: z.string(),
  timeline: storyTimelineSchema,
  volumes: z.array(storyOutlineVolumeSchema),
});

export const COMICS_PANELS_PER_PAGE = 4;

export const attributedSpeechLineSchema = z.strictObject({
  id: z.string().min(1),
  speaker: z.string().min(1),
  speakerId: studioIdSchema.nullable(),
  text: z.string().min(1),
});

export const letteringBalloonSchema = z.strictObject({
  id: z.string().min(1),
  speaker: z.string().min(1),
  speakerId: studioIdSchema.nullable(),
  text: z.string().min(1),
  panelIndex: z.number().int().min(0).max(COMICS_PANELS_PER_PAGE - 1),
  shotId: studioIdSchema,
  kind: z.literal("speech"),
});

export const projectDialogueShotSchema = z.strictObject({
  shotId: studioIdSchema,
  action: z.string(),
  purpose: z.string(),
  lines: z.array(attributedSpeechLineSchema),
});

export const projectDialogueSceneSchema = z.strictObject({
  volumeId: studioIdSchema,
  chapterId: studioIdSchema,
  sceneId: studioIdSchema,
  title: z.string(),
  unassigned: z.array(attributedSpeechLineSchema),
  shots: z.array(projectDialogueShotSchema),
});

export const projectDialogueSchema = z.strictObject({
  projectId: studioIdSchema,
  lineCount: z.number().int().min(0),
  scenes: z.array(projectDialogueSceneSchema),
});

export const comicsPanelSchema = z.strictObject({
  pageIndex: z.number().int().min(0),
  panelIndex: z.number().int().min(0).max(COMICS_PANELS_PER_PAGE - 1),
  volumeId: studioIdSchema,
  chapterId: studioIdSchema,
  sceneId: studioIdSchema,
  shotId: studioIdSchema,
  stillPath: z.string().min(1),
  caption: z.string(),
  speech: z.array(attributedSpeechLineSchema).default([]),
});

export const comicsPageSchema = z.strictObject({
  index: z.number().int().min(0),
  pageImage: z.string().min(1),
  panels: z.array(comicsPanelSchema).min(1).max(COMICS_PANELS_PER_PAGE),
  lettering: z.array(letteringBalloonSchema).default([]),
});

export const pipelineStageIdSchema = z.enum(["text", "import", "storyboard", "dialogue", "comics"]);

export const pipelineStageStatusSchema = z.enum(["pending", "success", "failed", "running"]);

export const pipelineStageSchema = z.strictObject({
  id: pipelineStageIdSchema,
  label: z.string(),
  status: pipelineStageStatusSchema,
  statusLabel: z.enum(["待跑", "成功", "失败", "进行中"]),
});

export const pipelineEdgeSchema = z.strictObject({
  from: pipelineStageIdSchema,
  to: pipelineStageIdSchema,
});

export const pipelineGraphSchema = z.strictObject({
  stages: z.array(pipelineStageSchema).min(4),
  edges: z.array(pipelineEdgeSchema),
});

export const comicsBookSchema = z.strictObject({
  projectId: studioIdSchema,
  title: z.string(),
  pages: z.array(comicsPageSchema),
});

export const storyTreeSceneSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string(),
  updatedAt: studioTimestampSchema,
});

export const storyTreeChapterSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string(),
  updatedAt: studioTimestampSchema,
  scenes: z.array(storyTreeSceneSchema),
});

export const storyTreeVolumeSchema = z.strictObject({
  id: studioIdSchema,
  title: z.string(),
  updatedAt: studioTimestampSchema,
  chapters: z.array(storyTreeChapterSchema),
});

export const storyTreeSchema = z.strictObject({
  volumes: z.array(storyTreeVolumeSchema),
});

const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(120, "Title must be 120 characters or fewer");

const optionalTitleSchema = titleSchema.optional();

export const createProjectInputSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, "Project title is required")
    .max(120, "Project title must be 120 characters or fewer"),
  id: studioIdSchema.optional(),
});

export const updateProjectInputSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, "Project title is required")
    .max(120, "Project title must be 120 characters or fewer"),
  expectedUpdatedAt: studioTimestampSchema,
});

export const createVolumeInputSchema = z.strictObject({
  title: optionalTitleSchema,
  id: studioIdSchema.optional(),
});

export const updateVolumeInputSchema = z.strictObject({
  title: titleSchema,
  expectedUpdatedAt: studioTimestampSchema,
});

export const createChapterInputSchema = z.strictObject({
  title: optionalTitleSchema,
  id: studioIdSchema.optional(),
});

export const updateChapterInputSchema = z.strictObject({
  title: titleSchema,
  expectedUpdatedAt: studioTimestampSchema,
});

export const createSceneInputSchema = z.strictObject({
  title: optionalTitleSchema,
  id: studioIdSchema.optional(),
});

export const updateSceneInputSchema = z.strictObject({
  title: optionalTitleSchema,
  script: z.string().optional(),
  intent: z.string().optional(),
  characters: z.array(z.string()).optional(),
  location: z.string().nullable().optional(),
  props: z.array(z.string()).optional(),
  costumes: z.array(z.string()).optional(),
  provenance: parseProvenanceSchema.optional(),
  canonFields: z.array(z.string()).optional(),
  expectedUpdatedAt: studioTimestampSchema,
});

export const updateShotInputSchema = z.strictObject({
  purpose: z.string().optional(),
  action: z.string().optional(),
  camera: z.string().optional(),
  continuity_from: z.string().nullable().optional(),
  status: shotStatusSchema.optional(),
  selected_image: z.string().nullable().optional(),
  expectedUpdatedAt: studioTimestampSchema,
});

export const contextSnapshotEntitySchema = z.strictObject({
  id: studioIdSchema,
  kind: entityKindSchema,
  name: z.string(),
  description: z.string(),
  visual: entityVisualSchema,
  state: entityDefaultStateSchema,
});

export const contextSnapshotSchema = z.strictObject({
  scene: z.strictObject({
    id: studioIdSchema,
    title: z.string(),
    script: z.string(),
    intent: z.string(),
  }),
  entities: z.array(contextSnapshotEntitySchema),
  style: z.strictObject({
    id: z.literal("default"),
    label: z.string(),
    visual: z.string(),
  }),
  intent: z.string(),
  shot: z.strictObject({
    id: studioIdSchema,
    purpose: z.string(),
    action: z.string(),
    camera: z.string(),
  }),
  continuity: z.strictObject({
    from: studioIdSchema.nullable(),
    prior: z
      .strictObject({
        action: z.string(),
        camera: z.string(),
        purpose: z.string(),
      })
      .nullable(),
  }),
});

export const workflowStatusLabelSchema = z.enum(["待跑", "成功", "失败", "锁定"]);

export const workflowNodeSchema = z.strictObject({
  id: studioIdSchema,
  shotId: studioIdSchema,
  sceneId: studioIdSchema,
  status: shotStatusSchema,
  statusLabel: workflowStatusLabelSchema,
  locked: z.boolean(),
  selectedImage: z.string(),
  continuityConstraints: z.string(),
  updatedAt: studioTimestampSchema,
});

export const generateModeSchema = z.enum(["generate", "regenerate"]);

export const workflowRunSchema = z.strictObject({
  id: studioIdSchema,
  shotId: studioIdSchema,
  sceneId: studioIdSchema,
  mode: generateModeSchema,
  status: z.enum(["success", "failed"]),
  prompt: z.string(),
  selectedImage: z.string().nullable(),
  continuityConstraints: z.string(),
  createdAt: studioTimestampSchema,
});

export const generateShotInputSchema = z.strictObject({
  mode: generateModeSchema.optional(),
});

export const lockShotInputSchema = z.strictObject({
  locked: z.boolean(),
});

export const createEntityInputSchema = z.strictObject({
  kind: entityKindSchema,
  name: z
    .string()
    .trim()
    .min(1, "Entity name is required")
    .max(120, "Entity name must be 120 characters or fewer"),
  id: studioIdSchema.optional(),
});

export const updateEntityInputSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "Entity name is required")
    .max(120, "Entity name must be 120 characters or fewer")
    .optional(),
  description: z.string().optional(),
  visual: entityVisualSchema.optional(),
  states: entityStatesSchema.optional(),
  provenance: parseProvenanceSchema.optional(),
  canonFields: z.array(z.string()).optional(),
  expectedUpdatedAt: studioTimestampSchema,
});

export type StudioParseProvenance = z.infer<typeof parseProvenanceSchema>;
export type StudioProject = z.infer<typeof projectRecordSchema>;
export type StudioProjectSummary = z.infer<typeof projectSummarySchema>;
export type StudioVolume = z.infer<typeof volumeRecordSchema>;
export type StudioChapter = z.infer<typeof chapterRecordSchema>;
export type StudioShotStatus = z.infer<typeof shotStatusSchema>;
export type StudioShot = z.infer<typeof shotRecordSchema>;
export type StudioScene = z.infer<typeof sceneRecordSchema>;
export type StudioEntity = z.infer<typeof entityRecordSchema>;
export type StudioEntityKind = z.infer<typeof entityKindSchema>;
export type StudioStyle = z.infer<typeof styleRecordSchema>;
export type ComicsStylePresetId = z.infer<typeof comicsStylePresetIdSchema>;
export type UpdateStyleInput = z.input<typeof updateStyleInputSchema>;
export type StudioStoryTimelineConnection = z.infer<typeof storyTimelineConnectionSchema>;
export type StudioStoryOutline = z.infer<typeof storyOutlineSchema>;
export type StudioStoryOutlineVolume = z.infer<typeof storyOutlineVolumeSchema>;
export type StudioStoryOutlineChapter = z.infer<typeof storyOutlineChapterSchema>;
export type StudioStoryOutlineScene = z.infer<typeof storyOutlineSceneSchema>;
export type StudioStoryOutlineEntityRef = z.infer<typeof storyOutlineEntityRefSchema>;
export type StudioStoryOutlineBeat = z.infer<typeof storyOutlineBeatSchema>;
export type StudioStoryTimeline = z.infer<typeof storyTimelineSchema>;
export type StudioStoryTimelineCharacter = z.infer<typeof storyTimelineCharacterSchema>;
export type StudioStoryTimelineEvent = z.infer<typeof storyTimelineEventSchema>;
export type StudioStoryTimelineIntersection = z.infer<typeof storyTimelineIntersectionSchema>;
export type StudioAttributedSpeechLine = z.infer<typeof attributedSpeechLineSchema>;
export type StudioLetteringBalloon = z.infer<typeof letteringBalloonSchema>;
export type StudioProjectDialogue = z.infer<typeof projectDialogueSchema>;
export type StudioProjectDialogueScene = z.infer<typeof projectDialogueSceneSchema>;
export type StudioProjectDialogueShot = z.infer<typeof projectDialogueShotSchema>;
export type StudioPipelineStageId = z.infer<typeof pipelineStageIdSchema>;
export type StudioPipelineStageStatus = z.infer<typeof pipelineStageStatusSchema>;
export type StudioPipelineStage = z.infer<typeof pipelineStageSchema>;
export type StudioPipelineEdge = z.infer<typeof pipelineEdgeSchema>;
export type StudioPipelineGraph = z.infer<typeof pipelineGraphSchema>;
export type StudioComicsPanel = z.infer<typeof comicsPanelSchema>;
export type StudioComicsPage = z.infer<typeof comicsPageSchema>;
export type StudioComicsBook = z.infer<typeof comicsBookSchema>;
export type StudioContextSnapshot = z.infer<typeof contextSnapshotSchema>;
export type StudioWorkflowStatusLabel = z.infer<typeof workflowStatusLabelSchema>;
export type StudioWorkflowNode = z.infer<typeof workflowNodeSchema>;
export type StudioWorkflowRun = z.infer<typeof workflowRunSchema>;
export type StudioGenerateMode = z.infer<typeof generateModeSchema>;
export type StudioStoryTree = z.infer<typeof storyTreeSchema>;
export type StudioStoryTreeVolume = z.infer<typeof storyTreeVolumeSchema>;
export type StudioStoryTreeChapter = z.infer<typeof storyTreeChapterSchema>;
export type StudioStoryTreeScene = z.infer<typeof storyTreeSceneSchema>;

export type CreateProjectInput = z.input<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectInputSchema>;
export type CreateVolumeInput = z.input<typeof createVolumeInputSchema>;
export type UpdateVolumeInput = z.input<typeof updateVolumeInputSchema>;
export type CreateChapterInput = z.input<typeof createChapterInputSchema>;
export type UpdateChapterInput = z.input<typeof updateChapterInputSchema>;
export type CreateSceneInput = z.input<typeof createSceneInputSchema>;
export type UpdateSceneInput = z.input<typeof updateSceneInputSchema>;
export type UpdateShotInput = z.input<typeof updateShotInputSchema>;
export type CreateEntityInput = z.input<typeof createEntityInputSchema>;
export type UpdateEntityInput = z.input<typeof updateEntityInputSchema>;
export type GenerateShotInput = z.input<typeof generateShotInputSchema>;
export type LockShotInput = z.input<typeof lockShotInputSchema>;
