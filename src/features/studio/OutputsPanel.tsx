"use client";

import { useEffect, useState } from "react";
import type { StudioWorkflowNode } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { getStudioWorkflow } from "./api";

export function OutputsPanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<StudioWorkflowNode[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void getStudioWorkflow(projectId)
        .then((next) => {
          if (!cancelled) {
            setNodes(next);
          }
        })
        .catch((cause) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : t("The workspace could not be loaded."));
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [projectId, t]);

  const imageOutputs = (nodes ?? []).filter((node) => node.selectedImage);

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 py-10 sm:px-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Outputs")}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{t("Selected images")}</h1>
      <p className="mt-3 text-sm text-ink-muted">{t("Selected image paths written under the project folder.")}</p>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {nodes === null ? (
        <div className="mt-8 space-y-3">
          {["one", "two"].map((key) => (
            <div key={key} className="h-20 animate-pulse rounded-xl border border-line bg-surface-muted" />
          ))}
        </div>
      ) : imageOutputs.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">{t("No selected images yet.")}</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {imageOutputs.map((node) => (
            <li key={`image-${node.sceneId}-${node.shotId}`} className="rounded-xl border border-line bg-surface-raised px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm font-semibold text-ink">{node.shotId}</p>
                <span className="text-xs font-semibold text-ink-muted">{node.statusLabel}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-ink-faint">{node.sceneId}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("Relative path")}</p>
              <p className="mt-1 break-all font-mono text-sm text-ink">{node.selectedImage}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
