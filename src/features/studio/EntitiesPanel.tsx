"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import type { StudioEntity, StudioEntityKind } from "@/studio/domain";
import { STUDIO_ENTITY_KINDS } from "@/studio/domain";
import { useI18n } from "@/features/i18n/LocaleProvider";
import {
  createStudioEntity,
  entityDraftFrom,
  entityDraftsEqual,
  getStudioEntity,
  listStudioEntities,
  readConflictEntity,
  StudioRequestError,
  updateStudioEntity,
  type EntityDraft,
} from "./api";
import { ConflictBanner } from "./ConflictBanner";
import { useDebouncedSave } from "./useDebouncedSave";

const fieldClassName =
  "w-full rounded-lg border border-line bg-surface px-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15";

const emptyDraft: EntityDraft = {
  name: "",
  description: "",
  visualBase: "",
  outfit: "",
  condition: "",
};

const KIND_LABELS: Record<StudioEntityKind, string> = {
  character: "Characters",
  location: "Locations",
  prop: "Props",
  costume: "Costumes",
};

const KIND_NAME_LABELS: Record<StudioEntityKind, string> = {
  character: "Character name",
  location: "Location name",
  prop: "Prop name",
  costume: "Costume name",
};

const KIND_CREATE_LABELS: Record<StudioEntityKind, string> = {
  character: "New character",
  location: "New location",
  prop: "New prop",
  costume: "New costume",
};

const emptyNameDrafts = (): Record<StudioEntityKind, string> => ({
  character: "",
  location: "",
  prop: "",
  costume: "",
});

const emptyEntityLists = (): Record<StudioEntityKind, StudioEntity[]> => ({
  character: [],
  location: [],
  prop: [],
  costume: [],
});

export function EntitiesPanel({
  projectId,
  flushRef,
  active,
}: {
  projectId: string;
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  active: boolean;
}) {
  const { t } = useI18n();
  const [entitiesByKind, setEntitiesByKind] = useState(emptyEntityLists);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameDrafts, setNameDrafts] = useState(emptyNameDrafts);
  const [creating, setCreating] = useState<StudioEntityKind | null>(null);
  const editorFlushRef = useRef<(() => Promise<boolean>) | null>(null);

  const flush = useCallback(async () => {
    if (!editorFlushRef.current) {
      return true;
    }
    return editorFlushRef.current();
  }, []);

  useEffect(() => {
    if (!active) return;
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) {
        flushRef.current = null;
      }
    };
  }, [active, flush, flushRef]);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void Promise.all(STUDIO_ENTITY_KINDS.map((kind) => listStudioEntities(projectId, kind)))
        .then((lists) => {
          if (cancelled) {
            return;
          }
          const next = emptyEntityLists();
          STUDIO_ENTITY_KINDS.forEach((kind, index) => {
            next[kind] = lists[index] ?? [];
          });
          setEntitiesByKind(next);
          setSelectedId((current) => {
            if (current) {
              return current;
            }
            for (const kind of STUDIO_ENTITY_KINDS) {
              const first = next[kind][0];
              if (first) {
                return first.id;
              }
            }
            return null;
          });
        })
        .catch((error) => {
          if (!cancelled) {
            setListError(error instanceof Error ? error.message : t("The workspace could not be loaded."));
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [projectId, t]);

  const allEntities = STUDIO_ENTITY_KINDS.flatMap((kind) => entitiesByKind[kind]);
  const selectedEntity = allEntities.find((item) => item.id === selectedId) ?? null;

  async function selectEntity(id: string) {
    if (id === selectedId) {
      return;
    }
    const ok = await flush();
    if (!ok) {
      return;
    }
    setSelectedId(id);
  }

  async function createKind(event: FormEvent<HTMLFormElement>, kind: StudioEntityKind) {
    event.preventDefault();
    const name = nameDrafts[kind].trim();
    if (!name) {
      return;
    }
    const ok = await flush();
    if (!ok) {
      return;
    }
    setCreating(kind);
    try {
      const created = await createStudioEntity(projectId, { kind, name });
      setNameDrafts((current) => ({ ...current, [kind]: "" }));
      setEntitiesByKind((current) => ({
        ...current,
        [kind]: upsertEntity(current[kind], created),
      }));
      setSelectedId(created.id);
    } catch (error) {
      setListError(error instanceof Error ? error.message : t("The request could not be completed."));
    } finally {
      setCreating(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="flex min-h-0 flex-col gap-8 border-b border-line bg-surface px-4 py-5 lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r lg:overflow-y-auto">
        {listError ? <p role="alert" className="text-sm text-danger">{listError}</p> : null}
        {STUDIO_ENTITY_KINDS.map((kind) => (
          <EntityKindSection
            key={kind}
            kind={kind}
            title={t(KIND_LABELS[kind])}
            nameLabel={t(KIND_NAME_LABELS[kind])}
            createLabel={t(KIND_CREATE_LABELS[kind])}
            nameValue={nameDrafts[kind]}
            onNameChange={(value) => setNameDrafts((current) => ({ ...current, [kind]: value }))}
            entities={entitiesByKind[kind]}
            selectedId={selectedId}
            creating={creating}
            onCreate={(event) => void createKind(event, kind)}
            onSelect={(id) => void selectEntity(id)}
          />
        ))}
      </aside>

      {selectedId ? (
        <EntityEditor
          key={selectedId}
          projectId={projectId}
          entityId={selectedId}
          initialEntity={selectedEntity}
          flushRef={editorFlushRef}
          onSaved={(saved) => {
            setEntitiesByKind((current) => {
              const next = emptyEntityLists();
              for (const kind of STUDIO_ENTITY_KINDS) {
                next[kind] = current[kind].filter((item) => item.id !== saved.id);
              }
              next[saved.kind] = upsertEntity(next[saved.kind], saved);
              return next;
            });
          }}
        />
      ) : (
        <section className="min-h-0 min-w-0 flex-1 px-5 py-6 sm:px-8">
          <p className="text-sm text-ink-muted">{t("Select an entity")}</p>
        </section>
      )}
    </div>
  );
}

function EntityKindSection({
  kind,
  title,
  nameLabel,
  createLabel,
  nameValue,
  onNameChange,
  entities,
  selectedId,
  creating,
  onCreate,
  onSelect,
}: {
  kind: StudioEntityKind;
  title: string;
  nameLabel: string;
  createLabel: string;
  nameValue: string;
  onNameChange: (value: string) => void;
  entities: StudioEntity[];
  selectedId: string | null;
  creating: StudioEntityKind | null;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onSelect: (id: string) => void;
}) {
  const inputId = `${kind}-name`;
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <form className="mt-3 space-y-2" onSubmit={onCreate}>
        <label htmlFor={inputId} className="block text-xs font-semibold text-ink-muted">
          {nameLabel}
        </label>
        <input
          id={inputId}
          value={nameValue}
          onChange={(event) => onNameChange(event.target.value)}
          autoComplete="off"
          maxLength={120}
          className={`${fieldClassName} min-h-11`}
        />
        <button
          type="submit"
          disabled={creating !== null || nameValue.trim().length === 0}
          className="inline-flex min-h-10 items-center rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {createLabel}
        </button>
      </form>
      <ul className="mt-3 space-y-1">
        {entities.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-pressed={selectedId === item.id}
              className={`flex min-h-10 w-full items-center rounded-lg px-2 text-left text-sm transition-colors ${selectedId === item.id ? "bg-accent-soft font-semibold text-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`}
            >
              <span className="truncate">{item.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EntityEditor({
  projectId,
  entityId,
  initialEntity,
  flushRef,
  onSaved,
}: {
  projectId: string;
  entityId: string;
  initialEntity: StudioEntity | null;
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  onSaved: (entity: StudioEntity) => void;
}) {
  const { t } = useI18n();
  const [entity, setEntity] = useState<StudioEntity | null>(initialEntity);
  const [draft, setDraft] = useState<EntityDraft>(initialEntity ? entityDraftFrom(initialEntity) : emptyDraft);
  const [committed, setCommitted] = useState<EntityDraft>(initialEntity ? entityDraftFrom(initialEntity) : emptyDraft);
  const [conflict, setConflict] = useState<StudioEntity | null>(null);
  const [saveError, setSaveError] = useState("");
  const [nameError, setNameError] = useState("");
  const [busy, setBusy] = useState(false);

  const entityRef = useRef<StudioEntity | null>(initialEntity);
  const draftRef = useRef<EntityDraft>(initialEntity ? entityDraftFrom(initialEntity) : emptyDraft);
  const committedRef = useRef<EntityDraft>(initialEntity ? entityDraftFrom(initialEntity) : emptyDraft);
  const conflictRef = useRef<StudioEntity | null>(null);
  const onSavedRef = useRef(onSaved);

  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const dirty = entity !== null && !entityDraftsEqual(draft, committed);
  const blocked = conflict !== null;

  const persist = useCallback(async () => {
    const current = entityRef.current;
    const nextDraft = draftRef.current;
    if (!current) {
      return true;
    }
    if (conflictRef.current) {
      return false;
    }
    if (entityDraftsEqual(nextDraft, committedRef.current)) {
      return true;
    }
    if (nextDraft.name.trim().length === 0) {
      setNameError(t("Entity name is required"));
      return false;
    }

    try {
      const saved = await updateStudioEntity(projectId, current.id, {
        name: nextDraft.name.trim(),
        description: nextDraft.description,
        visual: { base: nextDraft.visualBase, references: current.visual.references },
        states: { default: { outfit: nextDraft.outfit, condition: nextDraft.condition } },
        expectedUpdatedAt: current.updatedAt,
      });
      const savedDraft = entityDraftFrom(saved);
      entityRef.current = saved;
      committedRef.current = savedDraft;
      setEntity(saved);
      setCommitted(savedDraft);
      if (entityDraftsEqual(draftRef.current, nextDraft)) {
        draftRef.current = savedDraft;
        setDraft(savedDraft);
      }
      conflictRef.current = null;
      setConflict(null);
      setNameError("");
      setSaveError("");
      onSavedRef.current(saved);
      return true;
    } catch (error) {
      if (error instanceof StudioRequestError && error.code === "EDIT_CONFLICT") {
        const currentRecord = readConflictEntity(error);
        if (currentRecord) {
          conflictRef.current = currentRecord;
          setConflict(currentRecord);
          return false;
        }
      }
      if (error instanceof StudioRequestError && error.fieldErrors?.name?.[0]) {
        setNameError(error.fieldErrors.name[0]);
      }
      setSaveError(error instanceof Error ? error.message : t("The request could not be completed."));
      return false;
    }
  }, [projectId, t]);

  const isDirty = useCallback(() => {
    return entityRef.current !== null && !entityDraftsEqual(draftRef.current, committedRef.current);
  }, []);

  const flush = useDebouncedSave({
    revision: `${draft.name}\n${draft.description}\n${draft.visualBase}\n${draft.outfit}\n${draft.condition}`,
    dirty,
    blocked,
    isDirty,
    save: persist,
  });

  useEffect(() => {
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) {
        flushRef.current = null;
      }
    };
  }, [flush, flushRef]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty() && !conflictRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    let cancelled = false;
    const requestId = window.setTimeout(() => {
      void getStudioEntity(projectId, entityId)
        .then((record) => {
          if (cancelled || !entityDraftsEqual(draftRef.current, committedRef.current)) {
            return;
          }
          applyRecord(record, entityRef, draftRef, committedRef, conflictRef, setEntity, setDraft, setCommitted, setConflict);
          onSavedRef.current(record);
        })
        .catch((error) => {
          if (!cancelled) {
            setSaveError(error instanceof Error ? error.message : t("The workspace could not be loaded."));
          }
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(requestId);
    };
  }, [entityId, projectId, t]);

  function updateDraft(patch: Partial<EntityDraft>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
  }

  async function overwrite() {
    const current = entityRef.current;
    const server = conflictRef.current;
    const nextDraft = draftRef.current;
    if (!current || !server) {
      return;
    }
    if (nextDraft.name.trim().length === 0) {
      setNameError(t("Entity name is required"));
      return;
    }
    setBusy(true);
    try {
      const saved = await updateStudioEntity(projectId, current.id, {
        name: nextDraft.name.trim(),
        description: nextDraft.description,
        visual: { base: nextDraft.visualBase, references: current.visual.references },
        states: { default: { outfit: nextDraft.outfit, condition: nextDraft.condition } },
        expectedUpdatedAt: server.updatedAt,
      });
      applyRecord(saved, entityRef, draftRef, committedRef, conflictRef, setEntity, setDraft, setCommitted, setConflict);
      setSaveError("");
      onSavedRef.current(saved);
    } catch (error) {
      if (error instanceof StudioRequestError && error.code === "EDIT_CONFLICT") {
        const currentRecord = readConflictEntity(error);
        if (currentRecord) {
          conflictRef.current = currentRecord;
          setConflict(currentRecord);
          return;
        }
      }
      setSaveError(error instanceof Error ? error.message : t("The request could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const current = entityRef.current;
    if (!current) {
      return;
    }
    setBusy(true);
    try {
      const latest = await getStudioEntity(projectId, current.id);
      applyRecord(latest, entityRef, draftRef, committedRef, conflictRef, setEntity, setDraft, setCommitted, setConflict);
      onSavedRef.current(latest);
    } catch {
      const server = conflictRef.current;
      if (server) {
        applyRecord(server, entityRef, draftRef, committedRef, conflictRef, setEntity, setDraft, setCommitted, setConflict);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!entity) {
    return (
      <section className="min-h-0 min-w-0 flex-1 px-5 py-6 sm:px-8">
        <div className="space-y-4">
          <div className="h-11 animate-pulse rounded-lg bg-surface-muted" />
          <div className="h-32 animate-pulse rounded-lg bg-surface-muted" />
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto flex max-w-[760px] flex-col gap-5">
        {conflict ? (
          <ConflictBanner
            busy={busy}
            onOverwrite={() => void overwrite()}
            onDiscard={() => void discard()}
            preview={
              <div className="space-y-3 text-sm">
                <PreviewField label={t("Name")} value={conflict.name} />
                <PreviewField label={t("Description")} value={conflict.description} />
                <PreviewField label={t("Visual base")} value={conflict.visual.base} />
                <PreviewField label={t("Outfit")} value={conflict.states.default.outfit} />
                <PreviewField label={t("Condition")} value={conflict.states.default.condition} />
              </div>
            }
          />
        ) : null}
        {saveError ? <p role="alert" className="text-sm text-danger">{saveError}</p> : null}
        <div className="space-y-2">
          <label htmlFor="entity-name" className="block text-sm font-semibold text-ink">
            {t("Name")}
          </label>
          <input
            id="entity-name"
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.target.value })}
            onBlur={() => void flush()}
            aria-invalid={Boolean(nameError)}
            className={`${fieldClassName} min-h-11`}
          />
          {nameError ? <p className="text-sm text-danger">{nameError}</p> : null}
        </div>
        <div className="space-y-2">
          <label htmlFor="entity-description" className="block text-sm font-semibold text-ink">
            {t("Description")}
          </label>
          <textarea
            id="entity-description"
            value={draft.description}
            onChange={(event) => updateDraft({ description: event.target.value })}
            onBlur={() => void flush()}
            rows={5}
            className={`${fieldClassName} resize-y py-3 leading-6`}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="entity-visual-base" className="block text-sm font-semibold text-ink">
            {t("Visual base")}
          </label>
          <textarea
            id="entity-visual-base"
            value={draft.visualBase}
            onChange={(event) => updateDraft({ visualBase: event.target.value })}
            onBlur={() => void flush()}
            rows={4}
            className={`${fieldClassName} resize-y py-3 leading-6`}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="entity-outfit" className="block text-sm font-semibold text-ink">
              {t("Outfit")}
            </label>
            <input
              id="entity-outfit"
              value={draft.outfit}
              onChange={(event) => updateDraft({ outfit: event.target.value })}
              onBlur={() => void flush()}
              className={`${fieldClassName} min-h-11`}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="entity-condition" className="block text-sm font-semibold text-ink">
              {t("Condition")}
            </label>
            <input
              id="entity-condition"
              value={draft.condition}
              onChange={(event) => updateDraft({ condition: event.target.value })}
              onBlur={() => void flush()}
              className={`${fieldClassName} min-h-11`}
            />
          </div>
        </div>
        <p
          className="text-xs text-ink-faint"
          aria-live="polite"
          data-save-state={conflict ? "conflict" : dirty ? "saving" : "saved"}
        >
          {conflict ? t("Unsaved changes") : dirty ? t("Saving") : t("Saved")}
        </p>
      </div>
    </section>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-ink">{value}</p>
    </div>
  );
}

function applyRecord(
  record: StudioEntity,
  entityRef: MutableRefObject<StudioEntity | null>,
  draftRef: MutableRefObject<EntityDraft>,
  committedRef: MutableRefObject<EntityDraft>,
  conflictRef: MutableRefObject<StudioEntity | null>,
  setEntity: (entity: StudioEntity) => void,
  setDraft: (draft: EntityDraft) => void,
  setCommitted: (draft: EntityDraft) => void,
  setConflict: (conflict: StudioEntity | null) => void,
) {
  const nextDraft = entityDraftFrom(record);
  entityRef.current = record;
  draftRef.current = nextDraft;
  committedRef.current = nextDraft;
  conflictRef.current = null;
  setEntity(record);
  setDraft(nextDraft);
  setCommitted(nextDraft);
  setConflict(null);
}

function upsertEntity(list: StudioEntity[], entity: StudioEntity) {
  const without = list.filter((item) => item.id !== entity.id);
  return [...without, entity].sort((left, right) => left.id.localeCompare(right.id));
}
