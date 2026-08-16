"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/features/i18n/LocaleProvider";
import {
  getStudioProviderSettings,
  saveStudioProviderSettings,
  type PublicProviderSettings,
  type TextProtocol,
} from "./api";

const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
const OPENCODE_GO_MODEL = "glm-5.3";

const fieldClassName =
  "w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15";

const emptyView = (): PublicProviderSettings => ({
  text: { baseUrl: "", model: "", protocol: "auto", apiKeyConfigured: false, apiKeyHint: "", source: "default" },
  image: { baseUrl: "", model: "", size: "", apiKeyConfigured: false, apiKeyHint: "", source: "default" },
});

export function SettingsPanel() {
  const { t } = useI18n();
  const [view, setView] = useState<PublicProviderSettings | null>(null);
  const [textBaseUrl, setTextBaseUrl] = useState("");
  const [textModel, setTextModel] = useState("");
  const [textProtocol, setTextProtocol] = useState<TextProtocol>("auto");
  const [textApiKey, setTextApiKey] = useState("");
  const [imageBaseUrl, setImageBaseUrl] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [imageSize, setImageSize] = useState("");
  const [imageApiKey, setImageApiKey] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void getStudioProviderSettings()
        .then((next) => {
          if (!cancelled) {
            applyView(next);
            setLoadError("");
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setView(emptyView());
            setLoadError(error instanceof Error ? error.message : t("The workspace could not be loaded."));
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [t]);

  function applyView(next: PublicProviderSettings) {
    setView(next);
    setTextBaseUrl(next.text.baseUrl);
    setTextModel(next.text.model);
    setTextProtocol(next.text.protocol ?? "auto");
    setTextApiKey("");
    setImageBaseUrl(next.image.baseUrl);
    setImageModel(next.image.model);
    setImageSize(next.image.size);
    setImageApiKey("");
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) {
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const next = await saveStudioProviderSettings({
        text: {
          baseUrl: textBaseUrl,
          model: textModel,
          protocol: textProtocol,
          ...(textApiKey.trim() ? { apiKey: textApiKey.trim() } : {}),
        },
        image: {
          baseUrl: imageBaseUrl,
          model: imageModel,
          size: imageSize,
          ...(imageApiKey.trim() ? { apiKey: imageApiKey.trim() } : {}),
        },
      });
      applyView(next);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("The request could not be completed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[780px] px-5 py-10 sm:px-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Settings")}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">{t("Settings")}</h1>

      {loadError ? (
        <p role="alert" className="mt-6 text-sm text-danger">
          {loadError}
        </p>
      ) : null}

      {!view ? (
        <div className="mt-8 space-y-3">
          {["text", "image"].map((key) => (
            <div key={key} className="h-48 animate-pulse rounded-xl border border-line bg-surface-muted" />
          ))}
        </div>
      ) : (
        <form className="mt-8 space-y-6" onSubmit={(event) => void onSave(event)}>
          <fieldset className="rounded-xl border border-line bg-surface-raised px-4 py-5">
            <legend className="px-1 text-sm font-semibold text-ink">{t("Text API")}</legend>
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setTextBaseUrl(OPENCODE_GO_BASE_URL);
                  setTextProtocol("chat");
                  setTextModel((current) => current.trim() || OPENCODE_GO_MODEL);
                }}
                className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface-muted"
              >
                {t("Use OpenCode Go")}
              </button>
              <p className="text-xs leading-5 text-ink-faint">
                {t("OpenCode Go uses chat completions. Paste a model id from /models, for example glm-5.3 or kimi-k2.6.")}
              </p>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t("API protocol")}
                </span>
                <select
                  className={`${fieldClassName} min-h-11`}
                  value={textProtocol}
                  onChange={(event) => setTextProtocol(event.target.value as TextProtocol)}
                >
                  <option value="auto">{t("Auto")}</option>
                  <option value="chat">{t("Chat completions")}</option>
                  <option value="responses">{t("Responses")}</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t("Base URL")}
                </span>
                <input
                  className={`${fieldClassName} min-h-11`}
                  value={textBaseUrl}
                  onChange={(event) => setTextBaseUrl(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t("Model")}
                </span>
                <input
                  className={`${fieldClassName} min-h-11`}
                  value={textModel}
                  onChange={(event) => setTextModel(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t("API key")}
                </span>
                <input
                  type="password"
                  className={`${fieldClassName} min-h-11`}
                  value={textApiKey}
                  onChange={(event) => setTextApiKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("Leave blank to keep the saved key.")}
                />
              </label>
              {view.text.apiKeyConfigured ? (
                <p className="text-sm text-ink-muted">
                  {t("API key is configured")}
                  {view.text.apiKeyHint ? <span className="ml-2 font-mono text-ink-faint">{view.text.apiKeyHint}</span> : null}
                </p>
              ) : null}
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-line bg-surface-raised px-4 py-5">
            <legend className="px-1 text-sm font-semibold text-ink">{t("Image API")}</legend>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t("Base URL")}
                </span>
                <input
                  className={`${fieldClassName} min-h-11`}
                  value={imageBaseUrl}
                  onChange={(event) => setImageBaseUrl(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t("Model")}
                </span>
                <input
                  className={`${fieldClassName} min-h-11`}
                  value={imageModel}
                  onChange={(event) => setImageModel(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t("Image size")}
                </span>
                <input
                  className={`${fieldClassName} min-h-11`}
                  value={imageSize}
                  onChange={(event) => setImageSize(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                  {t("API key")}
                </span>
                <input
                  type="password"
                  className={`${fieldClassName} min-h-11`}
                  value={imageApiKey}
                  onChange={(event) => setImageApiKey(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("Leave blank to keep the saved key.")}
                />
              </label>
              {view.image.apiKeyConfigured ? (
                <p className="text-sm text-ink-muted">
                  {t("API key is configured")}
                  {view.image.apiKeyHint ? <span className="ml-2 font-mono text-ink-faint">{view.image.apiKeyHint}</span> : null}
                </p>
              ) : null}
            </div>
          </fieldset>

          {saveError ? (
            <p role="alert" className="text-sm text-danger">
              {saveError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? t("Saving") : t("Save API settings")}
          </button>
        </form>
      )}
    </div>
  );
}
