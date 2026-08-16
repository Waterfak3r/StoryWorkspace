"use client";

import type { ReactNode } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { useI18n } from "@/features/i18n/LocaleProvider";

export function ConflictBanner({
  preview,
  onOverwrite,
  onDiscard,
  busy = false,
}: {
  preview: ReactNode;
  onOverwrite: () => void;
  onDiscard: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger"
    >
      <div className="flex items-start gap-2.5">
        <WarningCircle size={18} weight="regular" className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">
            {t("The record changed on disk. Review the current version before saving again.")}
          </p>
          <div className="mt-3 space-y-3 text-ink">{preview}</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOverwrite}
              disabled={busy}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px disabled:cursor-wait disabled:opacity-70"
            >
              {t("Overwrite")}
            </button>
            <button
              type="button"
              onClick={onDiscard}
              disabled={busy}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-70"
            >
              {t("Discard")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
