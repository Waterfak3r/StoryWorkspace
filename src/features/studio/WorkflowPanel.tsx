"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowsClockwise,
  Check,
  FilmSlate,
  Lock,
  LockOpen,
} from "@phosphor-icons/react";
import type {
  StudioPipelineGraph,
  StudioPipelineStage,
  StudioProjectDialogue,
  StudioWorkflowNode,
} from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import type { StudioParseRun } from "@/studio/parse/schemas";
import type { ScenePath } from "./api";
import {
  confirmStudioParseRun,
  confirmStudioProjectDialogue,
  directStudioScene,
  findScenePathInTree,
  generateStudioShot,
  getStudioScene,
  getStudioTree,
  getStudioWorkflow,
  listScenePaths,
  listStudioParseRuns,
  lockStudioShot,
  parseStudioText,
  rerunStudioWorkflowNode,
  studioImageUrl,
} from "./api";

const STAGE_COPY: Record<StudioPipelineStage["id"], string> = {
  text: "Story text",
  import: "Import",
  storyboard: "Storyboard stage",
  dialogue: "Dialogue",
  comics: "Generate comics",
};

const STAGE_DESCRIPTIONS: Record<StudioPipelineStage["id"], string> = {
  text: "Draft and parse raw narrative prose or scripts into structured story volumes, chapters, and scenes.",
  import: "Ingest and validate entities, scene beats, and character presence from source material.",
  storyboard: "Direct narrative scenes into concrete visual camera shots, actions, and continuity constraints.",
  dialogue: "Extract and align character dialogue and speech balloon placements across consecutive panels.",
  comics: "Compose full comic pages with rendered panel artwork, ink styling, and speech lettering.",
};

export function WorkflowPanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [pipeline, setPipeline] = useState<StudioPipelineGraph | null>(null);
  const [nodes, setNodes] = useState<StudioWorkflowNode[] | null>(null);
  const [dialogue, setDialogue] = useState<StudioProjectDialogue | null>(null);
  const [error, setError] = useState("");
  const [selectedStage, setSelectedStage] = useState<StudioPipelineStage["id"]>("dialogue");
  const [runningImageId, setRunningImageId] = useState<string | null>(null);
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"import-parse" | "import" | "storyboard" | "dialogue" | "comics" | null>(
    null,
  );
  const [importText, setImportText] = useState("");
  const [parseRuns, setParseRuns] = useState<StudioParseRun[]>([]);

  const refresh = useCallback(async () => {
    const [next, runs] = await Promise.all([getStudioWorkflow(projectId), listStudioParseRuns(projectId)]);
    setPipeline(next.pipeline);
    setNodes(next.nodes);
    setDialogue(next.dialogue);
    setParseRuns(runs);
    setError("");
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void refresh().catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : t("The workspace could not be loaded."));
        }
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [refresh, t]);

  async function toggleLock(node: StudioWorkflowNode) {
    setLockingId(node.shotId);
    try {
      const tree = await getStudioTree(projectId);
      const path = findScenePathInTree(tree, node.sceneId);
      if (!path) {
        throw new Error(t("The request could not be completed."));
      }
      await lockStudioShot(projectId, path, node.shotId, !node.locked);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
    } finally {
      setLockingId(null);
    }
  }

  async function loadScenePaths(): Promise<ScenePath[]> {
    const tree = await getStudioTree(projectId);
    return listScenePaths(tree);
  }

  async function parseImport() {
    const source = importText.trim();
    if (!source || busyAction) {
      return;
    }
    setBusyAction("import-parse");
    try {
      await parseStudioText(projectId, source);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmImport() {
    const pending = parseRuns.find((run) => run.status === "pending");
    if (!pending || busyAction) {
      if (!pending) {
        setError(t("No pending import to confirm. Parse pasted text first."));
      }
      return;
    }
    setBusyAction("import");
    try {
      await confirmStudioParseRun(projectId, pending.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function runDirector() {
    if (busyAction) {
      return;
    }
    setBusyAction("storyboard");
    try {
      const paths = await loadScenePaths();
      for (const path of paths) {
        const scene = await getStudioScene(projectId, path);
        if (scene.shots.length === 0) {
          await directStudioScene(projectId, path);
        }
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmDialogue() {
    if (busyAction) {
      return;
    }
    setBusyAction("dialogue");
    try {
      await confirmStudioProjectDialogue(projectId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function generateComics() {
    if (busyAction) {
      return;
    }
    setBusyAction("comics");
    try {
      const paths = await loadScenePaths();
      for (const path of paths) {
        const scene = await getStudioScene(projectId, path);
        const needsPage = scene.shots.length > 0 && scene.shots.every((shot) => !(shot.selected_image ?? "").trim());
        const first = scene.shots[0];
        if (needsPage && first) {
          await generateStudioShot(projectId, path, first.id);
        }
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function rerunImage(node: StudioWorkflowNode) {
    if (node.locked) {
      return;
    }
    setRunningImageId(node.shotId);
    try {
      await rerunStudioWorkflowNode(projectId, node.shotId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("The request could not be completed."));
    } finally {
      setRunningImageId(null);
    }
  }

  const selected = pipeline?.stages.find((stage) => stage.id === selectedStage) ?? pipeline?.stages[0] ?? null;
  const showShots = selected?.id === "storyboard" || selected?.id === "comics";

  return (
    <div className="mx-auto w-full max-w-[1020px] px-5 py-8 sm:px-8">
      {/* Header section */}
      <div className="border-b border-line pb-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-accent" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Workflow")}</p>
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{t("Pipeline")}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {t("The full chain from story text to a finished comics page.")}
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {pipeline === null ? (
        <div className="mt-8 space-y-4">
          <div className="h-32 animate-pulse rounded-2xl border border-line bg-surface-muted" />
          <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface-muted" />
        </div>
      ) : (
        <PipelineGraph
          pipeline={pipeline}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedStage}
        />
      )}

      {/* Selected Stage Detail Card */}
      {selected ? (
        <section
          className="mt-8 rounded-2xl border border-line bg-surface-raised p-5 shadow-xs sm:p-6"
          data-pipeline-detail={selected.id}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">
                {selected.label}
              </span>
              <h2 className="text-lg font-bold tracking-tight text-ink">{t(STAGE_COPY[selected.id])}</h2>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink">
              <span
                className={`h-2 w-2 rounded-full ${
                  selected.status === "success"
                    ? "bg-success"
                    : selected.status === "failed"
                      ? "bg-danger"
                      : selected.status === "running"
                        ? "bg-accent animate-pulse"
                        : "bg-line"
                }`}
              />
              {selected.statusLabel}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            {t(STAGE_DESCRIPTIONS[selected.id]) || selected.statusLabel}
          </p>
          {selected.id === "import" ? (
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-semibold text-ink-muted" htmlFor="workflow-import-text">
                {t("Paste story text to import")}
              </label>
              <textarea
                id="workflow-import-text"
                data-workflow-import-text="true"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                rows={5}
                className="w-full rounded-lg border border-line bg-surface px-3.5 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15"
              />
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  data-workflow-action="import-parse"
                  onClick={() => void parseImport()}
                  disabled={busyAction !== null || importText.trim().length === 0}
                  className={stageActionClass}
                >
                  {busyAction === "import-parse" ? t("Parsing story text") : t("Parse story text")}
                </button>
                <button
                  type="button"
                  data-workflow-action="import"
                  onClick={() => void confirmImport()}
                  disabled={busyAction !== null || !parseRuns.some((run) => run.status === "pending")}
                  className={stageActionClass}
                >
                  {busyAction === "import" ? t("Confirming import") : t("Confirm import")}
                </button>
              </div>
            </div>
          ) : null}
          {selected.id === "storyboard" ? (
            <div className="mt-4">
              <p className="mb-3 text-xs text-ink-faint">{t("Run director on scenes that do not have shots yet.")}</p>
              <button
                type="button"
                data-workflow-action="storyboard"
                onClick={() => void runDirector()}
                disabled={busyAction !== null}
                className={stageActionClass}
              >
                {busyAction === "storyboard" ? t("Directing") : t("Run director")}
              </button>
            </div>
          ) : null}
          {selected.id === "dialogue" ? (
            <div className="mt-4">
              <p className="mb-3 text-xs text-ink-faint">
                {t("Confirm extracted dialogue for every storyboarded scene.")}
              </p>
              <button
                type="button"
                data-workflow-action="dialogue"
                onClick={() => void confirmDialogue()}
                disabled={busyAction !== null}
                className={stageActionClass}
              >
                {busyAction === "dialogue" ? t("Confirming dialogue") : t("Confirm dialogue")}
              </button>
            </div>
          ) : null}
          {selected.id === "comics" ? (
            <div className="mt-4">
              <p className="mb-3 text-xs text-ink-faint">
                {t("Generate the first unfinished comics page from existing shots.")}
              </p>
              <button
                type="button"
                data-workflow-action="comics"
                onClick={() => void generateComics()}
                disabled={busyAction !== null}
                className={stageActionClass}
              >
                {busyAction === "comics" ? t("Generating comic page") : t("Generate comic page")}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {selected?.id === "dialogue" ? (
        <DialogueStageList dialogue={dialogue} />
      ) : null}

      {/* Workflow Shot Production List */}
      {showShots ? (
        nodes === null ? null : nodes.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface/50 p-8 text-center">
            <FilmSlate size={32} className="mx-auto text-ink-faint" />
            <p className="mt-3 text-sm font-medium text-ink-muted">
              {t("No workflow nodes yet. Run the director on a scene first.")}
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-4" data-workflow-shots="true">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-faint">
                {t("Shot production nodes")} ({nodes.length})
              </h3>
            </div>
            {nodes.map((node) => {
              const imageBusy = runningImageId === node.shotId;
              const lockBusy = lockingId === node.shotId;
              return (
                <div
                  key={`${node.sceneId}-${node.shotId}`}
                  className="rounded-2xl border border-line bg-surface-raised p-5 shadow-xs transition-shadow hover:shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-ink">{node.shotId}</span>
                      <span className="rounded bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-ink-faint">
                        {node.sceneId}
                      </span>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        node.locked
                          ? "border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "border border-line bg-surface text-ink-muted"
                      }`}
                    >
                      {node.locked ? <Lock size={12} weight="bold" /> : null}
                      {node.statusLabel}
                    </span>
                  </div>

                  {node.selectedImage ? (
                    <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface-muted">
                      <img
                        src={studioImageUrl(projectId, node.selectedImage)}
                        alt={t("Generated comic page")}
                        className="max-h-96 w-full object-contain"
                      />
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-xl border border-line/60 bg-surface p-3.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                      {t("Continuity constraints")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">
                      {node.continuityConstraints || t("No continuity constraints yet.")}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      onClick={() => void rerunImage(node)}
                      disabled={node.locked || imageBusy || lockBusy}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ArrowsClockwise size={14} className={imageBusy ? "animate-spin" : ""} />
                      {imageBusy ? t("Rerunning") : t("Re-run")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleLock(node)}
                      disabled={imageBusy || lockBusy}
                      aria-pressed={node.locked}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 ${
                        node.locked
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                          : "border-line bg-surface text-ink hover:bg-surface-muted"
                      }`}
                    >
                      {node.locked ? <LockOpen size={14} /> : <Lock size={14} />}
                      {lockBusy
                        ? node.locked
                          ? t("Unlocking")
                          : t("Locking")
                        : node.locked
                          ? t("Unlock")
                          : t("Lock")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}

function PipelineGraph({
  pipeline,
  selectedId,
  onSelect,
}: {
  pipeline: StudioPipelineGraph;
  selectedId: string | null;
  onSelect: (id: StudioPipelineStage["id"]) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="mt-8 overflow-x-auto rounded-2xl border border-line bg-surface-raised p-5 shadow-xs"
      data-workflow-pipeline="true"
    >
      <ol className="flex min-w-max items-center justify-between gap-1">
        {pipeline.stages.map((stage, index) => {
          const edge = pipeline.edges.find((item) => item.from === stage.id);
          const isSelected = selectedId === stage.id;
          return (
            <li key={stage.id} className="flex items-center">
              <button
                type="button"
                data-pipeline-stage={stage.id}
                data-pipeline-label={stage.label}
                data-pipeline-status={stage.status}
                onClick={() => onSelect(stage.id)}
                className={`group flex w-36 flex-col items-center gap-2 rounded-xl border p-3 text-center transition-[border-color,background-color,box-shadow] ${
                  isSelected
                    ? "border-accent bg-accent-soft/80 shadow-xs ring-2 ring-accent/20"
                    : "border-transparent bg-surface hover:border-line hover:bg-surface-muted"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold transition-transform group-hover:scale-105 ${stageDotClass(
                    stage.status,
                  )}`}
                >
                  {stage.status === "success" ? <Check size={14} weight="bold" /> : index + 1}
                </span>
                <span className="text-xs font-bold text-ink">{stage.label}</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t(STAGE_COPY[stage.id])}
                </span>
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                  {stage.statusLabel}
                </span>
              </button>
              {edge ? (
                <div
                  data-pipeline-edge={`${edge.from}->${edge.to}`}
                  className="mx-1 h-0.5 w-6 shrink-0 bg-line transition-colors"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DialogueStageList({ dialogue }: { dialogue: StudioProjectDialogue | null }) {
  const { t } = useI18n();
  if (!dialogue) {
    return null;
  }

  const visible = dialogue.scenes.filter(
    (scene) => scene.unassigned.length > 0 || scene.shots.some((shot) => shot.lines.length > 0),
  );

  if (visible.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface/50 px-5 py-8" data-dialogue-list="true">
        <p className="text-sm font-medium text-ink-muted">{t("No attributed dialogue yet.")}</p>
        <p className="mt-2 text-sm text-ink-faint">
          {t('Write lines like Sue: "The last leaf is still there." in the Story script. They show up here, then as balloons on the comics page.')}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4" data-dialogue-list="true">
      <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">
        {t("{n} attributed lines", { n: dialogue.lineCount })}
      </p>
      {visible.map((scene) => (
        <section key={scene.sceneId} className="rounded-2xl border border-line bg-surface-raised px-4 py-4">
          <h3 className="text-sm font-semibold text-ink">{scene.title}</h3>
          {scene.unassigned.map((line) => (
            <p key={line.id} data-dialogue-line={line.id} className="mt-3 text-sm text-ink">
              <span className="font-semibold">{line.speaker}</span>
              {` · ${line.text}`}
            </p>
          ))}
          {scene.shots
            .filter((shot) => shot.lines.length > 0)
            .map((shot) => (
              <div key={shot.shotId} className="mt-3 border-t border-line pt-3">
                <p className="font-mono text-xs text-ink-faint">{shot.shotId}</p>
                {shot.lines.map((line) => (
                  <p key={line.id} data-dialogue-line={line.id} className="mt-2 text-sm text-ink">
                    <span className="font-semibold">{line.speaker}</span>
                    {` · ${line.text}`}
                  </p>
                ))}
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}

const stageActionClass =
  "inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60";

function stageDotClass(status: StudioPipelineStage["status"]): string {
  if (status === "success") {
    return "border-accent bg-accent text-on-accent shadow-xs";
  }
  if (status === "failed") {
    return "border-danger bg-danger/10 text-danger";
  }
  if (status === "running") {
    return "border-accent bg-accent-soft text-accent animate-pulse";
  }
  return "border-line bg-surface text-ink-faint";
}

