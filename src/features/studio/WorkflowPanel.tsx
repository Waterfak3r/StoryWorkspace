"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudioWorkflowNode } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { getStudioWorkflow, rerunStudioWorkflowNode, studioImageUrl } from "./api";

export function WorkflowPanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<StudioWorkflowNode[] | null>(null);
  const [error, setError] = useState("");
  const [runningImageId, setRunningImageId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await getStudioWorkflow(projectId);
    setNodes(next);
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

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-10 sm:px-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Workflow")}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{t("Workflow nodes")}</h1>
      <p className="mt-3 text-sm text-ink-muted">{t("Run or re-run unlocked shots and inspect continuity constraints.")}</p>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {nodes === null ? (
        <div className="mt-8 space-y-3">
          {["one", "two"].map((key) => (
            <div key={key} className="h-28 animate-pulse rounded-xl border border-line bg-surface-muted" />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">{t("No workflow nodes yet. Run the director on a scene first.")}</p>
      ) : (
        <ol className="mt-8 space-y-3">
          {nodes.map((node) => {
            const imageBusy = runningImageId === node.shotId;
            return (
              <li key={`${node.sceneId}-${node.shotId}`} className="rounded-xl border border-line bg-surface-raised px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-semibold text-ink">{node.shotId}</p>
                    <p className="mt-1 font-mono text-xs text-ink-faint">{node.sceneId}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-ink">
                      {node.statusLabel}
                    </span>
                  </div>
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
                    disabled={node.locked || imageBusy}
                    className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {imageBusy ? t("Rerunning") : t("Re-run")}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
