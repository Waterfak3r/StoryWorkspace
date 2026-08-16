"use client";

import {
  ArrowCounterClockwise,
  ArrowUpRight,
  Books,
  Check,
  CircleNotch,
  Clock,
  FolderSimple,
  Plus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { StudioProjectSummary } from "@/studio/domain";
import { LanguageSwitcher } from "@/features/i18n/LanguageSwitcher";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { createStudioProject, getStudioWorkspace, StudioRequestError } from "./api";

type ViewState = "loading" | "ready" | "error";
type FieldErrors = Record<string, string[]>;

function Dialog({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]";
    const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialog) {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid min-h-[100dvh] place-items-center bg-ink/45 px-4 py-8"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-project-dialog-title"
        aria-describedby={description ? "studio-project-dialog-description" : undefined}
        className="w-full max-w-lg rounded-xl border border-line bg-surface-raised p-6 shadow-[0_24px_80px_rgb(12_20_26_/_22%)]"
      >
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 id="studio-project-dialog-title" className="text-xl font-semibold tracking-[-0.02em] text-ink">
              {title}
            </h2>
            {description ? (
              <p id="studio-project-dialog-description" className="mt-2 max-w-[44ch] text-sm leading-6 text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t("Close dialog")}
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <X size={20} weight="regular" />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function LoadingRows() {
  const { t } = useI18n();
  return (
    <section aria-label={t("Loading projects")} className="overflow-hidden rounded-xl border border-line bg-surface-raised">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-muted" />
        <div className="h-3 w-16 animate-pulse rounded bg-surface-muted" />
      </div>
      <div className="divide-y divide-line">
        {["first", "second", "third"].map((key) => (
          <div key={key} className="grid gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="space-y-3">
              <div className="h-5 w-2/5 animate-pulse rounded bg-surface-muted" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-surface-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-surface-muted" />
            </div>
            <div className="h-9 w-24 animate-pulse rounded-lg bg-surface-muted" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProjectLibrary() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
  const [loadError, setLoadError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const payload = await getStudioWorkspace();
      setProjects(payload.projects);
      setViewState("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("The project library could not be loaded."));
      setViewState("error");
    }
  }, [t]);

  useEffect(() => {
    const requestId = window.setTimeout(() => {
      void loadProjects();
    }, 0);
    return () => window.clearTimeout(requestId);
  }, [loadProjects]);

  const openCreateDialog = useCallback(() => {
    setDialogOpen(true);
    setTitle("");
    setFieldErrors({});
    setFormError("");
  }, []);

  const closeDialog = useCallback(() => {
    if (!submitting) {
      setDialogOpen(false);
    }
  }, [submitting]);

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError("");
    setSubmitting(true);

    try {
      const project = await createStudioProject(title);
      setProjects((current) => {
        const withoutSaved = current.filter((item) => item.id !== project.id);
        return [{ id: project.id, title: project.title, updatedAt: project.updatedAt }, ...withoutSaved];
      });
      setDialogOpen(false);
    } catch (error) {
      if (error instanceof StudioRequestError && error.fieldErrors) {
        setFieldErrors(error.fieldErrors);
      }
      setFormError(error instanceof Error ? error.message : t("The project could not be saved."));
    } finally {
      setSubmitting(false);
    }
  }

  const titleError = fieldErrors.title?.[0];

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <header className="border-b border-line bg-surface/80">
        <div className="mx-auto flex min-h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-3 text-sm font-semibold tracking-[-0.01em] text-ink"
            aria-label={`${t("Story Workspace")} home`}
          >
            <span className="grid size-8 place-items-center rounded-lg bg-ink text-surface">
              <Books size={18} weight="regular" />
            </span>
            <span>{t("Story Workspace")}</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-ink-faint sm:inline">{t("A quiet place for long-form work")}</span>
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <div className="flex flex-col justify-between gap-7 border-b border-line pb-9 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t("Project library")}</p>
            <h1 className="mt-3 max-w-[15ch] text-4xl font-semibold leading-[1.02] tracking-[-0.05em] text-ink sm:text-5xl">
              {t("Stories in progress")}
            </h1>
            <p className="mt-4 max-w-[52ch] text-base leading-7 text-ink-muted">
              {t("Each project is a local JSON folder on this machine.")}
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"
          >
            <Plus size={18} weight="regular" /> {t("New project")}
          </button>
        </div>

        {viewState === "error" ? (
          <div role="alert" className="mt-8 flex flex-col gap-4 rounded-xl border border-danger/30 bg-danger/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <WarningCircle size={21} weight="regular" className="mt-0.5 shrink-0 text-danger" />
              <div>
                <h2 className="font-semibold text-ink">{t("The library is unavailable")}</h2>
                <p className="mt-1 text-sm leading-6 text-ink-muted">{loadError || t("Try loading your projects again.")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setViewState("loading");
                setLoadError("");
                void loadProjects();
              }}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-danger/40 px-3.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/10"
            >
              <ArrowCounterClockwise size={17} weight="regular" /> {t("Try again")}
            </button>
          </div>
        ) : null}

        {viewState === "loading" ? (
          <div className="mt-8">
            <LoadingRows />
          </div>
        ) : null}

        {viewState === "ready" && projects.length === 0 ? (
          <section className="mt-8 rounded-xl border border-line bg-surface-raised px-6 py-14 text-center sm:px-12">
            <div className="mx-auto grid size-14 place-items-center rounded-xl bg-accent-soft text-accent">
              <Books size={28} weight="regular" />
            </div>
            <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-ink">{t("Start with one clear idea")}</h2>
            <p className="mx-auto mt-3 max-w-[46ch] text-sm leading-6 text-ink-muted">
              {t("Create a project to start a local JSON folder.")}
            </p>
            <button
              type="button"
              onClick={openCreateDialog}
              className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"
            >
              <Plus size={18} weight="regular" /> {t("New project")}
            </button>
          </section>
        ) : null}

        {viewState === "ready" && projects.length > 0 ? (
          <section aria-labelledby="studio-projects-heading" className="mt-8 overflow-hidden rounded-xl border border-line bg-surface-raised">
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
              <h2 id="studio-projects-heading" className="text-sm font-semibold text-ink">{t("Projects")}</h2>
              <span className="text-xs text-ink-faint">
                {projects.length} {projects.length === 1 ? t("project") : t("projects")}
              </span>
            </div>
            <div className="divide-y divide-line">
              {projects.map((project) => (
                <article
                  key={project.id}
                  className="grid gap-5 px-5 py-5 transition-colors hover:bg-surface/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <h3 className="truncate text-[1.05rem] font-semibold tracking-[-0.015em] text-ink">{project.title}</h3>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-faint">
                      <span className="inline-flex items-center gap-1.5">
                        <FolderSimple size={14} weight="regular" aria-hidden="true" />
                        {project.id}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock size={14} weight="regular" aria-hidden="true" />
                        {t("Edited {date}", { date: formatDate(project.updatedAt) })}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => router.push(`/projects/${project.id}`)}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"
                    >
                      {t("Open")} <ArrowUpRight size={16} weight="regular" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {viewState === "ready" ? (
          <p className="mt-10 flex items-center gap-2 text-xs text-ink-faint">
            <Check size={15} weight="regular" className="text-success" /> {t("Changes save locally to this workspace.")}
          </p>
        ) : null}
      </main>

      {dialogOpen ? (
        <Dialog
          title={t("Create a project")}
          description={t("Give the story a local JSON folder. You can add scenes and entities after you open it.")}
          onClose={closeDialog}
        >
          <form onSubmit={submitProject} noValidate className="space-y-5">
            {formError ? (
              <div role="alert" className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm leading-5 text-danger">
                <WarningCircle size={18} weight="regular" className="mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            ) : null}
            <div className="space-y-2">
              <label htmlFor="project-title" className="block text-sm font-semibold text-ink">
                {t("Project title")}
              </label>
              <input
                id="project-title"
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoComplete="off"
                maxLength={120}
                required
                aria-invalid={Boolean(titleError)}
                aria-describedby={titleError ? "project-title-error" : undefined}
                className="min-h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15"
                placeholder={t("A working title")}
              />
              {titleError ? <p id="project-title-error" className="text-sm text-danger">{titleError}</p> : null}
            </div>
            <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDialog}
                className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px disabled:cursor-wait disabled:opacity-70"
              >
                {submitting ? <CircleNotch size={17} weight="regular" className="animate-spin" /> : <Plus size={17} weight="regular" />}
                {submitting ? t("Saving") : t("Create project")}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
