"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, GearSix, House, Images, ListNumbers, Notebook, TreeStructure, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { StudioProject } from "@/studio/domain";
import { LanguageSwitcher } from "@/features/i18n/LanguageSwitcher";
import { useI18n } from "@/features/i18n/LocaleProvider";
import { getStudioProject } from "./api";
import { EntitiesPanel } from "./EntitiesPanel";
import { OutputsPanel } from "./OutputsPanel";
import { OutlinePanel } from "./OutlinePanel";
import { OverviewPanel } from "./OverviewPanel";
import { SettingsPanel } from "./SettingsPanel";
import { StoryPanel } from "./StoryPanel";
import { WorkflowPanel } from "./WorkflowPanel";
import { readSectionFromLocation, studioSectionHref, type StudioSection } from "./sections";

const sectionItems: Array<{
  id: StudioSection;
  label: "Overview" | "Story" | "Story outline" | "Entities" | "Workflow" | "Outputs" | "Settings";
  Icon: typeof House;
}> = [
  { id: "overview", label: "Overview", Icon: House },
  { id: "story", label: "Story", Icon: Notebook },
  { id: "outline", label: "Story outline", Icon: ListNumbers },
  { id: "entities", label: "Entities", Icon: UsersThree },
  { id: "workflow", label: "Workflow", Icon: TreeStructure },
  { id: "outputs", label: "Outputs", Icon: Images },
  { id: "settings", label: "Settings", Icon: GearSix },
];

export function StudioWorkspace({
  projectId,
  initialSection,
}: {
  projectId: string;
  initialSection: StudioSection;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [section, setSection] = useState(initialSection);
  const [seenSection, setSeenSection] = useState(initialSection);
  const [mountedSections, setMountedSections] = useState(() => new Set<StudioSection>([initialSection]));
  if (seenSection !== initialSection) {
    setSeenSection(initialSection);
    setSection(initialSection);
  }
  if (!mountedSections.has(section)) {
    const nextMounted = new Set(mountedSections);
    nextMounted.add(section);
    setMountedSections(nextMounted);
  }

  const [project, setProject] = useState<StudioProject | null>(null);
  const [loadError, setLoadError] = useState("");
  const [navigationPending, setNavigationPending] = useState(false);
  const [parseBusy, setParseBusy] = useState(false);
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void getStudioProject(projectId)
        .then((record) => {
          if (!cancelled) {
            setProject(record);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setLoadError(error instanceof Error ? error.message : t("The workspace could not be loaded."));
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [projectId, t]);

  const flushActive = useCallback(async () => {
    if (!flushRef.current) {
      return true;
    }
    return flushRef.current();
  }, []);

  const goToSection = useCallback(async (next: StudioSection) => {
    if (next === section) {
      return;
    }
    setNavigationPending(true);
    try {
      const ok = await flushActive();
      if (!ok) {
        return;
      }
      setSection(next);
      window.history.replaceState(window.history.state, "", studioSectionHref(projectId, next));
    } finally {
      setNavigationPending(false);
    }
  }, [flushActive, projectId, section]);

  useEffect(() => {
    const onPopState = () => {
      setSection(readSectionFromLocation(window.location));
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const goToLibrary = useCallback(async () => {
    setNavigationPending(true);
    try {
      const ok = await flushActive();
      if (!ok) {
        return;
      }
      router.push("/");
    } finally {
      setNavigationPending(false);
    }
  }, [flushActive, router]);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1440px]">
        <aside className="hidden w-[260px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <div className="border-b border-line px-5 py-5">
            <Link
              href="/"
              aria-disabled={navigationPending}
              onNavigate={(event) => {
                event.preventDefault();
                void goToLibrary();
              }}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink ${navigationPending ? "cursor-wait opacity-60" : ""}`}
            >
              <ArrowLeft size={18} weight="regular" aria-hidden="true" />
              {t("Back to project library")}
            </Link>
            <div className="mt-5 min-w-0">
              <p className="truncate text-base font-semibold tracking-[-0.02em] text-ink">{project?.title ?? projectId}</p>
              <p className="mt-1 font-mono text-xs text-ink-faint">{projectId}</p>
            </div>
          </div>
          <WorkspaceNav
            section={section}
            disabled={navigationPending}
            onSectionChange={(next) => void goToSection(next)}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line bg-surface/80 px-4 py-3 lg:px-6">
            <Link
              href="/"
              aria-disabled={navigationPending}
              onNavigate={(event) => {
                event.preventDefault();
                void goToLibrary();
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink lg:hidden"
            >
              <ArrowLeft size={18} weight="regular" aria-hidden="true" />
              {t("Back to project library")}
            </Link>
            <p className="hidden truncate text-sm font-semibold text-ink lg:block">{project?.title ?? ""}</p>
            <LanguageSwitcher />
          </header>

          <div className="border-b border-line bg-surface px-3 py-2 lg:hidden">
            <WorkspaceNav
              section={section}
              disabled={navigationPending}
              onSectionChange={(next) => void goToSection(next)}
              compact
            />
          </div>

          {parseBusy && section !== "story" ? (
            <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-muted px-4 py-2">
              <p className="text-sm text-ink-muted">{t("Parse still running")}</p>
              <button
                type="button"
                onClick={() => void goToSection("story")}
                disabled={navigationPending}
                className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-surface disabled:opacity-60"
              >
                {t("Back to Story")}
              </button>
            </div>
          ) : null}

          <main className="flex min-h-0 flex-1 flex-col">
            {loadError ? (
              <div className="m-6 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/10 px-5 py-5">
                <WarningCircle size={21} weight="regular" className="mt-0.5 shrink-0 text-danger" />
                <div>
                  <h1 className="font-semibold text-ink">{t("The project could not be opened.")}</h1>
                  <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
                </div>
              </div>
            ) : null}

            {!loadError && mountedSections.has("overview") && project ? (
              <KeepAlivePanel active={section === "overview"}>
                <OverviewPanel project={project} onOpenSection={(next) => void goToSection(next)} />
              </KeepAlivePanel>
            ) : null}
            {!loadError && mountedSections.has("story") ? (
              <KeepAlivePanel active={section === "story"}>
                <StoryPanel
                  projectId={projectId}
                  flushRef={flushRef}
                  active={section === "story"}
                  onParseBusyChange={setParseBusy}
                />
              </KeepAlivePanel>
            ) : null}
            {!loadError && mountedSections.has("outline") ? (
              <KeepAlivePanel active={section === "outline"}>
                <OutlinePanel projectId={projectId} />
              </KeepAlivePanel>
            ) : null}
            {!loadError && mountedSections.has("entities") ? (
              <KeepAlivePanel active={section === "entities"}>
                <EntitiesPanel projectId={projectId} flushRef={flushRef} active={section === "entities"} />
              </KeepAlivePanel>
            ) : null}
            {!loadError && mountedSections.has("workflow") ? (
              <KeepAlivePanel active={section === "workflow"}>
                <WorkflowPanel projectId={projectId} />
              </KeepAlivePanel>
            ) : null}
            {!loadError && mountedSections.has("outputs") ? (
              <KeepAlivePanel active={section === "outputs"}>
                <OutputsPanel projectId={projectId} active={section === "outputs"} />
              </KeepAlivePanel>
            ) : null}
            {!loadError && mountedSections.has("settings") ? (
              <KeepAlivePanel active={section === "settings"}>
                <SettingsPanel />
              </KeepAlivePanel>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

function KeepAlivePanel({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div hidden={!active} inert={!active} className={active ? "flex min-h-0 flex-1 flex-col" : undefined}>
      {children}
    </div>
  );
}

function WorkspaceNav({
  section,
  disabled,
  onSectionChange,
  compact = false,
}: {
  section: StudioSection;
  disabled: boolean;
  onSectionChange: (section: StudioSection) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <nav aria-label={t("Workspace sections")} className={compact ? "flex gap-1 overflow-x-auto" : "flex-1 space-y-1 overflow-y-auto px-3 py-4"}>
      {sectionItems.map(({ id, label, Icon }) => {
        const active = section === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSectionChange(id)}
            disabled={disabled}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-left transition-colors ${compact ? "shrink-0" : "w-full"} ${active ? "bg-accent-soft text-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`}
          >
            <Icon size={19} weight={active ? "bold" : "regular"} className={active ? "text-accent" : "text-ink-faint"} aria-hidden="true" />
            <span className="text-sm font-semibold">{t(label)}</span>
          </button>
        );
      })}
    </nav>
  );
}
