"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudioPipelineGraph, StudioPipelineStage, StudioWorkflowNode } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import {
  findScenePathInTree,
  getStudioTree,
  getStudioWorkflow,
  lockStudioShot,
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

export function WorkflowPanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [pipeline, setPipeline] = useState<StudioPipelineGraph | null>(null);
  const [nodes, setNodes] = useState<StudioWorkflowNode[] | null>(null);
  const [error, setError] = useState("");
  const [selectedStage, setSelectedStage] = useState<StudioPipelineStage["id"]>("comics");
  const [runningImageId, setRunningImageId] = useState<string | null>(null);
  const [lockingId, setLockingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await getStudioWorkflow(projectId);
    setPipeline(next.pipeline);
    setNodes(next.nodes);
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
    <div className="mx-auto w-full max-w-[960px] px-5 py-10 sm:px-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Workflow")}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{t("Pipeline")}</h1>
      <p className="mt-3 text-sm text-ink-muted">{t("The full chain from story text to a finished comics page.")}</p>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {pipeline === null ? (
        <div className="mt-8 space-y-3">
          {["one", "two"].map((key) => (
            <div key={key} className="h-28 animate-pulse rounded-xl border border-line bg-surface-muted" />
          ))}
        </div>
      ) : (
        <PipelineGraph
          pipeline={pipeline}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedStage}
        />
      )}

      {selected ? (
        <section className="mt-8 rounded-xl border border-line bg-surface-raised px-4 py-4" data-pipeline-detail={selected.id}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{selected.label}</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">{t(STAGE_COPY[selected.id])}</h2>
          <p className="mt-1 text-sm text-ink-muted">{selected.statusLabel}</p>
        </section>
      ) : null}

      {showShots ? (
        nodes === null ? null : nodes.length === 0 ? (
          <p className="mt-6 text-sm text-ink-muted">{t("No workflow nodes yet. Run the director on a scene first.")}</p>
        ) : (
          <div className="mt-6 space-y-3" data-workflow-shots="true">
            {nodes.map((node) => {
              const imageBusy = runningImageId === node.shotId;
              const lockBusy = lockingId === node.shotId;
              return (
                <div key={`${node.sceneId}-${node.shotId}`} className="rounded-xl border border-line bg-surface-raised px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-semibold text-ink">{node.shotId}</p>
                      <p className="mt-1 font-mono text-xs text-ink-faint">{node.sceneId}</p>
                    </div>
                    <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink">
                      {node.statusLabel}
                    </span>
                  </div>
                  {node.selectedImage ? (
                    <img
                      src={studioImageUrl(projectId, node.selectedImage)}
                      alt={`${node.shotId} still`}
                      className="mt-3 w-full rounded-lg border border-line bg-surface-muted object-contain"
                    />
                  ) : null}
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("Continuity constraints")}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                      {node.continuityConstraints || t("No continuity constraints yet.")}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void rerunImage(node)}
                      disabled={node.locked || imageBusy || lockBusy}
                      className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {imageBusy ? t("Rerunning") : t("Re-run")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleLock(node)}
                      disabled={imageBusy || lockBusy}
                      aria-pressed={node.locked}
                      className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
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
    <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-surface-raised px-4 py-5" data-workflow-pipeline="true">
      <ol className="flex min-w-max items-start gap-0">
        {pipeline.stages.map((stage, index) => {
          const edge = pipeline.edges.find((item) => item.from === stage.id);
          return (
            <li key={stage.id} className="flex items-start">
              <button
                type="button"
                data-pipeline-stage={stage.id}
                data-pipeline-label={stage.label}
                data-pipeline-status={stage.status}
                onClick={() => onSelect(stage.id)}
                className={`flex w-32 flex-col items-center gap-2 rounded-lg px-2 py-2 text-center transition-colors ${
                  selectedId === stage.id ? "bg-surface-muted" : "hover:bg-surface-muted"
                }`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold ${stageDotClass(stage.status)}`}
                >
                  {stage.status === "success" ? "✓" : index + 1}
                </span>
                <span className="text-xs font-semibold text-ink">{stage.label}</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-ink-faint">{t(STAGE_COPY[stage.id])}</span>
                <span className="text-[11px] text-ink-muted">{stage.statusLabel}</span>
              </button>
              {edge ? (
                <div
                  data-pipeline-edge={`${edge.from}->${edge.to}`}
                  className="mt-6 h-0.5 w-8 shrink-0 bg-line"
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

function stageDotClass(status: StudioPipelineStage["status"]): string {
  if (status === "success") {
    return "border-accent bg-accent text-white";
  }
  if (status === "failed") {
    return "border-danger text-danger";
  }
  if (status === "running") {
    return "border-accent text-accent";
  }
  return "border-line text-ink-faint";
}
