"use client";

import {
  Archive,
  ArrowCounterClockwise,
  ArrowUpRight,
  Books,
  Check,
  CircleNotch,
  Clock,
  FloppyDisk,
  PencilSimple,
  Plus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Project } from "@/domain/project";

type ViewState = "loading" | "ready" | "error";
type FormMode = "create" | "rename";
type FieldErrors = Record<string, string[]>;

type ApiPayload = {
  data?: { projects?: Project[]; project?: Project };
  error?: {
    message?: string;
    fieldErrors?: FieldErrors;
  };
};

class ProjectRequestError extends Error {
  fieldErrors?: FieldErrors;

  constructor(message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = "ProjectRequestError";
    this.fieldErrors = fieldErrors;
  }
}

async function readPayload(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as ApiPayload;

  if (!response.ok) {
    throw new ProjectRequestError(
      payload.error?.message ?? "The request could not be completed.",
      payload.error?.fieldErrors,
    );
  }

  return payload;
}

function formatEditedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getProjectSummary(project: Project) {
  return project.premise.trim() || "Add a premise in the workspace when the idea takes shape.";
}

function Dialog({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
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
    <div className="fixed inset-0 z-50 grid min-h-[100dvh] place-items-center bg-ink/45 px-4 py-8" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" aria-describedby={description ? "project-dialog-description" : undefined} className="w-full max-w-lg rounded-xl border border-line bg-surface-raised p-6 shadow-[0_24px_80px_rgb(12_20_26_/_22%)]">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 id="project-dialog-title" className="text-xl font-semibold tracking-[-0.02em] text-ink">{title}</h2>
            {description ? <p id="project-dialog-description" className="mt-2 max-w-[44ch] text-sm leading-6 text-ink-muted">{description}</p> : null}
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink">
            <X size={20} weight="regular" />
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <section aria-label="Loading projects" className="overflow-hidden rounded-xl border border-line bg-surface-raised">
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

function ProjectRow({ project, onOpen, onRename, onArchive }: { project: Project; onOpen: (project: Project) => void; onRename: (project: Project) => void; onArchive: (project: Project) => void }) {
  return (
    <article className="grid gap-5 px-5 py-5 transition-colors hover:bg-surface/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="truncate text-[1.05rem] font-semibold tracking-[-0.015em] text-ink">{project.title}</h3>
          {project.status === "archived" ? <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">Archived</span> : null}
        </div>
        <p className="mt-2 max-w-[66ch] text-sm leading-6 text-ink-muted">{getProjectSummary(project)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-faint">
          <span>{project.genre || "Genre not set"}</span>
          <span className="inline-flex items-center gap-1.5"><Clock size={14} weight="regular" /> Edited {formatEditedAt(project.updatedAt)}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {project.status === "active" ? (
          <button type="button" onClick={() => onOpen(project)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px">
            Open <ArrowUpRight size={16} weight="regular" />
          </button>
        ) : (
          <button type="button" onClick={() => onOpen(project)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted">
            View <ArrowUpRight size={16} weight="regular" />
          </button>
        )}
        <button type="button" onClick={() => onRename(project)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line px-3.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink">
          <PencilSimple size={16} weight="regular" /> <span className="sm:hidden">Rename</span><span className="hidden sm:inline">Rename</span>
        </button>
        {project.status === "active" ? (
          <button type="button" aria-label={`Archive ${project.title}`} onClick={() => onArchive(project)} className="grid size-11 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-accent-soft hover:text-accent-strong">
            <Archive size={18} weight="regular" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ProjectForm({ mode, title, premise, genre, fieldErrors, formError, submitting, onTitleChange, onPremiseChange, onGenreChange, onSubmit, onCancel }: {
  mode: FormMode;
  title: string;
  premise: string;
  genre: string;
  fieldErrors: FieldErrors;
  formError: string;
  submitting: boolean;
  onTitleChange: (value: string) => void;
  onPremiseChange: (value: string) => void;
  onGenreChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const titleError = fieldErrors.title?.[0];
  const premiseError = fieldErrors.premise?.[0];
  const genreError = fieldErrors.genre?.[0];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError ? <div role="alert" className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm leading-5 text-danger"><WarningCircle size={18} weight="regular" className="mt-0.5 shrink-0" /> <span>{formError}</span></div> : null}
      <div className="space-y-2">
        <label htmlFor="project-title" className="block text-sm font-semibold text-ink">Project title</label>
        <input id="project-title" name="title" value={title} onChange={(event) => onTitleChange(event.target.value)} autoComplete="off" maxLength={120} required aria-invalid={Boolean(titleError)} aria-describedby={titleError ? "project-title-error" : undefined} className="min-h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15" placeholder="A working title" />
        {titleError ? <p id="project-title-error" className="text-sm text-danger">{titleError}</p> : null}
      </div>
      {mode === "create" ? (
        <>
          <div className="space-y-2">
            <label htmlFor="project-premise" className="block text-sm font-semibold text-ink">Premise <span className="font-normal text-ink-faint">optional</span></label>
            <textarea id="project-premise" name="premise" value={premise} onChange={(event) => onPremiseChange(event.target.value)} maxLength={2000} rows={3} aria-invalid={Boolean(premiseError)} aria-describedby={premiseError ? "project-premise-error" : undefined} className="w-full resize-y rounded-lg border border-line bg-surface px-3.5 py-3 text-sm leading-6 text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15" placeholder="What keeps this story moving?" />
            {premiseError ? <p id="project-premise-error" className="text-sm text-danger">{premiseError}</p> : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="project-genre" className="block text-sm font-semibold text-ink">Genre <span className="font-normal text-ink-faint">optional</span></label>
            <input id="project-genre" name="genre" value={genre} onChange={(event) => onGenreChange(event.target.value)} maxLength={80} aria-invalid={Boolean(genreError)} aria-describedby={genreError ? "project-genre-error" : undefined} className="min-h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15" placeholder="For example, speculative fiction" />
            {genreError ? <p id="project-genre-error" className="text-sm text-danger">{genreError}</p> : null}
          </div>
        </>
      ) : null}
      <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink">Cancel</button>
        <button type="submit" disabled={submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px disabled:cursor-wait disabled:opacity-70">
          {submitting ? <CircleNotch size={17} weight="regular" className="animate-spin" /> : mode === "create" ? <Plus size={17} weight="regular" /> : <FloppyDisk size={17} weight="regular" />}
          {submitting ? "Saving" : mode === "create" ? "Create project" : "Save name"}
        </button>
      </div>
    </form>
  );
}

export function ProjectLibrary() {
  const router = useRouter();
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState("");
  const [dialogMode, setDialogMode] = useState<FormMode | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null);
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [genre, setGenre] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  const loadProjects = useCallback(async () => {
    try {
      const payload = await readPayload(await fetch("/api/projects?includeArchived=true", { cache: "no-store" }));
      setProjects(payload.data?.projects ?? []);
      setViewState("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The project library could not be loaded.");
      setViewState("error");
    }
  }, []);

  useEffect(() => {
    const requestId = window.setTimeout(() => {
      void loadProjects();
    }, 0);

    return () => window.clearTimeout(requestId);
  }, [loadProjects]);

  function openCreateDialog() {
    setDialogMode("create");
    setRenameTarget(null);
    setTitle("");
    setPremise("");
    setGenre("");
    setFieldErrors({});
    setFormError("");
  }

  function openRenameDialog(project: Project) {
    setDialogMode("rename");
    setRenameTarget(project);
    setTitle(project.title);
    setPremise("");
    setGenre("");
    setFieldErrors({});
    setFormError("");
  }

  const closeDialog = useCallback(() => {
    if (submitting) {
      return;
    }
    setDialogMode(null);
    setRenameTarget(null);
  }, [submitting]);

  const closeArchiveDialog = useCallback(() => {
    if (!submitting) {
      setArchiveTarget(null);
    }
  }, [submitting]);

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setFormError("");
    setSubmitting(true);

    try {
      const isRename = dialogMode === "rename" && renameTarget !== null;
      const response = await fetch(isRename ? `/api/projects/${renameTarget?.id ?? ""}` : "/api/projects", {
        method: isRename ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRename ? { title } : { title, premise, genre }),
      });
      const payload = await readPayload(response);
      const savedProject = payload.data?.project;

      if (!savedProject) {
        throw new Error("The saved project was not returned by the server.");
      }

      setProjects((current) => {
        const withoutSaved = current.filter((project) => project.id !== savedProject.id);
        return [savedProject, ...withoutSaved];
      });
      setDialogMode(null);
      setRenameTarget(null);
    } catch (error) {
      if (error instanceof ProjectRequestError && error.fieldErrors) {
        setFieldErrors(error.fieldErrors);
      }
      setFormError(error instanceof Error ? error.message : "The project could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  async function archiveProject() {
    if (!archiveTarget) {
      return;
    }

    setArchiveError("");
    setSubmitting(true);

    try {
      const response = await fetch(`/api/projects/${archiveTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      const payload = await readPayload(response);
      const archived = payload.data?.project;

      if (!archived) {
        throw new Error("The archived project was not returned by the server.");
      }

      setProjects((current) => current.map((project) => project.id === archived.id ? archived : project));
      setArchiveTarget(null);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "The project could not be archived.");
    } finally {
      setSubmitting(false);
    }
  }

  const activeProjects = projects.filter((project) => project.status === "active");
  const archivedProjects = projects.filter((project) => project.status === "archived");

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <header className="border-b border-line bg-surface/80">
        <div className="mx-auto flex min-h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-3 text-sm font-semibold tracking-[-0.01em] text-ink" aria-label="Story Workspace home">
            <span className="grid size-8 place-items-center rounded-lg bg-ink text-surface"><Books size={18} weight="regular" /></span>
            <span>Story Workspace</span>
          </Link>
          <span className="hidden text-xs text-ink-faint sm:inline">A quiet place for long-form work</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <div className="flex flex-col justify-between gap-7 border-b border-line pb-9 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Project library</p>
            <h1 className="mt-3 max-w-[15ch] text-4xl font-semibold leading-[1.02] tracking-[-0.05em] text-ink sm:text-5xl">Stories in progress</h1>
            <p className="mt-4 max-w-[52ch] text-base leading-7 text-ink-muted">Keep the premise, structure, and pages of each story close at hand.</p>
          </div>
          <button type="button" onClick={openCreateDialog} className="inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px">
            <Plus size={18} weight="regular" /> New project
          </button>
        </div>

        {viewState === "error" ? (
          <div role="alert" className="mt-8 flex flex-col gap-4 rounded-xl border border-danger/30 bg-danger/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <WarningCircle size={21} weight="regular" className="mt-0.5 shrink-0 text-danger" />
              <div><h2 className="font-semibold text-ink">The library is unavailable</h2><p className="mt-1 text-sm leading-6 text-ink-muted">{loadError || "Try loading your projects again."}</p></div>
            </div>
            <button type="button" onClick={() => { setViewState("loading"); setLoadError(""); void loadProjects(); }} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-danger/40 px-3.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/10"><ArrowCounterClockwise size={17} weight="regular" /> Try again</button>
          </div>
        ) : null}

        {viewState === "loading" ? <div className="mt-8"><LoadingRows /></div> : null}

        {viewState === "ready" && activeProjects.length === 0 ? (
          <section className="mt-8 rounded-xl border border-line bg-surface-raised px-6 py-14 text-center sm:px-12">
            <div className="mx-auto grid size-14 place-items-center rounded-xl bg-accent-soft text-accent"><Books size={28} weight="regular" /></div>
            <h2 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-ink">Start with one clear idea</h2>
            <p className="mx-auto mt-3 max-w-[46ch] text-sm leading-6 text-ink-muted">Create a project to hold the premise, story bible, outline, and chapters as they develop.</p>
            <button type="button" onClick={openCreateDialog} className="mt-7 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px"><Plus size={18} weight="regular" /> Create your first project</button>
          </section>
        ) : null}

        {viewState === "ready" && activeProjects.length > 0 ? (
          <section aria-labelledby="active-projects-heading" className="mt-8 overflow-hidden rounded-xl border border-line bg-surface-raised">
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
              <h2 id="active-projects-heading" className="text-sm font-semibold text-ink">Active projects</h2>
              <span className="text-xs text-ink-faint">{activeProjects.length} {activeProjects.length === 1 ? "project" : "projects"}</span>
            </div>
            <div className="divide-y divide-line">
              {activeProjects.map((project) => <ProjectRow key={project.id} project={project} onOpen={(item) => router.push(`/projects/${item.id}`)} onRename={openRenameDialog} onArchive={setArchiveTarget} />)}
            </div>
          </section>
        ) : null}

        {viewState === "ready" && archivedProjects.length > 0 ? (
          <section aria-labelledby="archived-projects-heading" className="mt-10">
            <div className="mb-4 flex items-center justify-between gap-4 px-1">
              <div><h2 id="archived-projects-heading" className="text-sm font-semibold text-ink">Archived</h2><p className="mt-1 text-xs text-ink-faint">Kept for reference and never deleted.</p></div>
              <span className="text-xs text-ink-faint">{archivedProjects.length} {archivedProjects.length === 1 ? "project" : "projects"}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-surface-raised divide-y divide-line">
              {archivedProjects.map((project) => <ProjectRow key={project.id} project={project} onOpen={(item) => router.push(`/projects/${item.id}`)} onRename={openRenameDialog} onArchive={setArchiveTarget} />)}
            </div>
          </section>
        ) : null}

        {viewState === "ready" ? <p className="mt-10 flex items-center gap-2 text-xs text-ink-faint"><Check size={15} weight="regular" className="text-success" /> Changes save locally to this workspace.</p> : null}
      </main>

      {dialogMode ? <Dialog title={dialogMode === "create" ? "Create a project" : "Rename project"} description={dialogMode === "create" ? "Give the story a home. You can refine every field later." : "Use a name that makes this draft easy to find."} onClose={closeDialog}><ProjectForm mode={dialogMode} title={title} premise={premise} genre={genre} fieldErrors={fieldErrors} formError={formError} submitting={submitting} onTitleChange={setTitle} onPremiseChange={setPremise} onGenreChange={setGenre} onSubmit={submitProject} onCancel={closeDialog} /></Dialog> : null}

      {archiveTarget ? <Dialog title="Archive this project?" description="Archiving removes it from the active shelf but keeps its story data safe." onClose={closeArchiveDialog}><div className="space-y-5"><div className="rounded-lg bg-surface px-4 py-3"><p className="font-semibold text-ink">{archiveTarget.title}</p><p className="mt-1 text-sm text-ink-muted">You can still view it from Archived later.</p></div>{archiveError ? <div role="alert" className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm leading-5 text-danger"><WarningCircle size={18} weight="regular" className="mt-0.5 shrink-0" /> <span>{archiveError}</span></div> : null}<div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end"><button type="button" onClick={() => setArchiveTarget(null)} disabled={submitting} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-60">Keep active</button><button type="button" onClick={() => void archiveProject()} disabled={submitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-strong active:translate-y-px disabled:cursor-wait disabled:opacity-70">{submitting ? <CircleNotch size={17} weight="regular" className="animate-spin" /> : <Archive size={17} weight="regular" />}{submitting ? "Archiving" : "Archive project"}</button></div></div></Dialog> : null}
    </div>
  );
}
