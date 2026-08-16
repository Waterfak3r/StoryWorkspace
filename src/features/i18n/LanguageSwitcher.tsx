"use client";

import * as React from "react";
import { Translate } from "@phosphor-icons/react";
import { useI18n } from "./LocaleProvider";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const nextLocale = locale === "en" ? "zh-CN" : "en";
  return (
    <button
      type="button"
      onClick={() => setLocale(nextLocale)}
      aria-label={locale === "en" ? t("Switch to Simplified Chinese") : t("Switch to English")}
      title={t("Switch language")}
      className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold text-ink-muted transition-colors hover:border-accent hover:text-accent ${className}`}
    >
      <Translate size={16} weight="regular" aria-hidden="true" />
      <span>{locale === "en" ? "中文" : "English"}</span>
    </button>
  );
}

