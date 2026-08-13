import type { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 13;

function runMigration(database: DatabaseSync, version: number, migration: () => void) {
  database.exec("BEGIN IMMEDIATE");
  try {
    migration();
    database.exec(`PRAGMA user_version = ${version}`);
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the migration error if SQLite has already closed the transaction.
    }
    throw error;
  }
}

export function bootstrapDatabase(database: DatabaseSync) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
  `);

  const versionRow = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < 1) {
    runMigration(database, 1, () => database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        premise TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_status_updated_at
        ON projects(status, updated_at DESC);

    `));
  }

  if (currentVersion < 2) {
    runMigration(database, 2, () => database.exec(`
      CREATE TABLE IF NOT EXISTS bible_entries (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('world', 'character', 'location', 'rule', 'theme')),
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_bible_entries_project_position
        ON bible_entries(project_id, position, id);

      CREATE TABLE IF NOT EXISTS outline_nodes (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        parent_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('story', 'act', 'chapter', 'scene')),
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES outline_nodes(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_outline_nodes_project_position
        ON outline_nodes(project_id, position, id);
      CREATE INDEX IF NOT EXISTS idx_outline_nodes_parent
        ON outline_nodes(parent_id);

      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        outline_node_id TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'draft', 'revised', 'final')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (outline_node_id) REFERENCES outline_nodes(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chapters_project_position
        ON chapters(project_id, position, id);
      CREATE INDEX IF NOT EXISTS idx_chapters_outline_node
        ON chapters(outline_node_id);

      CREATE TABLE IF NOT EXISTS chapter_versions (
        id TEXT PRIMARY KEY NOT NULL,
        chapter_id TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('manual', 'restore_backup', 'ai')),
        ai_action TEXT,
        instruction TEXT,
        context_reference_ids TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chapter_versions_chapter_created
        ON chapter_versions(chapter_id, created_at DESC, id DESC);

    `));
  }

  if (currentVersion < 3) {
    runMigration(database, 3, () => database.exec(`
      CREATE TABLE IF NOT EXISTS ai_generations (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        target_chapter_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('brainstorm', 'continue', 'rewrite', 'summarize', 'consistency', 'adapt')),
        instruction TEXT NOT NULL,
        context_reference_ids TEXT NOT NULL,
        generated_markdown TEXT NOT NULL,
        created_at TEXT NOT NULL,
        accepted_version_id TEXT UNIQUE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (target_chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (accepted_version_id) REFERENCES chapter_versions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ai_generations_project_created
        ON ai_generations(project_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_generations_target_created
        ON ai_generations(target_chapter_id, created_at DESC, id DESC);
    `));
  }

  if (currentVersion < 4) {
    runMigration(database, 4, () => database.exec(`
      CREATE TABLE adaptations (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('screenplay_scene')),
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
        source_generation_id TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (source_generation_id) REFERENCES ai_generations(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_adaptations_project_position
        ON adaptations(project_id, position, id);
    `));
  }

  if (currentVersion < 5) {
    runMigration(database, 5, () => database.exec(`
      CREATE TABLE IF NOT EXISTS script_documents (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'screenplay' CHECK (kind IN ('screenplay', 'prose', 'outline')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        current_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_script_documents_project_updated_at
        ON script_documents(project_id, status, updated_at DESC, id);

      CREATE TABLE IF NOT EXISTS document_revisions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL CHECK (revision_number > 0),
        base_version INTEGER NOT NULL CHECK (base_version >= 0),
        content_hash TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'local-user',
        request_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES script_documents(id) ON DELETE CASCADE,
        UNIQUE (document_id, revision_number),
        UNIQUE (project_id, document_id, request_id)
      );

      CREATE INDEX IF NOT EXISTS idx_document_revisions_document_created
        ON document_revisions(document_id, revision_number DESC, id DESC);

      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        narrative_rank INTEGER NOT NULL CHECK (narrative_rank >= 0),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES script_documents(id) ON DELETE CASCADE,
        UNIQUE (document_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_scenes_document_rank
        ON scenes(document_id, status, narrative_rank, id);

      CREATE TABLE IF NOT EXISTS scene_revisions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        document_revision_id TEXT NOT NULL,
        narrative_rank INTEGER NOT NULL CHECK (narrative_rank >= 0),
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES script_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
        FOREIGN KEY (document_revision_id) REFERENCES document_revisions(id) ON DELETE CASCADE,
        UNIQUE (document_revision_id, scene_id)
      );

      CREATE INDEX IF NOT EXISTS idx_scene_revisions_document_revision_rank
        ON scene_revisions(document_revision_id, narrative_rank, scene_id);
      CREATE INDEX IF NOT EXISTS idx_scene_revisions_scene_created
        ON scene_revisions(scene_id, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'location', 'prop', 'organization', 'event')),
        canonical_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived', 'merged')),
        merged_into_entity_id TEXT,
        attributes_json TEXT NOT NULL DEFAULT '{}',
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (merged_into_entity_id) REFERENCES entities(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entities_project_type_status
        ON entities(project_id, entity_type, status, canonical_name, id);

      CREATE TABLE IF NOT EXISTS entity_aliases (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        locale TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        UNIQUE (project_id, entity_id, normalized_alias)
      );

      CREATE INDEX IF NOT EXISTS idx_entity_aliases_project_normalized
        ON entity_aliases(project_id, normalized_alias, status, entity_id);

      CREATE TABLE IF NOT EXISTS evidence_sources (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('text_span', 'user_input', 'import', 'asset', 'model_output')),
        document_id TEXT,
        scene_id TEXT,
        scene_revision_id TEXT,
        revision_id TEXT,
        anchor_start TEXT,
        anchor_end TEXT,
        quoted_text TEXT,
        created_by_user_id TEXT,
        model_run_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES script_documents(id) ON DELETE SET NULL,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
        FOREIGN KEY (scene_revision_id) REFERENCES scene_revisions(id) ON DELETE SET NULL,
        FOREIGN KEY (revision_id) REFERENCES scene_revisions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_evidence_sources_project_created
        ON evidence_sources(project_id, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        subject_entity_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        value_json TEXT NOT NULL,
        value_type TEXT NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'enum', 'entity_ref', 'json')),
        truth_class TEXT NOT NULL DEFAULT 'canon' CHECK (truth_class = 'canon'),
        scope TEXT NOT NULL CHECK (scope IN ('base', 'scene', 'range')),
        scene_id TEXT,
        valid_from_scene_id TEXT,
        valid_to_scene_id TEXT,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'retracted')),
        supersedes_fact_id TEXT,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
        FOREIGN KEY (valid_from_scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
        FOREIGN KEY (valid_to_scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
        FOREIGN KEY (source_id) REFERENCES evidence_sources(id) ON DELETE RESTRICT,
        FOREIGN KEY (supersedes_fact_id) REFERENCES facts(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_facts_project_subject_predicate
        ON facts(project_id, subject_entity_id, predicate, status, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_facts_supersedes
        ON facts(supersedes_fact_id);

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_version INTEGER,
        payload_json TEXT NOT NULL DEFAULT '{}',
        actor_id TEXT NOT NULL DEFAULT 'local-user',
        request_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE (project_id, request_id, event_type, aggregate_type, aggregate_id)
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_project_created
        ON audit_events(project_id, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS outbox_events (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_version INTEGER,
        payload_json TEXT NOT NULL DEFAULT '{}',
        request_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        available_at TEXT NOT NULL,
        published_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE (project_id, request_id, event_type, aggregate_type, aggregate_id)
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_events_pending
        ON outbox_events(status, available_at, created_at, id);

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE (project_id, operation, request_id)
      );

      CREATE INDEX IF NOT EXISTS idx_idempotency_project_operation
        ON idempotency_keys(project_id, operation, request_id);

      /*
       * SQLite's simple foreign keys validate identity but not tenant scope.
       * These abort triggers provide the composite project/id invariant without
       * rebuilding the four MVP tables that predate the Story Bible schema.
       */
      CREATE TRIGGER IF NOT EXISTS story_documents_project_guard
      BEFORE INSERT ON document_revisions
      WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
        OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
      BEGIN SELECT RAISE(ABORT, 'document project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_scenes_project_guard
      BEFORE INSERT ON scenes
      WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
        OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
      BEGIN SELECT RAISE(ABORT, 'scene project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_scenes_update_project_guard
      BEFORE UPDATE OF project_id, document_id ON scenes
      WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
        OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
      BEGIN SELECT RAISE(ABORT, 'scene project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_scene_revisions_project_guard
      BEFORE INSERT ON scene_revisions
      WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
        OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id
        OR (SELECT document_id FROM scenes WHERE id = NEW.scene_id) <> NEW.document_id
        OR (SELECT project_id FROM document_revisions WHERE id = NEW.document_revision_id) IS NULL
        OR (SELECT project_id FROM document_revisions WHERE id = NEW.document_revision_id) <> NEW.project_id
        OR (SELECT document_id FROM document_revisions WHERE id = NEW.document_revision_id) <> NEW.document_id
      BEGIN SELECT RAISE(ABORT, 'scene revision project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_scene_revisions_update_project_guard
      BEFORE UPDATE OF project_id, document_id, scene_id, document_revision_id ON scene_revisions
      WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
        OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id
        OR (SELECT document_id FROM scenes WHERE id = NEW.scene_id) <> NEW.document_id
        OR (SELECT project_id FROM document_revisions WHERE id = NEW.document_revision_id) IS NULL
        OR (SELECT project_id FROM document_revisions WHERE id = NEW.document_revision_id) <> NEW.project_id
        OR (SELECT document_id FROM document_revisions WHERE id = NEW.document_revision_id) <> NEW.document_id
      BEGIN SELECT RAISE(ABORT, 'scene revision project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_entity_alias_project_guard
      BEFORE INSERT ON entity_aliases
      WHEN (SELECT project_id FROM entities WHERE id = NEW.entity_id) IS NULL
        OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) <> NEW.project_id
      BEGIN SELECT RAISE(ABORT, 'entity alias project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_entity_merge_project_guard
      BEFORE INSERT ON entities
      WHEN NEW.merged_into_entity_id IS NOT NULL
        AND ((SELECT project_id FROM entities WHERE id = NEW.merged_into_entity_id) IS NULL
          OR (SELECT project_id FROM entities WHERE id = NEW.merged_into_entity_id) <> NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'entity merge project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_entity_merge_update_project_guard
      BEFORE UPDATE OF project_id, merged_into_entity_id ON entities
      WHEN NEW.merged_into_entity_id IS NOT NULL
        AND ((SELECT project_id FROM entities WHERE id = NEW.merged_into_entity_id) IS NULL
          OR (SELECT project_id FROM entities WHERE id = NEW.merged_into_entity_id) <> NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'entity merge project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_entity_alias_update_project_guard
      BEFORE UPDATE OF project_id, entity_id ON entity_aliases
      WHEN (SELECT project_id FROM entities WHERE id = NEW.entity_id) IS NULL
        OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) <> NEW.project_id
      BEGIN SELECT RAISE(ABORT, 'entity alias project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_evidence_project_guard
      BEFORE INSERT ON evidence_sources
      WHEN (NEW.document_id IS NOT NULL AND (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id)
        OR (NEW.scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id)
        OR (NEW.scene_revision_id IS NOT NULL AND (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.project_id)
        OR (NEW.revision_id IS NOT NULL AND (SELECT project_id FROM scene_revisions WHERE id = NEW.revision_id) <> NEW.project_id)
        OR (NEW.revision_id IS NOT NULL AND NEW.revision_id <> NEW.scene_revision_id)
        OR (NEW.scene_revision_id IS NOT NULL AND (NEW.scene_id IS NULL OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.scene_id))
      BEGIN SELECT RAISE(ABORT, 'evidence project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_evidence_update_project_guard
      BEFORE UPDATE OF project_id, document_id, scene_id, scene_revision_id ON evidence_sources
      WHEN (NEW.document_id IS NOT NULL AND (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id)
        OR (NEW.scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id)
        OR (NEW.scene_revision_id IS NOT NULL AND (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.project_id)
        OR (NEW.revision_id IS NOT NULL AND (SELECT project_id FROM scene_revisions WHERE id = NEW.revision_id) <> NEW.project_id)
        OR (NEW.revision_id IS NOT NULL AND NEW.revision_id <> NEW.scene_revision_id)
        OR (NEW.scene_revision_id IS NOT NULL AND (NEW.scene_id IS NULL OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.scene_id))
      BEGIN SELECT RAISE(ABORT, 'evidence project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_fact_project_guard
      BEFORE INSERT ON facts
      WHEN (SELECT project_id FROM entities WHERE id = NEW.subject_entity_id) IS NULL
        OR (SELECT project_id FROM entities WHERE id = NEW.subject_entity_id) <> NEW.project_id
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.source_id) IS NULL
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.source_id) <> NEW.project_id
        OR (NEW.scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id)
        OR (NEW.valid_from_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_from_scene_id) <> NEW.project_id)
        OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> NEW.project_id)
        OR (NEW.supersedes_fact_id IS NOT NULL AND (SELECT project_id FROM facts WHERE id = NEW.supersedes_fact_id) <> NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'fact project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS story_fact_update_project_guard
      BEFORE UPDATE OF project_id, subject_entity_id, source_id, scene_id, valid_from_scene_id, valid_to_scene_id, supersedes_fact_id ON facts
      WHEN (SELECT project_id FROM entities WHERE id = NEW.subject_entity_id) IS NULL
        OR (SELECT project_id FROM entities WHERE id = NEW.subject_entity_id) <> NEW.project_id
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.source_id) IS NULL
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.source_id) <> NEW.project_id
        OR (NEW.scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id)
        OR (NEW.valid_from_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_from_scene_id) <> NEW.project_id)
        OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> NEW.project_id)
        OR (NEW.supersedes_fact_id IS NOT NULL AND (SELECT project_id FROM facts WHERE id = NEW.supersedes_fact_id) <> NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'fact project mismatch'); END;
    `));
  }

  if (currentVersion < 6) {
    runMigration(database, 6, () => database.exec(`
      /*
       * Phase 1 analysis is a durable local queue. A run is leased explicitly
       * by an execute command; no process-local timer is part of correctness.
       */
      CREATE TABLE IF NOT EXISTS analysis_runs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        scene_revision_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        analyzer_version TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'stale')),
        lease_token TEXT,
        lease_expires_at TEXT,
        attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
        error_code TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES script_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_revision_id) REFERENCES scene_revisions(id) ON DELETE CASCADE,
        UNIQUE (project_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_runs_project_status
        ON analysis_runs(project_id, status, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_runs_scene_revision
        ON analysis_runs(project_id, scene_id, scene_revision_id, created_at DESC, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_runs_semantic_idempotency
        ON analysis_runs(project_id, scene_revision_id, analyzer_version, content_hash);

      CREATE TABLE IF NOT EXISTS entity_mentions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        scene_revision_id TEXT NOT NULL,
        analysis_run_id TEXT NOT NULL,
        entity_id TEXT,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'location', 'prop')),
        surface TEXT NOT NULL,
        normalized_surface TEXT NOT NULL,
        anchor_start INTEGER NOT NULL CHECK (anchor_start >= 0),
        anchor_end INTEGER NOT NULL CHECK (anchor_end >= anchor_start),
        candidate_group_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        evidence_source_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'rejected')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES script_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_revision_id) REFERENCES scene_revisions(id) ON DELETE CASCADE,
        FOREIGN KEY (analysis_run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL,
        FOREIGN KEY (evidence_source_id) REFERENCES evidence_sources(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_entity_mentions_scene_revision
        ON entity_mentions(project_id, scene_id, scene_revision_id, status, anchor_start, id);
      CREATE INDEX IF NOT EXISTS idx_entity_mentions_fingerprint
        ON entity_mentions(project_id, scene_revision_id, fingerprint, status);

      CREATE TABLE IF NOT EXISTS scene_entity_links (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        scene_revision_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'location', 'prop')),
        role TEXT NOT NULL CHECK (role IN ('appears', 'located_at', 'used', 'mentioned')),
        status TEXT NOT NULL CHECK (status IN ('candidate', 'confirmed', 'rejected', 'stale')),
        resolver TEXT NOT NULL CHECK (resolver IN ('exact_alias', 'explicit_stub', 'user')),
        confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        candidate_group_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        analysis_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_revision_id) REFERENCES scene_revisions(id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (analysis_run_id) REFERENCES analysis_runs(id) ON DELETE SET NULL,
        UNIQUE (project_id, scene_revision_id, entity_id, role, fingerprint)
      );

      CREATE INDEX IF NOT EXISTS idx_scene_entity_links_scene_revision
        ON scene_entity_links(project_id, scene_id, scene_revision_id, status, role, entity_id);
      CREATE INDEX IF NOT EXISTS idx_scene_entity_links_candidate_group
        ON scene_entity_links(project_id, scene_revision_id, candidate_group_id, status);

      CREATE TABLE IF NOT EXISTS scene_entity_link_mentions (
        project_id TEXT NOT NULL,
        link_id TEXT NOT NULL,
        mention_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, link_id, mention_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (link_id) REFERENCES scene_entity_links(id) ON DELETE CASCADE,
        FOREIGN KEY (mention_id) REFERENCES entity_mentions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_scene_entity_link_mentions_link
        ON scene_entity_link_mentions(project_id, link_id, created_at, mention_id);

      /* Analysis references must remain inside one project and one document. */
      CREATE TRIGGER IF NOT EXISTS analysis_runs_project_guard
      BEFORE INSERT ON analysis_runs
      WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
        OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id
        OR (SELECT document_id FROM scenes WHERE id = NEW.scene_id) <> NEW.document_id
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) IS NULL
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.project_id
        OR (SELECT document_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.document_id
        OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.scene_id
      BEGIN SELECT RAISE(ABORT, 'analysis run project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS analysis_runs_update_project_guard
      BEFORE UPDATE OF project_id, document_id, scene_id, scene_revision_id ON analysis_runs
      WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
        OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id
        OR (SELECT document_id FROM scenes WHERE id = NEW.scene_id) <> NEW.document_id
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) IS NULL
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.project_id
        OR (SELECT document_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.document_id
        OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.scene_id
      BEGIN SELECT RAISE(ABORT, 'analysis run project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS entity_mentions_project_guard
      BEFORE INSERT ON entity_mentions
      WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
        OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id
        OR (SELECT document_id FROM scenes WHERE id = NEW.scene_id) <> NEW.document_id
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) IS NULL
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.project_id
        OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.scene_id
        OR (SELECT project_id FROM analysis_runs WHERE id = NEW.analysis_run_id) IS NULL
        OR (SELECT project_id FROM analysis_runs WHERE id = NEW.analysis_run_id) <> NEW.project_id
        OR (SELECT scene_revision_id FROM analysis_runs WHERE id = NEW.analysis_run_id) <> NEW.scene_revision_id
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.evidence_source_id) IS NULL
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.evidence_source_id) <> NEW.project_id
        OR (NEW.entity_id IS NOT NULL AND ((SELECT project_id FROM entities WHERE id = NEW.entity_id) IS NULL OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) <> NEW.project_id))
      BEGIN SELECT RAISE(ABORT, 'entity mention project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS scene_entity_links_project_guard
      BEFORE INSERT ON scene_entity_links
      WHEN (SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) IS NULL
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.project_id
        OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.scene_id
        OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) IS NULL
        OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) <> NEW.project_id
        OR (NEW.analysis_run_id IS NOT NULL AND ((SELECT project_id FROM analysis_runs WHERE id = NEW.analysis_run_id) IS NULL OR (SELECT project_id FROM analysis_runs WHERE id = NEW.analysis_run_id) <> NEW.project_id OR (SELECT scene_revision_id FROM analysis_runs WHERE id = NEW.analysis_run_id) <> NEW.scene_revision_id))
      BEGIN SELECT RAISE(ABORT, 'scene entity link project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS scene_entity_links_update_project_guard
      BEFORE UPDATE OF project_id, scene_id, scene_revision_id, entity_id, analysis_run_id ON scene_entity_links
      WHEN (SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL
        OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) IS NULL
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.project_id
        OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.scene_id
        OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) IS NULL
        OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) <> NEW.project_id
        OR (NEW.analysis_run_id IS NOT NULL AND ((SELECT project_id FROM analysis_runs WHERE id = NEW.analysis_run_id) IS NULL OR (SELECT project_id FROM analysis_runs WHERE id = NEW.analysis_run_id) <> NEW.project_id OR (SELECT scene_revision_id FROM analysis_runs WHERE id = NEW.analysis_run_id) <> NEW.scene_revision_id))
      BEGIN SELECT RAISE(ABORT, 'scene entity link project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS scene_entity_link_mentions_project_guard
      BEFORE INSERT ON scene_entity_link_mentions
      WHEN (SELECT project_id FROM scene_entity_links WHERE id = NEW.link_id) IS NULL
        OR (SELECT project_id FROM scene_entity_links WHERE id = NEW.link_id) <> NEW.project_id
        OR (SELECT project_id FROM entity_mentions WHERE id = NEW.mention_id) IS NULL
        OR (SELECT project_id FROM entity_mentions WHERE id = NEW.mention_id) <> NEW.project_id
        OR (SELECT scene_revision_id FROM scene_entity_links WHERE id = NEW.link_id) <> (SELECT scene_revision_id FROM entity_mentions WHERE id = NEW.mention_id)
      BEGIN SELECT RAISE(ABORT, 'scene entity link mention project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS scene_entity_link_mentions_update_project_guard
      BEFORE UPDATE OF project_id, link_id, mention_id ON scene_entity_link_mentions
      WHEN (SELECT project_id FROM scene_entity_links WHERE id = NEW.link_id) IS NULL
        OR (SELECT project_id FROM scene_entity_links WHERE id = NEW.link_id) <> NEW.project_id
        OR (SELECT project_id FROM entity_mentions WHERE id = NEW.mention_id) IS NULL
        OR (SELECT project_id FROM entity_mentions WHERE id = NEW.mention_id) <> NEW.project_id
        OR (SELECT scene_revision_id FROM scene_entity_links WHERE id = NEW.link_id) <> (SELECT scene_revision_id FROM entity_mentions WHERE id = NEW.mention_id)
      BEGIN SELECT RAISE(ABORT, 'scene entity link mention project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS analysis_runs_immutable_columns_guard
      BEFORE UPDATE OF id, project_id, document_id, scene_id, scene_revision_id, content_hash, analyzer_version, idempotency_key, created_at ON analysis_runs
      WHEN NEW.id <> OLD.id
        OR NEW.project_id <> OLD.project_id
        OR NEW.document_id <> OLD.document_id
        OR NEW.scene_id <> OLD.scene_id
        OR NEW.scene_revision_id <> OLD.scene_revision_id
        OR NEW.content_hash <> OLD.content_hash
        OR NEW.analyzer_version <> OLD.analyzer_version
        OR NEW.idempotency_key <> OLD.idempotency_key
        OR NEW.created_at <> OLD.created_at
      BEGIN SELECT RAISE(ABORT, 'analysis run identity is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS analysis_runs_status_lease_guard
      BEFORE UPDATE OF status, lease_token, lease_expires_at, completed_at ON analysis_runs
      WHEN NEW.status NOT IN ('queued', 'running', 'succeeded', 'failed', 'stale')
        OR (NEW.status = 'running' AND (NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL))
        OR (NEW.status <> 'running' AND (NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL))
        OR (OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'stale'))
        OR (OLD.status = 'running' AND NEW.status NOT IN ('running', 'succeeded', 'failed', 'stale'))
        OR (OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'running', 'stale'))
        OR (OLD.status = 'succeeded' AND NEW.status NOT IN ('succeeded', 'stale'))
        OR (OLD.status = 'stale' AND NEW.status <> OLD.status)
      BEGIN SELECT RAISE(ABORT, 'analysis run status/lease transition is invalid'); END;

      CREATE TRIGGER IF NOT EXISTS entity_mentions_immutable_columns_guard
      BEFORE UPDATE OF id, project_id, document_id, scene_id, scene_revision_id, analysis_run_id, entity_id, entity_type, surface, normalized_surface, anchor_start, anchor_end, candidate_group_id, fingerprint, evidence_source_id, created_at ON entity_mentions
      WHEN NEW.id <> OLD.id
        OR NEW.project_id <> OLD.project_id
        OR NEW.document_id <> OLD.document_id
        OR NEW.scene_id <> OLD.scene_id
        OR NEW.scene_revision_id <> OLD.scene_revision_id
        OR NEW.analysis_run_id <> OLD.analysis_run_id
        OR (NEW.entity_id IS NULL AND OLD.entity_id IS NOT NULL) OR (NEW.entity_id IS NOT NULL AND OLD.entity_id IS NULL) OR NEW.entity_id <> OLD.entity_id
        OR NEW.entity_type <> OLD.entity_type
        OR NEW.surface <> OLD.surface
        OR NEW.normalized_surface <> OLD.normalized_surface
        OR NEW.anchor_start <> OLD.anchor_start
        OR NEW.anchor_end <> OLD.anchor_end
        OR NEW.candidate_group_id <> OLD.candidate_group_id
        OR NEW.fingerprint <> OLD.fingerprint
        OR NEW.evidence_source_id <> OLD.evidence_source_id
        OR NEW.created_at <> OLD.created_at
      BEGIN SELECT RAISE(ABORT, 'entity mention identity is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS scene_entity_links_immutable_columns_guard
      BEFORE UPDATE OF id, project_id, scene_id, scene_revision_id, entity_id, entity_type, role, resolver, candidate_group_id, fingerprint, analysis_run_id, created_at ON scene_entity_links
      WHEN NEW.id <> OLD.id
        OR NEW.project_id <> OLD.project_id
        OR NEW.scene_id <> OLD.scene_id
        OR NEW.scene_revision_id <> OLD.scene_revision_id
        OR NEW.entity_id <> OLD.entity_id
        OR NEW.entity_type <> OLD.entity_type
        OR NEW.role <> OLD.role
        OR NEW.resolver <> OLD.resolver
        OR NEW.candidate_group_id <> OLD.candidate_group_id
        OR NEW.fingerprint <> OLD.fingerprint
        OR (NEW.analysis_run_id IS NULL AND OLD.analysis_run_id IS NOT NULL) OR (NEW.analysis_run_id IS NOT NULL AND OLD.analysis_run_id IS NULL) OR NEW.analysis_run_id <> OLD.analysis_run_id
        OR NEW.created_at <> OLD.created_at
      BEGIN SELECT RAISE(ABORT, 'scene entity link identity is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS scene_entity_links_status_version_guard
      BEFORE UPDATE OF status, version ON scene_entity_links
      WHEN NEW.version < OLD.version
        OR NEW.version > OLD.version + 1
        OR (NEW.status = OLD.status AND NEW.version <> OLD.version)
        OR (NEW.status <> OLD.status AND NEW.version <> OLD.version + 1)
        OR (OLD.status = 'rejected' AND NEW.status <> OLD.status)
        OR NEW.status NOT IN ('candidate', 'confirmed', 'rejected', 'stale')
      BEGIN SELECT RAISE(ABORT, 'scene entity link status/version transition is invalid'); END;

      /* Fact values and identity are append-only. Status/version are moved by
       * the repository's supersede/retract commands only. */
      CREATE TRIGGER IF NOT EXISTS facts_immutable_columns_guard
      BEFORE UPDATE OF project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, valid_to_scene_id, source_id, supersedes_fact_id, created_at ON facts
      WHEN NEW.project_id <> OLD.project_id
        OR NEW.subject_entity_id <> OLD.subject_entity_id
        OR NEW.predicate <> OLD.predicate
        OR NEW.value_json <> OLD.value_json
        OR NEW.value_type <> OLD.value_type
        OR NEW.truth_class <> OLD.truth_class
        OR NEW.scope <> OLD.scope
        OR (NEW.scene_id IS NULL AND OLD.scene_id IS NOT NULL) OR (NEW.scene_id IS NOT NULL AND OLD.scene_id IS NULL) OR NEW.scene_id <> OLD.scene_id
        OR (NEW.valid_from_scene_id IS NULL AND OLD.valid_from_scene_id IS NOT NULL) OR (NEW.valid_from_scene_id IS NOT NULL AND OLD.valid_from_scene_id IS NULL) OR NEW.valid_from_scene_id <> OLD.valid_from_scene_id
        OR (NEW.valid_to_scene_id IS NULL AND OLD.valid_to_scene_id IS NOT NULL) OR (NEW.valid_to_scene_id IS NOT NULL AND OLD.valid_to_scene_id IS NULL) OR NEW.valid_to_scene_id <> OLD.valid_to_scene_id
        OR NEW.source_id <> OLD.source_id
        OR (NEW.supersedes_fact_id IS NULL AND OLD.supersedes_fact_id IS NOT NULL) OR (NEW.supersedes_fact_id IS NOT NULL AND OLD.supersedes_fact_id IS NULL) OR NEW.supersedes_fact_id <> OLD.supersedes_fact_id
        OR NEW.created_at <> OLD.created_at
      BEGIN SELECT RAISE(ABORT, 'fact immutable columns cannot be updated'); END;

      CREATE TRIGGER IF NOT EXISTS facts_status_version_guard
      BEFORE UPDATE OF status, version ON facts
      WHEN NEW.version < OLD.version
        OR NEW.version > OLD.version + 1
        OR (NEW.status = OLD.status AND NEW.version <> OLD.version)
        OR (NEW.status <> OLD.status AND NEW.version <> OLD.version + 1)
        OR (OLD.status = 'superseded' AND NEW.status <> OLD.status)
        OR (OLD.status = 'retracted' AND NEW.status <> OLD.status)
        OR (OLD.status = 'active' AND NEW.status NOT IN ('active', 'superseded', 'retracted'))
      BEGIN SELECT RAISE(ABORT, 'fact status/version transition is invalid'); END;
    `));
  }

  if (currentVersion < 7) {
    runMigration(database, 7, () => database.exec(`
      /* Revision text, hashes, and provenance anchors are append-only. A
       * document save creates a new revision; it never edits an old one. */
      CREATE TRIGGER IF NOT EXISTS document_revisions_immutable_columns_guard
      BEFORE UPDATE OF id, project_id, document_id, revision_number, base_version, content_hash, created_by, request_id, created_at ON document_revisions
      WHEN NOT (
        NEW.id IS OLD.id
        AND NEW.project_id IS OLD.project_id
        AND NEW.document_id IS OLD.document_id
        AND NEW.revision_number IS OLD.revision_number
        AND NEW.base_version IS OLD.base_version
        AND NEW.content_hash IS OLD.content_hash
        AND NEW.created_by IS OLD.created_by
        AND NEW.request_id IS OLD.request_id
        AND NEW.created_at IS OLD.created_at
      )
      BEGIN SELECT RAISE(ABORT, 'document revision is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS scene_revisions_immutable_columns_guard
      BEFORE UPDATE OF id, project_id, document_id, scene_id, document_revision_id, narrative_rank, title, content, content_hash, status, created_at ON scene_revisions
      WHEN NOT (
        NEW.id IS OLD.id
        AND NEW.project_id IS OLD.project_id
        AND NEW.document_id IS OLD.document_id
        AND NEW.scene_id IS OLD.scene_id
        AND NEW.document_revision_id IS OLD.document_revision_id
        AND NEW.narrative_rank IS OLD.narrative_rank
        AND NEW.title IS OLD.title
        AND NEW.content IS OLD.content
        AND NEW.content_hash IS OLD.content_hash
        AND NEW.status IS OLD.status
        AND NEW.created_at IS OLD.created_at
      )
      BEGIN SELECT RAISE(ABORT, 'scene revision is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS evidence_sources_update_revision_project_guard
      BEFORE UPDATE OF project_id, document_id, scene_id, scene_revision_id, revision_id ON evidence_sources
      WHEN (NEW.document_id IS NOT NULL AND (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id)
        OR (NEW.scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id)
        OR (NEW.scene_revision_id IS NOT NULL AND (SELECT project_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.project_id)
        OR (NEW.revision_id IS NOT NULL AND (SELECT project_id FROM scene_revisions WHERE id = NEW.revision_id) <> NEW.project_id)
        OR (NEW.revision_id IS NOT NULL AND NEW.revision_id <> NEW.scene_revision_id)
        OR (NEW.scene_revision_id IS NOT NULL AND (NEW.scene_id IS NULL OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.scene_revision_id) <> NEW.scene_id))
      BEGIN SELECT RAISE(ABORT, 'evidence revision project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS evidence_sources_immutable_columns_guard
      BEFORE UPDATE OF id, project_id, kind, document_id, scene_id, scene_revision_id, revision_id, anchor_start, anchor_end, quoted_text, created_by_user_id, model_run_id, created_at ON evidence_sources
      WHEN NOT (
        NEW.id IS OLD.id
        AND NEW.project_id IS OLD.project_id
        AND NEW.kind IS OLD.kind
        AND NEW.document_id IS OLD.document_id
        AND NEW.scene_id IS OLD.scene_id
        AND NEW.scene_revision_id IS OLD.scene_revision_id
        AND NEW.revision_id IS OLD.revision_id
        AND NEW.anchor_start IS OLD.anchor_start
        AND NEW.anchor_end IS OLD.anchor_end
        AND NEW.quoted_text IS OLD.quoted_text
        AND NEW.created_by_user_id IS OLD.created_by_user_id
        AND NEW.model_run_id IS OLD.model_run_id
        AND NEW.created_at IS OLD.created_at
      )
      BEGIN SELECT RAISE(ABORT, 'evidence source is immutable'); END;
    `));
  }

  if (currentVersion < 8) {
    runMigration(database, 8, () => database.exec(`
      /* Refresh the v6 guard so succeeded runs may be retired as stale when
       * a newer scene revision is enqueued. */
      DROP TRIGGER IF EXISTS analysis_runs_status_lease_guard;
      CREATE TRIGGER analysis_runs_status_lease_guard
      BEFORE UPDATE OF status, lease_token, lease_expires_at, completed_at ON analysis_runs
      WHEN NEW.status NOT IN ('queued', 'running', 'succeeded', 'failed', 'stale')
        OR (NEW.status = 'running' AND (NEW.lease_token IS NULL OR NEW.lease_expires_at IS NULL))
        OR (NEW.status <> 'running' AND (NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL))
        OR (OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'stale'))
        OR (OLD.status = 'running' AND NEW.status NOT IN ('running', 'succeeded', 'failed', 'stale'))
        OR (OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'running', 'stale'))
        OR (OLD.status = 'succeeded' AND NEW.status NOT IN ('succeeded', 'stale'))
        OR (OLD.status = 'stale' AND NEW.status <> OLD.status)
      BEGIN SELECT RAISE(ABORT, 'analysis run status/lease transition is invalid'); END;

      /* A confirmed link cannot silently point at an archived/merged
       * tombstone. Entity merge/archival is deferred until its links are
       * explicitly reviewed or migrated. */
      CREATE TRIGGER IF NOT EXISTS entities_confirmed_link_guard
      BEFORE UPDATE OF status, merged_into_entity_id ON entities
      WHEN (NEW.status NOT IN ('active', 'draft') OR NEW.merged_into_entity_id IS NOT NULL)
        AND EXISTS (
          SELECT 1 FROM scene_entity_links
          WHERE project_id = NEW.project_id
            AND entity_id = NEW.id
            AND status = 'confirmed'
        )
      BEGIN SELECT RAISE(ABORT, 'entity has confirmed scene links'); END;

      CREATE TRIGGER IF NOT EXISTS scene_entity_links_confirmed_entity_guard
      BEFORE INSERT ON scene_entity_links
      WHEN NEW.status = 'confirmed'
        AND (
          (SELECT project_id FROM entities WHERE id = NEW.entity_id) IS NULL
          OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) <> NEW.project_id
          OR (SELECT entity_type FROM entities WHERE id = NEW.entity_id) <> NEW.entity_type
          OR (SELECT status FROM entities WHERE id = NEW.entity_id) NOT IN ('active', 'draft')
          OR (SELECT merged_into_entity_id FROM entities WHERE id = NEW.entity_id) IS NOT NULL
        )
      BEGIN SELECT RAISE(ABORT, 'confirmed scene link entity is not resolvable'); END;

      CREATE TRIGGER IF NOT EXISTS scene_entity_links_confirmed_entity_update_guard
      BEFORE UPDATE OF status, entity_id, entity_type, project_id ON scene_entity_links
      WHEN NEW.status = 'confirmed'
        AND (
          (SELECT project_id FROM entities WHERE id = NEW.entity_id) IS NULL
          OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) <> NEW.project_id
          OR (SELECT entity_type FROM entities WHERE id = NEW.entity_id) <> NEW.entity_type
          OR (SELECT status FROM entities WHERE id = NEW.entity_id) NOT IN ('active', 'draft')
          OR (SELECT merged_into_entity_id FROM entities WHERE id = NEW.entity_id) IS NOT NULL
        )
      BEGIN SELECT RAISE(ABORT, 'confirmed scene link entity is not resolvable'); END;

      CREATE TRIGGER IF NOT EXISTS entity_mentions_status_guard
      BEFORE UPDATE OF status ON entity_mentions
      WHEN NEW.status NOT IN ('active', 'stale', 'rejected')
        OR (OLD.status IN ('stale', 'rejected') AND NEW.status <> OLD.status)
      BEGIN SELECT RAISE(ABORT, 'entity mention status transition is invalid'); END;

      CREATE TRIGGER IF NOT EXISTS analysis_runs_insert_status_lease_guard
      BEFORE INSERT ON analysis_runs
      WHEN NEW.status <> 'queued'
        OR NEW.lease_token IS NOT NULL
        OR NEW.lease_expires_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'analysis run must start queued without a lease'); END;
    `));
  }

  if (currentVersion < 9) {
    runMigration(database, 9, () => {
      /* Some test fixtures intentionally lower user_version after bootstrapping
       * to exercise legacy migrations. Keep this additive column idempotent. */
      const factColumns = database.prepare("PRAGMA table_info(facts)").all() as Array<{ name?: string }>;
      if (!factColumns.some((column) => column.name === "promoted_from_inference_id")) {
        database.exec("ALTER TABLE facts ADD COLUMN promoted_from_inference_id TEXT");
      }
      const pendingPatchTable = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_patches'").get() as { name?: string } | undefined;
      if (pendingPatchTable?.name) {
        const columns = database.prepare("PRAGMA table_info(pending_patches)").all() as Array<{ name?: string }>;
        if (!columns.some((column) => column.name === "input_fingerprint")) database.exec("ALTER TABLE pending_patches ADD COLUMN input_fingerprint TEXT NOT NULL DEFAULT ''");
      }
      const patchApplicationTable = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'patch_applications'").get() as { name?: string } | undefined;
      if (patchApplicationTable?.name) {
        const columns = database.prepare("PRAGMA table_info(patch_applications)").all() as Array<{ name?: string }>;
        if (!columns.some((column) => column.name === "applied_payload_json")) database.exec("ALTER TABLE patch_applications ADD COLUMN applied_payload_json TEXT NOT NULL DEFAULT '{}'");
      }
      database.exec(`
      /* Phase 2 keeps model output and reviewable changes outside Canon. */
      CREATE TABLE IF NOT EXISTS model_runs (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('fact_extractor')),
        model TEXT NOT NULL,
        model_version TEXT NOT NULL,
        source_revision_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'stale')),
        output_hash TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (source_revision_id) REFERENCES scene_revisions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_model_runs_project_created
        ON model_runs(project_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_model_runs_source_revision
        ON model_runs(project_id, source_revision_id, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS inferences (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        subject_entity_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        value_json TEXT NOT NULL,
        value_type TEXT NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'enum', 'entity_ref', 'json')),
        scope TEXT NOT NULL CHECK (scope IN ('base', 'scene', 'range')),
        scene_id TEXT,
        valid_from_scene_id TEXT,
        valid_to_scene_id TEXT,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        rationale TEXT,
        model_run_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'promoted', 'stale')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (subject_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
        FOREIGN KEY (valid_from_scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
        FOREIGN KEY (valid_to_scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
        FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS idx_inferences_project_status
        ON inferences(project_id, status, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_inferences_subject_predicate
        ON inferences(project_id, subject_entity_id, predicate, scope, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS inference_evidence (
        project_id TEXT NOT NULL,
        inference_id TEXT NOT NULL,
        evidence_source_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, inference_id, evidence_source_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (inference_id) REFERENCES inferences(id) ON DELETE CASCADE,
        FOREIGN KEY (evidence_source_id) REFERENCES evidence_sources(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS pending_patches (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('add_fact', 'replace_fact', 'retract_fact')),
        target_entity_id TEXT,
        target_fact_id TEXT,
        base_version INTEGER,
        payload_json TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL DEFAULT '',
        truth_class TEXT NOT NULL CHECK (truth_class = 'canon'),
        confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        conflict_kind TEXT NOT NULL DEFAULT 'none' CHECK (conflict_kind IN ('none', 'possible', 'hard')),
        conflicting_fact_ids_json TEXT NOT NULL DEFAULT '[]',
        conflict_message TEXT,
        source_revision_id TEXT NOT NULL,
        inference_id TEXT,
        model_run_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'superseded')),
        proposed_by TEXT NOT NULL CHECK (proposed_by IN ('rule', 'model', 'user', 'import')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by_user_id TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE SET NULL,
        FOREIGN KEY (target_fact_id) REFERENCES facts(id) ON DELETE SET NULL,
        FOREIGN KEY (source_revision_id) REFERENCES scene_revisions(id) ON DELETE CASCADE,
        FOREIGN KEY (inference_id) REFERENCES inferences(id) ON DELETE SET NULL,
        FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE SET NULL,
        CHECK (
          (operation = 'add_fact' AND target_entity_id IS NOT NULL AND target_fact_id IS NULL AND base_version IS NOT NULL)
          OR (operation = 'replace_fact' AND target_entity_id IS NOT NULL AND target_fact_id IS NOT NULL AND base_version IS NOT NULL)
          OR (operation = 'retract_fact' AND target_fact_id IS NOT NULL AND base_version IS NOT NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS idx_pending_patches_project_status
        ON pending_patches(project_id, status, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_pending_patches_source_revision
        ON pending_patches(project_id, source_revision_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pending_patches_target_fact
        ON pending_patches(project_id, target_fact_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_patches_semantic_input
        ON pending_patches(project_id, source_revision_id, input_fingerprint)
        WHERE input_fingerprint <> '';

      CREATE TABLE IF NOT EXISTS patch_evidence (
        project_id TEXT NOT NULL,
        patch_id TEXT NOT NULL,
        evidence_source_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, patch_id, evidence_source_id),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (patch_id) REFERENCES pending_patches(id) ON DELETE CASCADE,
        FOREIGN KEY (evidence_source_id) REFERENCES evidence_sources(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS patch_applications (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        patch_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('add_fact', 'replace_fact', 'retract_fact')),
        resulting_fact_id TEXT,
        applied_payload_json TEXT NOT NULL DEFAULT '{}',
        request_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (patch_id) REFERENCES pending_patches(id) ON DELETE RESTRICT,
        FOREIGN KEY (resulting_fact_id) REFERENCES facts(id) ON DELETE SET NULL,
        UNIQUE (project_id, patch_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_patch_applications_one_per_patch
        ON patch_applications(project_id, patch_id);

      /* Reconcile legacy Phase 1 projections before enforcing one live link
       * per scene revision/entity/role. The lexicographically first link is
       * stable; mentions from losers are copied to it and history remains
       * visible as stale rows. */
      CREATE TEMP TABLE phase2_link_redirects (
        project_id TEXT NOT NULL,
        loser_id TEXT PRIMARY KEY NOT NULL,
        winner_id TEXT NOT NULL
      );
      INSERT INTO phase2_link_redirects (project_id, loser_id, winner_id)
      SELECT loser.project_id, loser.id, MIN(winner.id)
      FROM scene_entity_links loser
      JOIN scene_entity_links winner
        ON winner.project_id = loser.project_id
       AND winner.scene_revision_id = loser.scene_revision_id
       AND winner.entity_id = loser.entity_id
       AND winner.role = loser.role
       AND winner.status IN ('candidate', 'confirmed')
       AND loser.status IN ('candidate', 'confirmed')
       AND winner.id < loser.id
      GROUP BY loser.project_id, loser.id;
      INSERT OR IGNORE INTO scene_entity_link_mentions (project_id, link_id, mention_id, created_at)
      SELECT redirects.project_id, redirects.winner_id, mentions.mention_id, mentions.created_at
      FROM phase2_link_redirects redirects
      JOIN scene_entity_link_mentions mentions
        ON mentions.project_id = redirects.project_id
       AND mentions.link_id = redirects.loser_id;
      DELETE FROM scene_entity_link_mentions
      WHERE project_id IN (SELECT project_id FROM phase2_link_redirects)
        AND link_id IN (SELECT loser_id FROM phase2_link_redirects);
      UPDATE scene_entity_links
      SET status = 'stale', version = version + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (SELECT loser_id FROM phase2_link_redirects)
        AND status IN ('candidate', 'confirmed');
      DROP TABLE phase2_link_redirects;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_entity_links_live_unique
        ON scene_entity_links(project_id, scene_revision_id, entity_id, role)
        WHERE status IN ('candidate', 'confirmed');

      /* Cross-project guards are intentionally duplicated in the database so
       * direct SQL cannot create a provenance edge across projects. */
      CREATE TRIGGER IF NOT EXISTS model_runs_project_guard
      BEFORE INSERT ON model_runs
      WHEN (SELECT project_id FROM scene_revisions WHERE id = NEW.source_revision_id) IS NULL
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.source_revision_id) <> NEW.project_id
      BEGIN SELECT RAISE(ABORT, 'model run project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS model_runs_initial_status_guard
      BEFORE INSERT ON model_runs
      WHEN NEW.status NOT IN ('queued', 'running', 'succeeded', 'failed', 'stale')
      BEGIN SELECT RAISE(ABORT, 'model run initial status is invalid'); END;

      CREATE TRIGGER IF NOT EXISTS evidence_sources_model_run_project_guard
      BEFORE INSERT ON evidence_sources
      WHEN NEW.model_run_id IS NOT NULL
        AND NOT (
          (SELECT project_id FROM model_runs WHERE id = NEW.model_run_id) = NEW.project_id
          OR (SELECT project_id FROM analysis_runs WHERE id = NEW.model_run_id) = NEW.project_id
        )
      BEGIN SELECT RAISE(ABORT, 'evidence model run project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS evidence_sources_model_run_update_project_guard
      BEFORE UPDATE OF project_id, model_run_id ON evidence_sources
      WHEN NEW.model_run_id IS NOT NULL
        AND NOT (
          (SELECT project_id FROM model_runs WHERE id = NEW.model_run_id) = NEW.project_id
          OR (SELECT project_id FROM analysis_runs WHERE id = NEW.model_run_id) = NEW.project_id
        )
      BEGIN SELECT RAISE(ABORT, 'evidence model run project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS model_runs_immutable_guard
      BEFORE UPDATE OF id, project_id, kind, model, model_version, source_revision_id, input_hash, created_at ON model_runs
      WHEN NOT (
        NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.kind IS OLD.kind
        AND NEW.model IS OLD.model AND NEW.model_version IS OLD.model_version
        AND NEW.source_revision_id IS OLD.source_revision_id AND NEW.input_hash IS OLD.input_hash
        AND NEW.created_at IS OLD.created_at
      )
      BEGIN SELECT RAISE(ABORT, 'model run provenance is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS inferences_project_guard
      BEFORE INSERT ON inferences
      WHEN (SELECT project_id FROM entities WHERE id = NEW.subject_entity_id) IS NULL
        OR (SELECT project_id FROM entities WHERE id = NEW.subject_entity_id) <> NEW.project_id
        OR (SELECT project_id FROM model_runs WHERE id = NEW.model_run_id) IS NULL
        OR (SELECT project_id FROM model_runs WHERE id = NEW.model_run_id) <> NEW.project_id
        OR (NEW.scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id)
        OR (NEW.valid_from_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_from_scene_id) <> NEW.project_id)
        OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'inference project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS inferences_initial_status_version_guard
      BEFORE INSERT ON inferences
      WHEN NEW.status <> 'active' OR NEW.version <> 1
      BEGIN SELECT RAISE(ABORT, 'inference must start active at version 1'); END;

      CREATE TRIGGER IF NOT EXISTS inferences_immutable_guard
      BEFORE UPDATE OF id, project_id, subject_entity_id, predicate, value_json, value_type, scope, scene_id, valid_from_scene_id, valid_to_scene_id, confidence, rationale, model_run_id, created_at ON inferences
      WHEN NOT (
        NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.subject_entity_id IS OLD.subject_entity_id
        AND NEW.predicate IS OLD.predicate AND NEW.value_json IS OLD.value_json AND NEW.value_type IS OLD.value_type
        AND NEW.scope IS OLD.scope AND NEW.scene_id IS OLD.scene_id AND NEW.valid_from_scene_id IS OLD.valid_from_scene_id
        AND NEW.valid_to_scene_id IS OLD.valid_to_scene_id AND NEW.confidence IS OLD.confidence
        AND NEW.rationale IS OLD.rationale AND NEW.model_run_id IS OLD.model_run_id AND NEW.created_at IS OLD.created_at
      )
      BEGIN SELECT RAISE(ABORT, 'inference payload/provenance is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS inferences_status_version_guard
      BEFORE UPDATE OF status, version ON inferences
      WHEN NEW.version < OLD.version OR NEW.version > OLD.version + 1
        OR (NEW.status = OLD.status AND NEW.version <> OLD.version)
        OR (NEW.status <> OLD.status AND NEW.version <> OLD.version + 1)
        OR (OLD.status <> 'active' AND NEW.status <> OLD.status)
        OR NEW.status NOT IN ('active', 'dismissed', 'promoted', 'stale')
      BEGIN SELECT RAISE(ABORT, 'inference status/version transition is invalid'); END;

      CREATE TRIGGER IF NOT EXISTS inference_evidence_project_guard
      BEFORE INSERT ON inference_evidence
      WHEN (SELECT project_id FROM inferences WHERE id = NEW.inference_id) IS NULL
        OR (SELECT project_id FROM inferences WHERE id = NEW.inference_id) <> NEW.project_id
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.evidence_source_id) IS NULL
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.evidence_source_id) <> NEW.project_id
      BEGIN SELECT RAISE(ABORT, 'inference evidence project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS inference_evidence_immutable_guard
      BEFORE UPDATE OF project_id, inference_id, evidence_source_id, created_at ON inference_evidence
      WHEN NOT (NEW.project_id IS OLD.project_id AND NEW.inference_id IS OLD.inference_id
        AND NEW.evidence_source_id IS OLD.evidence_source_id AND NEW.created_at IS OLD.created_at)
      BEGIN SELECT RAISE(ABORT, 'inference evidence is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS pending_patches_project_guard
      BEFORE INSERT ON pending_patches
      WHEN (SELECT project_id FROM scene_revisions WHERE id = NEW.source_revision_id) IS NULL
        OR (SELECT project_id FROM scene_revisions WHERE id = NEW.source_revision_id) <> NEW.project_id
        OR (NEW.target_entity_id IS NOT NULL AND ((SELECT project_id FROM entities WHERE id = NEW.target_entity_id) IS NULL OR (SELECT project_id FROM entities WHERE id = NEW.target_entity_id) <> NEW.project_id))
        OR (NEW.target_fact_id IS NOT NULL AND ((SELECT project_id FROM facts WHERE id = NEW.target_fact_id) IS NULL OR (SELECT project_id FROM facts WHERE id = NEW.target_fact_id) <> NEW.project_id))
        OR (NEW.inference_id IS NOT NULL AND ((SELECT project_id FROM inferences WHERE id = NEW.inference_id) IS NULL OR (SELECT project_id FROM inferences WHERE id = NEW.inference_id) <> NEW.project_id))
        OR (NEW.model_run_id IS NOT NULL AND ((SELECT project_id FROM model_runs WHERE id = NEW.model_run_id) IS NULL OR (SELECT project_id FROM model_runs WHERE id = NEW.model_run_id) <> NEW.project_id))
      BEGIN SELECT RAISE(ABORT, 'pending patch project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS pending_patches_initial_status_version_guard
      BEFORE INSERT ON pending_patches
      WHEN NEW.status <> 'pending' OR NEW.version <> 1
      BEGIN SELECT RAISE(ABORT, 'pending patch must start pending at version 1'); END;

      CREATE TRIGGER IF NOT EXISTS pending_patches_immutable_guard
      BEFORE UPDATE OF id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, proposed_by, created_at ON pending_patches
      WHEN NOT (
        NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.operation IS OLD.operation
        AND NEW.target_entity_id IS OLD.target_entity_id AND NEW.target_fact_id IS OLD.target_fact_id
        AND NEW.base_version IS OLD.base_version AND NEW.payload_json IS OLD.payload_json
        AND NEW.input_fingerprint IS OLD.input_fingerprint
        AND NEW.truth_class IS OLD.truth_class AND NEW.confidence IS OLD.confidence
        AND NEW.conflict_kind IS OLD.conflict_kind AND NEW.conflicting_fact_ids_json IS OLD.conflicting_fact_ids_json
        AND NEW.conflict_message IS OLD.conflict_message AND NEW.source_revision_id IS OLD.source_revision_id
        AND NEW.inference_id IS OLD.inference_id AND NEW.model_run_id IS OLD.model_run_id
        AND NEW.proposed_by IS OLD.proposed_by AND NEW.created_at IS OLD.created_at
      )
      BEGIN SELECT RAISE(ABORT, 'pending patch payload/provenance is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS pending_patches_status_version_guard
      BEFORE UPDATE OF status, version ON pending_patches
      WHEN NEW.version < OLD.version OR NEW.version > OLD.version + 1
        OR (NEW.status = OLD.status AND NEW.version <> OLD.version)
        OR (NEW.status <> OLD.status AND NEW.version <> OLD.version + 1)
        OR (OLD.status <> 'pending' AND NEW.status <> OLD.status)
        OR NEW.status NOT IN ('pending', 'accepted', 'rejected', 'expired', 'superseded')
      BEGIN SELECT RAISE(ABORT, 'pending patch status/version transition is invalid'); END;

      CREATE TRIGGER IF NOT EXISTS pending_patches_accepted_application_guard
      BEFORE UPDATE OF status ON pending_patches
      WHEN NEW.status = 'accepted'
        AND NOT EXISTS (
          SELECT 1 FROM patch_applications pa
          WHERE pa.project_id = NEW.project_id
            AND pa.patch_id = NEW.id
            AND pa.operation = NEW.operation
            AND ((NEW.operation IN ('add_fact', 'replace_fact') AND pa.resulting_fact_id IS NOT NULL)
              OR (NEW.operation = 'retract_fact' AND pa.resulting_fact_id = NEW.target_fact_id))
            AND EXISTS (SELECT 1 FROM audit_events ae WHERE ae.project_id = pa.project_id AND ae.aggregate_id = NEW.id AND ae.event_type = 'patch.accepted' AND ae.request_id = pa.request_id)
            AND EXISTS (SELECT 1 FROM audit_events ae WHERE ae.project_id = pa.project_id AND ae.aggregate_id = NEW.id AND ae.event_type = 'story_bible.changed' AND ae.request_id = pa.request_id)
            AND EXISTS (SELECT 1 FROM outbox_events oe WHERE oe.project_id = pa.project_id AND oe.aggregate_id = NEW.id AND oe.event_type = 'patch.accepted' AND oe.request_id = pa.request_id)
            AND EXISTS (SELECT 1 FROM outbox_events oe WHERE oe.project_id = pa.project_id AND oe.aggregate_id = NEW.id AND oe.event_type = 'story_bible.changed' AND oe.request_id = pa.request_id)
        )
      BEGIN SELECT RAISE(ABORT, 'accepted patch requires matching application and domain events'); END;

      CREATE TRIGGER IF NOT EXISTS patch_evidence_project_guard
      BEFORE INSERT ON patch_evidence
      WHEN (SELECT project_id FROM pending_patches WHERE id = NEW.patch_id) IS NULL
        OR (SELECT project_id FROM pending_patches WHERE id = NEW.patch_id) <> NEW.project_id
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.evidence_source_id) IS NULL
        OR (SELECT project_id FROM evidence_sources WHERE id = NEW.evidence_source_id) <> NEW.project_id
      BEGIN SELECT RAISE(ABORT, 'patch evidence project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS patch_evidence_immutable_guard
      BEFORE UPDATE OF project_id, patch_id, evidence_source_id, created_at ON patch_evidence
      WHEN NOT (NEW.project_id IS OLD.project_id AND NEW.patch_id IS OLD.patch_id
        AND NEW.evidence_source_id IS OLD.evidence_source_id AND NEW.created_at IS OLD.created_at)
      BEGIN SELECT RAISE(ABORT, 'patch evidence is immutable'); END;

      CREATE TRIGGER IF NOT EXISTS patch_application_project_guard
      BEFORE INSERT ON patch_applications
      WHEN (SELECT project_id FROM pending_patches WHERE id = NEW.patch_id) IS NULL
        OR (SELECT project_id FROM pending_patches WHERE id = NEW.patch_id) <> NEW.project_id
        OR (NEW.resulting_fact_id IS NOT NULL AND ((SELECT project_id FROM facts WHERE id = NEW.resulting_fact_id) IS NULL OR (SELECT project_id FROM facts WHERE id = NEW.resulting_fact_id) <> NEW.project_id))
      BEGIN SELECT RAISE(ABORT, 'patch application project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS patch_application_operation_guard
      BEFORE INSERT ON patch_applications
      WHEN (SELECT operation FROM pending_patches WHERE id = NEW.patch_id) IS NULL
        OR (SELECT operation FROM pending_patches WHERE id = NEW.patch_id) <> NEW.operation
        OR (NEW.operation IN ('add_fact', 'replace_fact') AND NEW.resulting_fact_id IS NULL)
        OR (NEW.operation = 'retract_fact' AND NEW.resulting_fact_id <> (SELECT target_fact_id FROM pending_patches WHERE id = NEW.patch_id))
      BEGIN SELECT RAISE(ABORT, 'patch application operation/result mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS patch_application_immutable_guard
      BEFORE UPDATE OF id, project_id, patch_id, operation, resulting_fact_id, applied_payload_json, request_id, created_at ON patch_applications
      WHEN NOT (NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.patch_id IS OLD.patch_id
        AND NEW.operation IS OLD.operation AND NEW.resulting_fact_id IS OLD.resulting_fact_id
        AND NEW.applied_payload_json IS OLD.applied_payload_json
        AND NEW.request_id IS OLD.request_id AND NEW.created_at IS OLD.created_at)
      BEGIN SELECT RAISE(ABORT, 'patch application is immutable'); END;

      DROP TRIGGER IF EXISTS facts_immutable_columns_guard;
      CREATE TRIGGER facts_immutable_columns_guard
      BEFORE UPDATE OF project_id, subject_entity_id, predicate, value_json, value_type, truth_class, scope, scene_id, valid_from_scene_id, valid_to_scene_id, source_id, supersedes_fact_id, promoted_from_inference_id, created_at ON facts
      WHEN NEW.project_id IS NOT OLD.project_id OR NEW.subject_entity_id IS NOT OLD.subject_entity_id
        OR NEW.predicate IS NOT OLD.predicate OR NEW.value_json IS NOT OLD.value_json
        OR NEW.value_type IS NOT OLD.value_type OR NEW.truth_class IS NOT OLD.truth_class
        OR NEW.scope IS NOT OLD.scope OR NEW.scene_id IS NOT OLD.scene_id
        OR NEW.valid_from_scene_id IS NOT OLD.valid_from_scene_id OR NEW.valid_to_scene_id IS NOT OLD.valid_to_scene_id
        OR NEW.source_id IS NOT OLD.source_id OR NEW.supersedes_fact_id IS NOT OLD.supersedes_fact_id
        OR NEW.promoted_from_inference_id IS NOT OLD.promoted_from_inference_id OR NEW.created_at IS NOT OLD.created_at
      BEGIN SELECT RAISE(ABORT, 'fact immutable columns cannot be updated'); END;

      CREATE TRIGGER IF NOT EXISTS facts_promoted_inference_project_guard
      BEFORE INSERT ON facts
      WHEN NEW.promoted_from_inference_id IS NOT NULL
        AND ((SELECT project_id FROM inferences WHERE id = NEW.promoted_from_inference_id) IS NULL
          OR (SELECT project_id FROM inferences WHERE id = NEW.promoted_from_inference_id) <> NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'fact promoted inference project mismatch'); END;

      CREATE TRIGGER IF NOT EXISTS facts_entity_ref_project_guard
      BEFORE INSERT ON facts
      WHEN NEW.value_type = 'entity_ref'
        AND (
          json_type(NEW.value_json) <> 'text'
          OR (SELECT project_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) IS NULL
          OR (SELECT project_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) <> NEW.project_id
          OR (SELECT status FROM entities WHERE id = json_extract(NEW.value_json, '$')) NOT IN ('active', 'draft')
          OR (SELECT merged_into_entity_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) IS NOT NULL
        )
      BEGIN SELECT RAISE(ABORT, 'fact entity reference project or status mismatch'); END;
    `);
    });
  }

  if (currentVersion < 10) {
    runMigration(database, 10, () => database.exec(`
      /* A Phase 2 Pending Patch is always a Canon review command.  Inference
       * is persisted in the separate inferences table and must never be
       * accepted by this mutation path.  These triggers also cover databases
       * that already completed v9 before this invariant was tightened. */
      CREATE TRIGGER IF NOT EXISTS pending_patches_canon_truth_guard
      BEFORE INSERT ON pending_patches
      WHEN NEW.truth_class <> 'canon'
      BEGIN SELECT RAISE(ABORT, 'pending patch truth class must be canon'); END;

      CREATE TRIGGER IF NOT EXISTS pending_patches_shape_guard
      BEFORE INSERT ON pending_patches
      WHEN (NEW.operation = 'add_fact' AND (NEW.target_entity_id IS NULL OR NEW.target_fact_id IS NOT NULL OR NEW.base_version IS NULL))
        OR (NEW.operation = 'replace_fact' AND (NEW.target_entity_id IS NULL OR NEW.target_fact_id IS NULL OR NEW.base_version IS NULL))
        OR (NEW.operation = 'retract_fact' AND (NEW.target_fact_id IS NULL OR NEW.base_version IS NULL))
      BEGIN SELECT RAISE(ABORT, 'pending patch command shape is invalid'); END;

      DROP TRIGGER IF EXISTS pending_patches_accepted_application_guard;
      CREATE TRIGGER pending_patches_accepted_application_guard
      BEFORE UPDATE OF status ON pending_patches
      WHEN NEW.status = 'accepted'
        AND (
          NEW.truth_class <> 'canon'
          OR NOT EXISTS (
            SELECT 1 FROM patch_applications pa
            WHERE pa.project_id = NEW.project_id
              AND pa.patch_id = NEW.id
              AND pa.operation = NEW.operation
              AND ((NEW.operation IN ('add_fact', 'replace_fact') AND pa.resulting_fact_id IS NOT NULL)
                OR (NEW.operation = 'retract_fact' AND pa.resulting_fact_id = NEW.target_fact_id))
              AND EXISTS (SELECT 1 FROM audit_events ae WHERE ae.project_id = pa.project_id AND ae.aggregate_id = NEW.id AND ae.event_type = 'patch.accepted' AND ae.request_id = pa.request_id)
              AND EXISTS (SELECT 1 FROM audit_events ae WHERE ae.project_id = pa.project_id AND ae.aggregate_id = NEW.id AND ae.event_type = 'story_bible.changed' AND ae.request_id = pa.request_id)
              AND EXISTS (SELECT 1 FROM outbox_events oe WHERE oe.project_id = pa.project_id AND oe.aggregate_id = NEW.id AND oe.event_type = 'patch.accepted' AND oe.request_id = pa.request_id)
              AND EXISTS (SELECT 1 FROM outbox_events oe WHERE oe.project_id = pa.project_id AND oe.aggregate_id = NEW.id AND oe.event_type = 'story_bible.changed' AND oe.request_id = pa.request_id)
          )
        )
      BEGIN SELECT RAISE(ABORT, 'accepted patch requires Canon application and domain events'); END;
    `));
  }

  if (currentVersion < 11) {
    runMigration(database, 11, () => database.exec(`
      /* Scope is part of a fact's identity.  Keep malformed direct-SQL rows
       * out of both Canon and Inference, including range bounds that cross
       * documents or run backwards in narrative order. */
      CREATE TRIGGER IF NOT EXISTS facts_scope_shape_guard
      BEFORE INSERT ON facts
      WHEN (NEW.scope = 'base' AND (NEW.scene_id IS NOT NULL OR NEW.valid_from_scene_id IS NOT NULL OR NEW.valid_to_scene_id IS NOT NULL))
        OR (NEW.scope = 'scene' AND (NEW.scene_id IS NULL OR NEW.valid_from_scene_id IS NOT NULL OR NEW.valid_to_scene_id IS NOT NULL))
        OR (NEW.scope = 'range' AND (
          NEW.scene_id IS NOT NULL
          OR NEW.valid_from_scene_id IS NULL
          OR (SELECT project_id FROM scenes WHERE id = NEW.valid_from_scene_id) IS NULL
          OR (SELECT project_id FROM scenes WHERE id = NEW.valid_from_scene_id) <> NEW.project_id
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_to_scene_id) IS NULL)
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> NEW.project_id)
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT document_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> (SELECT document_id FROM scenes WHERE id = NEW.valid_from_scene_id))
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT narrative_rank FROM scenes WHERE id = NEW.valid_to_scene_id) < (SELECT narrative_rank FROM scenes WHERE id = NEW.valid_from_scene_id))
        ))
        OR (NEW.scope = 'scene' AND ((SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id))
      BEGIN SELECT RAISE(ABORT, 'fact scope shape or scene continuity is invalid'); END;

      CREATE TRIGGER IF NOT EXISTS inferences_scope_shape_guard
      BEFORE INSERT ON inferences
      WHEN (NEW.scope = 'base' AND (NEW.scene_id IS NOT NULL OR NEW.valid_from_scene_id IS NOT NULL OR NEW.valid_to_scene_id IS NOT NULL))
        OR (NEW.scope = 'scene' AND (NEW.scene_id IS NULL OR NEW.valid_from_scene_id IS NOT NULL OR NEW.valid_to_scene_id IS NOT NULL))
        OR (NEW.scope = 'range' AND (
          NEW.scene_id IS NOT NULL
          OR NEW.valid_from_scene_id IS NULL
          OR (SELECT project_id FROM scenes WHERE id = NEW.valid_from_scene_id) IS NULL
          OR (SELECT project_id FROM scenes WHERE id = NEW.valid_from_scene_id) <> NEW.project_id
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_to_scene_id) IS NULL)
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> NEW.project_id)
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT document_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> (SELECT document_id FROM scenes WHERE id = NEW.valid_from_scene_id))
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT narrative_rank FROM scenes WHERE id = NEW.valid_to_scene_id) < (SELECT narrative_rank FROM scenes WHERE id = NEW.valid_from_scene_id))
        ))
        OR (NEW.scope = 'scene' AND ((SELECT project_id FROM scenes WHERE id = NEW.scene_id) IS NULL OR (SELECT project_id FROM scenes WHERE id = NEW.scene_id) <> NEW.project_id))
      BEGIN SELECT RAISE(ABORT, 'inference scope shape or scene continuity is invalid'); END;

      CREATE TRIGGER IF NOT EXISTS inferences_entity_ref_project_guard
      BEFORE INSERT ON inferences
      WHEN NEW.value_type = 'entity_ref'
        AND (
          json_type(NEW.value_json) <> 'text'
          OR (SELECT project_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) IS NULL
          OR (SELECT project_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) <> NEW.project_id
          OR (SELECT status FROM entities WHERE id = json_extract(NEW.value_json, '$')) NOT IN ('active', 'draft')
          OR (SELECT merged_into_entity_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) IS NOT NULL
        )
      BEGIN SELECT RAISE(ABORT, 'inference entity reference project or status mismatch'); END;

      /* The application row is not merely an audit receipt.  An accepted
       * patch must point at a Canon Fact whose actual fields equal the
       * applied (possibly edited) payload, whose source is this patch's
       * revision-bound evidence, and whose target/inference lifecycle agrees
       * with the operation. */
      CREATE TRIGGER IF NOT EXISTS pending_patches_accepted_fact_provenance_guard
      BEFORE UPDATE OF status ON pending_patches
      WHEN NEW.status = 'accepted'
        AND (
          NOT EXISTS (
            SELECT 1 FROM scene_revisions sr
            JOIN script_documents d ON d.id = sr.document_id AND d.project_id = sr.project_id
            WHERE sr.id = NEW.source_revision_id
              AND sr.project_id = NEW.project_id
              AND d.current_revision_id = sr.document_revision_id
              AND (NEW.operation = 'retract_fact' OR sr.status = 'active')
          )
          OR (NEW.operation = 'retract_fact' AND NEW.inference_id IS NOT NULL)
          OR (NEW.inference_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM inferences i
            WHERE i.id = NEW.inference_id
              AND i.project_id = NEW.project_id
              AND i.model_run_id = NEW.model_run_id
              AND i.status = 'promoted'
          ))
          OR (
            NEW.operation IN ('add_fact', 'replace_fact')
            AND NOT EXISTS (
              SELECT 1
              FROM patch_applications pa
              JOIN facts f ON f.id = pa.resulting_fact_id AND f.project_id = NEW.project_id
              WHERE pa.project_id = NEW.project_id
                AND pa.patch_id = NEW.id
                AND pa.operation = NEW.operation
              AND f.status = 'active'
              AND f.truth_class = 'canon'
              AND f.subject_entity_id = NEW.target_entity_id
              AND json_extract(pa.applied_payload_json, '$.subjectEntityId') = NEW.target_entity_id
              AND f.predicate = json_extract(pa.applied_payload_json, '$.predicate')
                AND f.value_type = json_extract(pa.applied_payload_json, '$.valueType')
                AND f.value_json = json(pa.applied_payload_json -> '$.value')
                AND f.scope = json_extract(pa.applied_payload_json, '$.scope')
                AND f.scene_id IS json_extract(pa.applied_payload_json, '$.sceneId')
                AND f.valid_from_scene_id IS json_extract(pa.applied_payload_json, '$.validFromSceneId')
                AND f.valid_to_scene_id IS json_extract(pa.applied_payload_json, '$.validToSceneId')
                AND f.promoted_from_inference_id IS NEW.inference_id
                AND (NEW.inference_id IS NULL OR EXISTS (
                  SELECT 1 FROM inferences i
                  WHERE i.id = NEW.inference_id
                    AND i.project_id = NEW.project_id
                    AND i.model_run_id = NEW.model_run_id
                    AND i.subject_entity_id = f.subject_entity_id
                    AND i.predicate = f.predicate
                    AND i.value_type = f.value_type
                    AND i.scope = f.scope
                    AND i.scene_id IS f.scene_id
                    AND i.valid_from_scene_id IS f.valid_from_scene_id
                    AND i.valid_to_scene_id IS f.valid_to_scene_id
                ))
                AND (NEW.inference_id IS NULL OR (
                  EXISTS (
                    SELECT 1 FROM inference_evidence ie
                    JOIN patch_evidence pe ON pe.project_id = ie.project_id AND pe.patch_id = NEW.id AND pe.evidence_source_id = ie.evidence_source_id
                    WHERE ie.project_id = NEW.project_id AND ie.inference_id = NEW.inference_id
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM inference_evidence ie
                    WHERE ie.project_id = NEW.project_id AND ie.inference_id = NEW.inference_id
                      AND NOT EXISTS (
                        SELECT 1 FROM patch_evidence pe
                        WHERE pe.project_id = NEW.project_id AND pe.patch_id = NEW.id AND pe.evidence_source_id = ie.evidence_source_id
                      )
                  )
                ))
                AND EXISTS (
                  SELECT 1
                  FROM patch_evidence pe
                  JOIN evidence_sources es ON es.id = pe.evidence_source_id AND es.project_id = pe.project_id
                  WHERE pe.project_id = NEW.project_id
                    AND pe.patch_id = NEW.id
                    AND es.id = f.source_id
                    AND es.scene_revision_id = NEW.source_revision_id
                    AND (NEW.model_run_id IS NULL OR es.model_run_id = NEW.model_run_id)
                )
                AND (
                  (NEW.operation = 'add_fact' AND NEW.target_fact_id IS NULL AND f.supersedes_fact_id IS NULL
                    AND EXISTS (
                      SELECT 1 FROM entities e
                      WHERE e.id = NEW.target_entity_id
                        AND e.project_id = NEW.project_id
                        AND e.version = NEW.base_version
                    ))
                  OR (NEW.operation = 'replace_fact'
                    AND f.supersedes_fact_id = NEW.target_fact_id
                    AND EXISTS (
                      SELECT 1 FROM facts previous
                      WHERE previous.id = NEW.target_fact_id
                        AND previous.project_id = NEW.project_id
                        AND previous.status = 'superseded'
                        AND previous.version = NEW.base_version + 1
                        AND previous.subject_entity_id = f.subject_entity_id
                        AND previous.predicate = f.predicate
                        AND previous.scope = f.scope
                        AND previous.scene_id IS f.scene_id
                        AND previous.valid_from_scene_id IS f.valid_from_scene_id
                        AND previous.valid_to_scene_id IS f.valid_to_scene_id
                    ))
                )
            )
          )
          OR (
            NEW.operation = 'retract_fact'
            AND NOT EXISTS (
              SELECT 1
              FROM patch_applications pa
              JOIN facts f ON f.id = pa.resulting_fact_id AND f.project_id = NEW.project_id
              WHERE pa.project_id = NEW.project_id
                AND pa.patch_id = NEW.id
                AND pa.operation = 'retract_fact'
                AND pa.resulting_fact_id = NEW.target_fact_id
                AND json(pa.applied_payload_json) = '{}'
                AND f.status = 'retracted'
                AND f.truth_class = 'canon'
                AND f.version = NEW.base_version + 1
                AND EXISTS (
                  SELECT 1
                  FROM patch_evidence pe
                  JOIN evidence_sources es ON es.id = pe.evidence_source_id AND es.project_id = pe.project_id
                  WHERE pe.project_id = NEW.project_id
                    AND pe.patch_id = NEW.id
                    AND es.scene_revision_id = NEW.source_revision_id
                    AND (NEW.model_run_id IS NULL OR es.model_run_id = NEW.model_run_id)
                )
            )
          )
        )
      BEGIN SELECT RAISE(ABORT, 'accepted patch result does not match Canon provenance'); END;
    `));
  }

  if (currentVersion < 12) {
    runMigration(database, 12, () => database.exec(`
      /* A model run is usable provenance only after it has completed
       * successfully for this exact source revision.  Also reject an
       * accepted patch whose junction contains any evidence from another
       * revision or (when present) another model run.  This is additive so
       * databases that already ran v11 receive the same acceptance fence. */
      CREATE TRIGGER IF NOT EXISTS pending_patches_accepted_model_provenance_guard
      BEFORE UPDATE OF status ON pending_patches
      WHEN NEW.status = 'accepted'
        AND (
          (NEW.model_run_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM model_runs mr
            WHERE mr.id = NEW.model_run_id
              AND mr.project_id = NEW.project_id
              AND mr.status = 'succeeded'
              AND mr.source_revision_id = NEW.source_revision_id
          ))
          OR EXISTS (
            SELECT 1
            FROM patch_evidence pe
            JOIN evidence_sources es ON es.id = pe.evidence_source_id AND es.project_id = pe.project_id
            WHERE pe.project_id = NEW.project_id
              AND pe.patch_id = NEW.id
              AND (
                es.scene_revision_id IS NOT NEW.source_revision_id
                OR es.model_run_id IS NOT NEW.model_run_id
              )
          )
          OR (NEW.inference_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM inference_evidence ie
            JOIN evidence_sources es ON es.id = ie.evidence_source_id AND es.project_id = ie.project_id
            WHERE ie.project_id = NEW.project_id
              AND ie.inference_id = NEW.inference_id
              AND (
                es.scene_revision_id IS NOT NEW.source_revision_id
                OR es.model_run_id IS NOT NEW.model_run_id
              )
          ))
        )
      BEGIN SELECT RAISE(ABORT, 'accepted patch model/evidence provenance is invalid'); END;
    `));
  }

  if (currentVersion < 13) {
    runMigration(database, 13, () => {
      /*
       * Phase 3 continuity is document-scoped. Existing documents receive a
       * stable main lane whose ID is the document ID; this keeps old scene
       * references valid while making the lane explicit on every immutable
       * revision.
       */
      database.exec(`
        CREATE TABLE IF NOT EXISTS continuity_groups (
          id TEXT PRIMARY KEY NOT NULL,
          project_id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('main', 'flashback', 'dream', 'parallel', 'custom')),
          name TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (document_id) REFERENCES script_documents(id) ON DELETE CASCADE,
          UNIQUE (document_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_continuity_groups_document
          ON continuity_groups(project_id, document_id, created_at ASC, id ASC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_continuity_groups_one_default
          ON continuity_groups(document_id) WHERE is_default = 1;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_continuity_groups_one_main
          ON continuity_groups(document_id, kind) WHERE kind = 'main';

        CREATE TRIGGER IF NOT EXISTS continuity_groups_project_guard
        BEFORE INSERT ON continuity_groups
        WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
          OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
          OR ((NEW.is_default = 1) <> (NEW.kind = 'main'))
          OR NEW.version <> 1
        BEGIN SELECT RAISE(ABORT, 'continuity group project mismatch'); END;

        CREATE TRIGGER IF NOT EXISTS continuity_groups_update_project_guard
        BEFORE UPDATE OF project_id, document_id ON continuity_groups
        WHEN (SELECT project_id FROM script_documents WHERE id = NEW.document_id) IS NULL
          OR (SELECT project_id FROM script_documents WHERE id = NEW.document_id) <> NEW.project_id
          OR ((NEW.is_default = 1) <> (NEW.kind = 'main'))
          OR NEW.version < OLD.version
        BEGIN SELECT RAISE(ABORT, 'continuity group project mismatch'); END;

        DROP TRIGGER IF EXISTS continuity_groups_immutable_guard;
        CREATE TRIGGER continuity_groups_immutable_guard
        BEFORE UPDATE OF id, project_id, document_id, name, kind, is_default, version, created_at, updated_at ON continuity_groups
        WHEN NOT (NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.document_id IS OLD.document_id
          AND NEW.name IS OLD.name AND NEW.kind IS OLD.kind AND NEW.is_default IS OLD.is_default AND NEW.version IS OLD.version
          AND NEW.created_at IS OLD.created_at AND NEW.updated_at IS OLD.updated_at)
        BEGIN SELECT RAISE(ABORT, 'continuity group is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS continuity_groups_delete_guard
        BEFORE DELETE ON continuity_groups
        WHEN OLD.is_default = 1
          OR EXISTS (SELECT 1 FROM scenes WHERE continuity_group_id = OLD.id)
          OR EXISTS (SELECT 1 FROM scene_revisions WHERE continuity_group_id = OLD.id)
          OR EXISTS (SELECT 1 FROM entity_states WHERE continuity_group_id = OLD.id)
        BEGIN SELECT RAISE(ABORT, 'continuity group is referenced or default'); END;
      `);

      const documents = database.prepare("SELECT id, project_id FROM script_documents ORDER BY id").all() as Array<{ id?: string; project_id?: string }>;
      const timestamp = new Date().toISOString();
      const insertGroup = database.prepare("INSERT OR IGNORE INTO continuity_groups (id, project_id, document_id, kind, name, is_default, version, created_at, updated_at) VALUES (:id, :projectId, :documentId, 'main', :name, 1, 1, :createdAt, :updatedAt)");
      for (const document of documents) {
        if (!document.id || !document.project_id) continue;
        insertGroup.run({ id: document.id, projectId: document.project_id, documentId: document.id, name: "Main", createdAt: timestamp, updatedAt: timestamp });
      }

      const sceneColumns = database.prepare("PRAGMA table_info(scenes)").all() as Array<{ name?: string }>;
      if (!sceneColumns.some((column) => column.name === "continuity_group_id")) database.exec("ALTER TABLE scenes ADD COLUMN continuity_group_id TEXT");
      const sceneRevisionColumns = database.prepare("PRAGMA table_info(scene_revisions)").all() as Array<{ name?: string }>;
      if (!sceneRevisionColumns.some((column) => column.name === "continuity_group_id")) database.exec("ALTER TABLE scene_revisions ADD COLUMN continuity_group_id TEXT");
      database.exec("UPDATE scenes SET continuity_group_id = document_id WHERE continuity_group_id IS NULL");
      database.exec("UPDATE scene_revisions SET continuity_group_id = document_id WHERE continuity_group_id IS NULL");
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_scenes_document_group_rank
          ON scenes(document_id, continuity_group_id, narrative_rank, id);
        CREATE INDEX IF NOT EXISTS idx_scene_revisions_group_rank
          ON scene_revisions(document_id, continuity_group_id, narrative_rank, scene_id, created_at DESC);
        CREATE TRIGGER IF NOT EXISTS story_scenes_continuity_group_guard
        BEFORE INSERT ON scenes
        WHEN NEW.continuity_group_id IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.project_id
          OR (SELECT document_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.document_id
        BEGIN SELECT RAISE(ABORT, 'scene continuity group mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS story_scenes_continuity_group_update_guard
        BEFORE UPDATE OF continuity_group_id, project_id, document_id ON scenes
        WHEN NEW.continuity_group_id IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.project_id
          OR (SELECT document_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.document_id
        BEGIN SELECT RAISE(ABORT, 'scene continuity group mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS story_scene_revisions_continuity_group_guard
        BEFORE INSERT ON scene_revisions
        WHEN NEW.continuity_group_id IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.project_id
          OR (SELECT document_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.document_id
          OR (SELECT continuity_group_id FROM scenes WHERE id = NEW.scene_id) <> NEW.continuity_group_id
        BEGIN SELECT RAISE(ABORT, 'scene revision continuity group mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS story_scene_revisions_continuity_group_update_guard
        BEFORE UPDATE OF continuity_group_id, project_id, document_id, scene_id ON scene_revisions
        WHEN NEW.continuity_group_id IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.project_id
          OR (SELECT document_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.document_id
          OR (SELECT continuity_group_id FROM scenes WHERE id = NEW.scene_id) <> NEW.continuity_group_id
        BEGIN SELECT RAISE(ABORT, 'scene revision continuity group mismatch'); END;
        DROP TRIGGER IF EXISTS scene_revisions_immutable_columns_guard;
        CREATE TRIGGER scene_revisions_immutable_columns_guard
        BEFORE UPDATE OF id, project_id, document_id, scene_id, continuity_group_id, document_revision_id, narrative_rank, title, content, content_hash, status, created_at ON scene_revisions
        WHEN NOT (
          NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.document_id IS OLD.document_id
          AND NEW.scene_id IS OLD.scene_id AND NEW.continuity_group_id IS OLD.continuity_group_id
          AND NEW.document_revision_id IS OLD.document_revision_id AND NEW.narrative_rank IS OLD.narrative_rank
          AND NEW.title IS OLD.title AND NEW.content IS OLD.content AND NEW.content_hash IS OLD.content_hash
          AND NEW.status IS OLD.status AND NEW.created_at IS OLD.created_at
        )
        BEGIN SELECT RAISE(ABORT, 'scene revision is immutable'); END;
      `);

      /*
       * SQLite cannot alter a CHECK constraint. Rebuild the two Patch
       * contract tables and their evidence junction in one migration while
       * retaining every v12 row byte-for-byte. The old tables are removed
       * only after the junction rows have been copied into temporary backups.
       */
      database.exec(`
        DROP TRIGGER IF EXISTS pending_patches_canon_truth_guard;
        DROP TRIGGER IF EXISTS pending_patches_shape_guard;
        DROP TRIGGER IF EXISTS pending_patches_project_guard;
        DROP TRIGGER IF EXISTS pending_patches_initial_status_version_guard;
        DROP TRIGGER IF EXISTS pending_patches_immutable_guard;
        DROP TRIGGER IF EXISTS pending_patches_status_version_guard;
        DROP TRIGGER IF EXISTS pending_patches_accepted_application_guard;
        DROP TRIGGER IF EXISTS pending_patches_accepted_fact_provenance_guard;
        DROP TRIGGER IF EXISTS pending_patches_accepted_model_provenance_guard;
        DROP TRIGGER IF EXISTS patch_evidence_project_guard;
        DROP TRIGGER IF EXISTS patch_evidence_immutable_guard;
        DROP TRIGGER IF EXISTS patch_application_project_guard;
        DROP TRIGGER IF EXISTS patch_application_operation_guard;
        DROP TRIGGER IF EXISTS patch_application_immutable_guard;
        CREATE TEMP TABLE phase3_pending_patches_backup AS SELECT * FROM pending_patches;
        CREATE TEMP TABLE phase3_patch_evidence_backup AS SELECT * FROM patch_evidence;
        CREATE TEMP TABLE phase3_patch_applications_backup AS SELECT * FROM patch_applications;
        DROP TABLE patch_applications;
        DROP TABLE patch_evidence;
        DROP TABLE pending_patches;

        CREATE TABLE pending_patches (
          id TEXT PRIMARY KEY NOT NULL,
          project_id TEXT NOT NULL,
          operation TEXT NOT NULL CHECK (operation IN ('add_fact', 'replace_fact', 'retract_fact', 'add_state')),
          target_entity_id TEXT,
          target_fact_id TEXT,
          base_version INTEGER,
          payload_json TEXT NOT NULL,
          input_fingerprint TEXT NOT NULL DEFAULT '',
          truth_class TEXT NOT NULL CHECK (truth_class = 'canon'),
          confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
          conflict_kind TEXT NOT NULL DEFAULT 'none' CHECK (conflict_kind IN ('none', 'possible', 'hard')),
          conflicting_fact_ids_json TEXT NOT NULL DEFAULT '[]',
          conflicting_state_ids_json TEXT NOT NULL DEFAULT '[]',
          conflict_message TEXT,
          source_revision_id TEXT NOT NULL,
          inference_id TEXT,
          model_run_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'superseded')),
          proposed_by TEXT NOT NULL CHECK (proposed_by IN ('rule', 'model', 'user', 'import')),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          created_at TEXT NOT NULL,
          resolved_at TEXT,
          resolved_by_user_id TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE SET NULL,
          FOREIGN KEY (target_fact_id) REFERENCES facts(id) ON DELETE SET NULL,
          FOREIGN KEY (source_revision_id) REFERENCES scene_revisions(id) ON DELETE CASCADE,
          FOREIGN KEY (inference_id) REFERENCES inferences(id) ON DELETE SET NULL,
          FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE SET NULL,
          CHECK (
            (operation = 'add_fact' AND target_entity_id IS NOT NULL AND target_fact_id IS NULL AND base_version IS NOT NULL)
            OR (operation = 'replace_fact' AND target_entity_id IS NOT NULL AND target_fact_id IS NOT NULL AND base_version IS NOT NULL)
            OR (operation = 'retract_fact' AND target_fact_id IS NOT NULL AND base_version IS NOT NULL)
            OR (operation = 'add_state' AND target_entity_id IS NOT NULL AND target_fact_id IS NULL AND base_version IS NOT NULL)
          )
        );
        INSERT INTO pending_patches (id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflicting_state_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id)
          SELECT id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, '[]', conflict_message, source_revision_id, inference_id, model_run_id, status, proposed_by, version, created_at, resolved_at, resolved_by_user_id
          FROM phase3_pending_patches_backup;

        CREATE INDEX idx_pending_patches_project_status
          ON pending_patches(project_id, status, created_at DESC, id DESC);
        CREATE INDEX idx_pending_patches_source_revision
          ON pending_patches(project_id, source_revision_id, status, created_at DESC);
        CREATE INDEX idx_pending_patches_target_fact
          ON pending_patches(project_id, target_fact_id, status);
        CREATE INDEX idx_pending_patches_target_state
          ON pending_patches(project_id, target_entity_id, operation, status);
        CREATE UNIQUE INDEX idx_pending_patches_semantic_input
          ON pending_patches(project_id, source_revision_id, input_fingerprint)
          WHERE input_fingerprint <> '';

        CREATE TABLE patch_evidence (
          project_id TEXT NOT NULL,
          patch_id TEXT NOT NULL,
          evidence_source_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (project_id, patch_id, evidence_source_id),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (patch_id) REFERENCES pending_patches(id) ON DELETE CASCADE,
          FOREIGN KEY (evidence_source_id) REFERENCES evidence_sources(id) ON DELETE RESTRICT
        );
        INSERT INTO patch_evidence (project_id, patch_id, evidence_source_id, created_at)
          SELECT project_id, patch_id, evidence_source_id, created_at FROM phase3_patch_evidence_backup;

        /* The result FK is declared before the application table is copied. */
        CREATE TABLE IF NOT EXISTS entity_states (
          id TEXT PRIMARY KEY NOT NULL,
          project_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          predicate TEXT NOT NULL CHECK (predicate IN ('wardrobe.current', 'state.injury', 'state.held_prop')),
          value_json TEXT NOT NULL,
          value_type TEXT NOT NULL CHECK (value_type IN ('string', 'entity_ref')),
          applies_at_scene_id TEXT NOT NULL,
          source_revision_id TEXT NOT NULL,
          continuity_group_id TEXT NOT NULL,
          carry_forward INTEGER NOT NULL DEFAULT 0 CHECK (carry_forward IN (0, 1)),
          priority INTEGER NOT NULL DEFAULT 100,
          valid_to_scene_id TEXT,
          source_id TEXT NOT NULL,
          truth_class TEXT NOT NULL DEFAULT 'canon' CHECK (truth_class = 'canon'),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'retracted')),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          created_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
          FOREIGN KEY (applies_at_scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
          FOREIGN KEY (source_revision_id) REFERENCES scene_revisions(id) ON DELETE CASCADE,
          FOREIGN KEY (continuity_group_id) REFERENCES continuity_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (valid_to_scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
          FOREIGN KEY (source_id) REFERENCES evidence_sources(id) ON DELETE RESTRICT
        );

        CREATE TABLE patch_applications (
          id TEXT PRIMARY KEY NOT NULL,
          project_id TEXT NOT NULL,
          patch_id TEXT NOT NULL,
          operation TEXT NOT NULL CHECK (operation IN ('add_fact', 'replace_fact', 'retract_fact', 'add_state')),
          resulting_fact_id TEXT,
          resulting_state_id TEXT,
          applied_payload_json TEXT NOT NULL DEFAULT '{}',
          request_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (patch_id) REFERENCES pending_patches(id) ON DELETE RESTRICT,
          FOREIGN KEY (resulting_fact_id) REFERENCES facts(id) ON DELETE SET NULL,
          FOREIGN KEY (resulting_state_id) REFERENCES entity_states(id) ON DELETE SET NULL,
          CHECK (
            (operation IN ('add_fact', 'replace_fact') AND resulting_fact_id IS NOT NULL AND resulting_state_id IS NULL)
            OR (operation = 'retract_fact' AND resulting_fact_id IS NOT NULL AND resulting_state_id IS NULL)
            OR (operation = 'add_state' AND resulting_fact_id IS NULL AND resulting_state_id IS NOT NULL)
          ),
          UNIQUE (project_id, patch_id)
        );
        INSERT INTO patch_applications (id, project_id, patch_id, operation, resulting_fact_id, resulting_state_id, applied_payload_json, request_id, created_at)
          SELECT id, project_id, patch_id, operation, resulting_fact_id, NULL, applied_payload_json, request_id, created_at FROM phase3_patch_applications_backup;
        CREATE UNIQUE INDEX idx_patch_applications_one_per_patch
          ON patch_applications(project_id, patch_id);
        DROP TABLE phase3_patch_applications_backup;
        DROP TABLE phase3_patch_evidence_backup;
        DROP TABLE phase3_pending_patches_backup;
      `);

      database.exec(`
        CREATE TABLE IF NOT EXISTS entity_states (
          id TEXT PRIMARY KEY NOT NULL,
          project_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          predicate TEXT NOT NULL CHECK (predicate IN ('wardrobe.current', 'state.injury', 'state.held_prop')),
          value_json TEXT NOT NULL,
          value_type TEXT NOT NULL CHECK (value_type IN ('string', 'entity_ref')),
          applies_at_scene_id TEXT NOT NULL,
          source_revision_id TEXT NOT NULL,
          continuity_group_id TEXT NOT NULL,
          carry_forward INTEGER NOT NULL DEFAULT 0 CHECK (carry_forward IN (0, 1)),
          priority INTEGER NOT NULL DEFAULT 100,
          valid_to_scene_id TEXT,
          source_id TEXT NOT NULL,
          truth_class TEXT NOT NULL DEFAULT 'canon' CHECK (truth_class = 'canon'),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'retracted')),
          version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
          created_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
          FOREIGN KEY (applies_at_scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
          FOREIGN KEY (source_revision_id) REFERENCES scene_revisions(id) ON DELETE CASCADE,
          FOREIGN KEY (continuity_group_id) REFERENCES continuity_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (valid_to_scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
          FOREIGN KEY (source_id) REFERENCES evidence_sources(id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_entity_states_resolution
          ON entity_states(project_id, entity_id, predicate, continuity_group_id, applies_at_scene_id, status, priority DESC, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_entity_states_source_revision
          ON entity_states(project_id, source_revision_id, created_at DESC, id DESC);
        DROP TRIGGER IF EXISTS entity_states_project_guard;
        CREATE TRIGGER IF NOT EXISTS entity_states_project_guard
        BEFORE INSERT ON entity_states
        WHEN (SELECT project_id FROM entities WHERE id = NEW.entity_id) IS NULL
          OR (SELECT project_id FROM entities WHERE id = NEW.entity_id) <> NEW.project_id
          OR (SELECT entity_type FROM entities WHERE id = NEW.entity_id) <> 'character'
          OR (SELECT status FROM entities WHERE id = NEW.entity_id) NOT IN ('active', 'draft')
          OR (SELECT merged_into_entity_id FROM entities WHERE id = NEW.entity_id) IS NOT NULL
          OR (SELECT project_id FROM scenes WHERE id = NEW.applies_at_scene_id) IS NULL
          OR (SELECT project_id FROM scenes WHERE id = NEW.applies_at_scene_id) <> NEW.project_id
          OR (SELECT project_id FROM scene_revisions WHERE id = NEW.source_revision_id) IS NULL
          OR (SELECT project_id FROM scene_revisions WHERE id = NEW.source_revision_id) <> NEW.project_id
          OR (SELECT scene_id FROM scene_revisions WHERE id = NEW.source_revision_id) <> NEW.applies_at_scene_id
          OR (SELECT continuity_group_id FROM scene_revisions WHERE id = NEW.source_revision_id) <> NEW.continuity_group_id
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) IS NULL
          OR (SELECT project_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> NEW.project_id
          OR (SELECT document_id FROM continuity_groups WHERE id = NEW.continuity_group_id) <> (SELECT document_id FROM scenes WHERE id = NEW.applies_at_scene_id)
          OR (SELECT project_id FROM evidence_sources WHERE id = NEW.source_id) IS NULL
          OR (SELECT project_id FROM evidence_sources WHERE id = NEW.source_id) <> NEW.project_id
          OR (SELECT scene_revision_id FROM evidence_sources WHERE id = NEW.source_id) IS NOT NEW.source_revision_id
          OR (NEW.carry_forward = 0 AND NEW.valid_to_scene_id IS NOT NULL)
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT project_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> NEW.project_id)
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT document_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> (SELECT document_id FROM scenes WHERE id = NEW.applies_at_scene_id))
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT continuity_group_id FROM scenes WHERE id = NEW.valid_to_scene_id) <> NEW.continuity_group_id)
          OR (NEW.valid_to_scene_id IS NOT NULL AND (SELECT narrative_rank FROM scenes WHERE id = NEW.valid_to_scene_id) < (SELECT narrative_rank FROM scenes WHERE id = NEW.applies_at_scene_id))
        BEGIN SELECT RAISE(ABORT, 'entity state project or range mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS entity_states_initial_status_version_guard
        BEFORE INSERT ON entity_states
        WHEN NEW.status <> 'active' OR NEW.version <> 1 OR NEW.truth_class <> 'canon'
        BEGIN SELECT RAISE(ABORT, 'entity state must start active at version 1 as Canon'); END;
        CREATE TRIGGER IF NOT EXISTS entity_states_value_guard
        BEFORE INSERT ON entity_states
        WHEN (NEW.predicate = 'state.held_prop' AND (NEW.value_type <> 'entity_ref' OR json_type(NEW.value_json) <> 'text'))
          OR (NEW.predicate IN ('wardrobe.current', 'state.injury') AND (NEW.value_type <> 'string' OR json_type(NEW.value_json) <> 'text'))
        BEGIN SELECT RAISE(ABORT, 'entity state value shape is invalid'); END;
        CREATE TRIGGER IF NOT EXISTS entity_states_entity_ref_project_guard
        BEFORE INSERT ON entity_states
        WHEN NEW.predicate = 'state.held_prop'
          AND ((SELECT project_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) IS NULL
            OR (SELECT project_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) <> NEW.project_id
            OR (SELECT entity_type FROM entities WHERE id = json_extract(NEW.value_json, '$')) <> 'prop'
            OR (SELECT status FROM entities WHERE id = json_extract(NEW.value_json, '$')) NOT IN ('active', 'draft')
            OR (SELECT merged_into_entity_id FROM entities WHERE id = json_extract(NEW.value_json, '$')) IS NOT NULL)
        BEGIN SELECT RAISE(ABORT, 'entity state reference project or status mismatch'); END;
        CREATE TRIGGER IF NOT EXISTS entity_states_immutable_guard
        BEFORE UPDATE OF id, project_id, entity_id, predicate, value_json, value_type, applies_at_scene_id, source_revision_id, continuity_group_id, carry_forward, priority, valid_to_scene_id, source_id, truth_class, created_at ON entity_states
        WHEN NOT (
          NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.entity_id IS OLD.entity_id
          AND NEW.predicate IS OLD.predicate AND NEW.value_json IS OLD.value_json AND NEW.value_type IS OLD.value_type
          AND NEW.applies_at_scene_id IS OLD.applies_at_scene_id AND NEW.source_revision_id IS OLD.source_revision_id
          AND NEW.continuity_group_id IS OLD.continuity_group_id AND NEW.carry_forward IS OLD.carry_forward
          AND NEW.priority IS OLD.priority AND NEW.valid_to_scene_id IS OLD.valid_to_scene_id
          AND NEW.source_id IS OLD.source_id AND NEW.truth_class IS OLD.truth_class AND NEW.created_at IS OLD.created_at
        )
        BEGIN SELECT RAISE(ABORT, 'entity state is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS entity_states_status_version_guard
        BEFORE UPDATE OF status, version ON entity_states
        WHEN NEW.version < OLD.version OR NEW.version > OLD.version + 1
          OR (NEW.status = OLD.status AND NEW.version <> OLD.version)
          OR (NEW.status <> OLD.status AND NEW.version <> OLD.version + 1)
          OR (OLD.status <> 'active' AND NEW.status <> OLD.status)
          OR NEW.status NOT IN ('active', 'superseded', 'retracted')
        BEGIN SELECT RAISE(ABORT, 'entity state status/version transition is invalid'); END;
      `);

      database.exec(`
        CREATE TRIGGER pending_patches_canon_truth_guard
        BEFORE INSERT ON pending_patches
        WHEN NEW.truth_class <> 'canon'
        BEGIN SELECT RAISE(ABORT, 'pending patch truth class must be canon'); END;
        CREATE TRIGGER pending_patches_shape_guard
        BEFORE INSERT ON pending_patches
        WHEN (NEW.operation = 'add_fact' AND (NEW.target_entity_id IS NULL OR NEW.target_fact_id IS NOT NULL OR NEW.base_version IS NULL))
          OR (NEW.operation = 'replace_fact' AND (NEW.target_entity_id IS NULL OR NEW.target_fact_id IS NULL OR NEW.base_version IS NULL))
          OR (NEW.operation = 'retract_fact' AND (NEW.target_fact_id IS NULL OR NEW.base_version IS NULL))
          OR (NEW.operation = 'add_state' AND (NEW.target_entity_id IS NULL OR NEW.target_fact_id IS NOT NULL OR NEW.base_version IS NULL OR NEW.inference_id IS NOT NULL OR NEW.model_run_id IS NOT NULL OR NEW.proposed_by <> 'user'))
          OR (NEW.operation = 'add_state' AND (SELECT project_id FROM entities WHERE id = NEW.target_entity_id) <> NEW.project_id)
          OR (NEW.operation = 'add_state' AND NOT EXISTS (SELECT 1 FROM entities WHERE id = NEW.target_entity_id AND project_id = NEW.project_id AND entity_type = 'character' AND status IN ('active', 'draft') AND merged_into_entity_id IS NULL))
        BEGIN SELECT RAISE(ABORT, 'pending patch command shape is invalid'); END;
        CREATE TRIGGER pending_patches_project_guard
        BEFORE INSERT ON pending_patches
        WHEN (SELECT project_id FROM scene_revisions WHERE id = NEW.source_revision_id) IS NULL
          OR (SELECT project_id FROM scene_revisions WHERE id = NEW.source_revision_id) <> NEW.project_id
          OR (NEW.target_entity_id IS NOT NULL AND ((SELECT project_id FROM entities WHERE id = NEW.target_entity_id) IS NULL OR (SELECT project_id FROM entities WHERE id = NEW.target_entity_id) <> NEW.project_id))
          OR (NEW.target_fact_id IS NOT NULL AND ((SELECT project_id FROM facts WHERE id = NEW.target_fact_id) IS NULL OR (SELECT project_id FROM facts WHERE id = NEW.target_fact_id) <> NEW.project_id))
          OR (NEW.inference_id IS NOT NULL AND ((SELECT project_id FROM inferences WHERE id = NEW.inference_id) IS NULL OR (SELECT project_id FROM inferences WHERE id = NEW.inference_id) <> NEW.project_id))
          OR (NEW.model_run_id IS NOT NULL AND ((SELECT project_id FROM model_runs WHERE id = NEW.model_run_id) IS NULL OR (SELECT project_id FROM model_runs WHERE id = NEW.model_run_id) <> NEW.project_id))
        BEGIN SELECT RAISE(ABORT, 'pending patch project mismatch'); END;
        CREATE TRIGGER pending_patches_initial_status_version_guard
        BEFORE INSERT ON pending_patches
        WHEN NEW.status <> 'pending' OR NEW.version <> 1
        BEGIN SELECT RAISE(ABORT, 'pending patch must start pending at version 1'); END;
        CREATE TRIGGER pending_patches_immutable_guard
        BEFORE UPDATE OF id, project_id, operation, target_entity_id, target_fact_id, base_version, payload_json, input_fingerprint, truth_class, confidence, conflict_kind, conflicting_fact_ids_json, conflicting_state_ids_json, conflict_message, source_revision_id, inference_id, model_run_id, proposed_by, created_at ON pending_patches
        WHEN NOT (
          NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.operation IS OLD.operation
          AND NEW.target_entity_id IS OLD.target_entity_id AND NEW.target_fact_id IS OLD.target_fact_id
          AND NEW.base_version IS OLD.base_version AND NEW.payload_json IS OLD.payload_json
          AND NEW.input_fingerprint IS OLD.input_fingerprint AND NEW.truth_class IS OLD.truth_class
          AND NEW.confidence IS OLD.confidence AND NEW.conflict_kind IS OLD.conflict_kind
          AND NEW.conflicting_fact_ids_json IS OLD.conflicting_fact_ids_json AND NEW.conflicting_state_ids_json IS OLD.conflicting_state_ids_json
          AND NEW.conflict_message IS OLD.conflict_message AND NEW.source_revision_id IS OLD.source_revision_id
          AND NEW.inference_id IS OLD.inference_id AND NEW.model_run_id IS OLD.model_run_id
          AND NEW.proposed_by IS OLD.proposed_by AND NEW.created_at IS OLD.created_at
        )
        BEGIN SELECT RAISE(ABORT, 'pending patch payload/provenance is immutable'); END;
        CREATE TRIGGER pending_patches_status_version_guard
        BEFORE UPDATE OF status, version ON pending_patches
        WHEN NEW.version < OLD.version OR NEW.version > OLD.version + 1
          OR (NEW.status = OLD.status AND NEW.version <> OLD.version)
          OR (NEW.status <> OLD.status AND NEW.version <> OLD.version + 1)
          OR (OLD.status <> 'pending' AND NEW.status <> OLD.status)
          OR NEW.status NOT IN ('pending', 'accepted', 'rejected', 'expired', 'superseded')
        BEGIN SELECT RAISE(ABORT, 'pending patch status/version transition is invalid'); END;
        CREATE TRIGGER patch_evidence_project_guard
        BEFORE INSERT ON patch_evidence
        WHEN (SELECT project_id FROM pending_patches WHERE id = NEW.patch_id) IS NULL
          OR (SELECT project_id FROM pending_patches WHERE id = NEW.patch_id) <> NEW.project_id
          OR (SELECT project_id FROM evidence_sources WHERE id = NEW.evidence_source_id) IS NULL
          OR (SELECT project_id FROM evidence_sources WHERE id = NEW.evidence_source_id) <> NEW.project_id
        BEGIN SELECT RAISE(ABORT, 'patch evidence project mismatch'); END;
        CREATE TRIGGER patch_evidence_immutable_guard
        BEFORE UPDATE OF project_id, patch_id, evidence_source_id, created_at ON patch_evidence
        WHEN NOT (NEW.project_id IS OLD.project_id AND NEW.patch_id IS OLD.patch_id AND NEW.evidence_source_id IS OLD.evidence_source_id AND NEW.created_at IS OLD.created_at)
        BEGIN SELECT RAISE(ABORT, 'patch evidence is immutable'); END;
        CREATE TRIGGER patch_application_project_guard
        BEFORE INSERT ON patch_applications
        WHEN (SELECT project_id FROM pending_patches WHERE id = NEW.patch_id) IS NULL
          OR (SELECT project_id FROM pending_patches WHERE id = NEW.patch_id) <> NEW.project_id
          OR (NEW.resulting_fact_id IS NOT NULL AND ((SELECT project_id FROM facts WHERE id = NEW.resulting_fact_id) IS NULL OR (SELECT project_id FROM facts WHERE id = NEW.resulting_fact_id) <> NEW.project_id))
          OR (NEW.resulting_state_id IS NOT NULL AND ((SELECT project_id FROM entity_states WHERE id = NEW.resulting_state_id) IS NULL OR (SELECT project_id FROM entity_states WHERE id = NEW.resulting_state_id) <> NEW.project_id))
        BEGIN SELECT RAISE(ABORT, 'patch application project mismatch'); END;
        CREATE TRIGGER patch_application_operation_guard
        BEFORE INSERT ON patch_applications
        WHEN (SELECT operation FROM pending_patches WHERE id = NEW.patch_id) IS NULL
          OR (SELECT operation FROM pending_patches WHERE id = NEW.patch_id) <> NEW.operation
          OR (NEW.operation IN ('add_fact', 'replace_fact') AND (NEW.resulting_fact_id IS NULL OR NEW.resulting_state_id IS NOT NULL))
          OR (NEW.operation = 'retract_fact' AND (NEW.resulting_fact_id <> (SELECT target_fact_id FROM pending_patches WHERE id = NEW.patch_id) OR NEW.resulting_state_id IS NOT NULL))
          OR (NEW.operation = 'add_state' AND (NEW.resulting_state_id IS NULL OR NEW.resulting_fact_id IS NOT NULL))
        BEGIN SELECT RAISE(ABORT, 'patch application operation/result mismatch'); END;
        CREATE TRIGGER patch_application_immutable_guard
        BEFORE UPDATE OF id, project_id, patch_id, operation, resulting_fact_id, resulting_state_id, applied_payload_json, request_id, created_at ON patch_applications
        WHEN NOT (NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.patch_id IS OLD.patch_id AND NEW.operation IS OLD.operation
          AND NEW.resulting_fact_id IS OLD.resulting_fact_id AND NEW.resulting_state_id IS OLD.resulting_state_id
          AND NEW.applied_payload_json IS OLD.applied_payload_json AND NEW.request_id IS OLD.request_id AND NEW.created_at IS OLD.created_at)
        BEGIN SELECT RAISE(ABORT, 'patch application is immutable'); END;
      `);

      /* A status transition can be forged only if all durable provenance is
       * forged as well. This guard checks the actual resulting Fact/State,
       * its evidence, source revision, model fence, and domain events. */
      database.exec(`
        CREATE TRIGGER pending_patches_accepted_application_guard
        BEFORE UPDATE OF status ON pending_patches
        WHEN NEW.status = 'accepted'
          AND (
            NOT EXISTS (
              SELECT 1 FROM patch_applications pa
              WHERE pa.project_id = NEW.project_id AND pa.patch_id = NEW.id AND pa.operation = NEW.operation
                AND ((NEW.operation IN ('add_fact', 'replace_fact') AND pa.resulting_fact_id IS NOT NULL AND pa.resulting_state_id IS NULL)
                  OR (NEW.operation = 'retract_fact' AND pa.resulting_fact_id = NEW.target_fact_id AND pa.resulting_state_id IS NULL)
                  OR (NEW.operation = 'add_state' AND pa.resulting_state_id IS NOT NULL AND pa.resulting_fact_id IS NULL))
                AND EXISTS (SELECT 1 FROM audit_events ae WHERE ae.project_id = pa.project_id AND ae.aggregate_id = NEW.id AND ae.event_type = 'patch.accepted' AND ae.request_id = pa.request_id)
                AND EXISTS (SELECT 1 FROM audit_events ae WHERE ae.project_id = pa.project_id AND ae.aggregate_id = NEW.id AND ae.event_type = 'story_bible.changed' AND ae.request_id = pa.request_id)
                AND EXISTS (SELECT 1 FROM outbox_events oe WHERE oe.project_id = pa.project_id AND oe.aggregate_id = NEW.id AND oe.event_type = 'patch.accepted' AND oe.request_id = pa.request_id)
                AND EXISTS (SELECT 1 FROM outbox_events oe WHERE oe.project_id = pa.project_id AND oe.aggregate_id = NEW.id AND oe.event_type = 'story_bible.changed' AND oe.request_id = pa.request_id)
            )
            OR NOT EXISTS (
              SELECT 1 FROM scene_revisions sr JOIN script_documents d ON d.id = sr.document_id AND d.project_id = sr.project_id
              WHERE sr.id = NEW.source_revision_id AND sr.project_id = NEW.project_id AND d.current_revision_id = sr.document_revision_id
                AND (NEW.operation = 'retract_fact' OR sr.status = 'active')
            )
            OR (NEW.operation = 'add_state' AND (NEW.truth_class <> 'canon' OR NEW.inference_id IS NOT NULL OR NEW.model_run_id IS NOT NULL OR NEW.proposed_by <> 'user'))
            OR (NEW.model_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM model_runs mr WHERE mr.id = NEW.model_run_id AND mr.project_id = NEW.project_id AND mr.status = 'succeeded' AND mr.source_revision_id = NEW.source_revision_id))
            OR EXISTS (
              SELECT 1 FROM patch_evidence pe JOIN evidence_sources es ON es.id = pe.evidence_source_id AND es.project_id = pe.project_id
              WHERE pe.project_id = NEW.project_id AND pe.patch_id = NEW.id
                AND (es.scene_revision_id IS NOT NEW.source_revision_id OR es.model_run_id IS NOT NEW.model_run_id)
            )
            OR (NEW.operation = 'add_state' AND NOT EXISTS (
              SELECT 1
              FROM patch_applications pa JOIN entity_states es ON es.id = pa.resulting_state_id AND es.project_id = NEW.project_id
              WHERE pa.project_id = NEW.project_id AND pa.patch_id = NEW.id AND pa.operation = 'add_state'
                AND es.status = 'active' AND es.entity_id = NEW.target_entity_id
                AND EXISTS (SELECT 1 FROM entities e WHERE e.id = es.entity_id AND e.project_id = NEW.project_id AND e.entity_type = 'character' AND e.status IN ('active', 'draft') AND e.merged_into_entity_id IS NULL)
                AND json_extract(pa.applied_payload_json, '$.subjectEntityId') = NEW.target_entity_id
                AND json_extract(pa.applied_payload_json, '$.subjectEntityId') = json_extract(NEW.payload_json, '$.subjectEntityId')
                AND json_extract(pa.applied_payload_json, '$.predicate') = json_extract(NEW.payload_json, '$.predicate')
                AND json_extract(pa.applied_payload_json, '$.valueType') = json_extract(NEW.payload_json, '$.valueType')
                AND json_extract(pa.applied_payload_json, '$.appliesAtSceneId') = json_extract(NEW.payload_json, '$.appliesAtSceneId')
                AND json_extract(pa.applied_payload_json, '$.validToSceneId') IS json_extract(NEW.payload_json, '$.validToSceneId')
                AND json_extract(pa.applied_payload_json, '$.continuityGroupId') = json_extract(NEW.payload_json, '$.continuityGroupId')
                AND json_extract(pa.applied_payload_json, '$.carryForward') = json_extract(NEW.payload_json, '$.carryForward')
                AND json_extract(pa.applied_payload_json, '$.priority') = json_extract(NEW.payload_json, '$.priority')
                AND es.predicate = json_extract(pa.applied_payload_json, '$.predicate')
                AND es.value_type = json_extract(pa.applied_payload_json, '$.valueType')
                AND es.value_json = json(pa.applied_payload_json -> '$.value')
                AND es.applies_at_scene_id = json_extract(pa.applied_payload_json, '$.appliesAtSceneId')
                AND es.source_revision_id = NEW.source_revision_id
                AND es.continuity_group_id = json_extract(pa.applied_payload_json, '$.continuityGroupId')
                AND es.carry_forward = json_extract(pa.applied_payload_json, '$.carryForward')
                AND es.priority = json_extract(pa.applied_payload_json, '$.priority')
                AND es.valid_to_scene_id IS json_extract(pa.applied_payload_json, '$.validToSceneId')
                AND EXISTS (
                  SELECT 1 FROM patch_evidence pe JOIN evidence_sources ev ON ev.id = pe.evidence_source_id
                  WHERE pe.project_id = NEW.project_id AND pe.patch_id = NEW.id AND ev.id = es.source_id
                    AND ev.scene_revision_id = NEW.source_revision_id AND ev.model_run_id IS NULL
                )
                AND EXISTS (SELECT 1 FROM entities e WHERE e.id = NEW.target_entity_id AND e.project_id = NEW.project_id AND e.version = NEW.base_version)
            ))
            OR (NEW.operation = 'add_state' AND EXISTS (
              SELECT 1 FROM patch_applications pa JOIN entity_states es ON es.id = pa.resulting_state_id
              WHERE pa.project_id = NEW.project_id AND pa.patch_id = NEW.id AND es.entity_id = NEW.target_entity_id
                AND (es.predicate <> json_extract(pa.applied_payload_json, '$.predicate') OR es.value_json <> json(pa.applied_payload_json -> '$.value'))
            ))
          )
        BEGIN SELECT RAISE(ABORT, 'accepted patch result does not match Canon provenance'); END;
      `);

      /* Re-install the complete Phase 2 Canon-result fence after the
       * pending_patches CHECK-table rebuild. State commands are guarded by
       * the add_state-specific trigger above; these clauses preserve the
       * v11 Fact/Inference lifecycle and supersede invariants verbatim. */
      database.exec(`
        CREATE TRIGGER IF NOT EXISTS pending_patches_accepted_fact_provenance_guard
        BEFORE UPDATE OF status ON pending_patches
        WHEN NEW.status = 'accepted' AND NEW.operation <> 'add_state'
          AND (
            NOT EXISTS (
              SELECT 1 FROM scene_revisions sr JOIN script_documents d ON d.id = sr.document_id AND d.project_id = sr.project_id
              WHERE sr.id = NEW.source_revision_id AND sr.project_id = NEW.project_id AND d.current_revision_id = sr.document_revision_id
                AND (NEW.operation = 'retract_fact' OR sr.status = 'active')
            )
            OR (NEW.operation = 'retract_fact' AND NEW.inference_id IS NOT NULL)
            OR (NEW.inference_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM inferences i WHERE i.id = NEW.inference_id AND i.project_id = NEW.project_id
                AND i.model_run_id = NEW.model_run_id AND i.status = 'promoted'
            ))
            OR (
              NEW.operation IN ('add_fact', 'replace_fact')
              AND NOT EXISTS (
                SELECT 1 FROM patch_applications pa JOIN facts f ON f.id = pa.resulting_fact_id AND f.project_id = NEW.project_id
                WHERE pa.project_id = NEW.project_id AND pa.patch_id = NEW.id AND pa.operation = NEW.operation
                  AND f.status = 'active' AND f.truth_class = 'canon'
                  AND f.subject_entity_id = NEW.target_entity_id
                  AND json_extract(pa.applied_payload_json, '$.subjectEntityId') = NEW.target_entity_id
                  AND f.predicate = json_extract(pa.applied_payload_json, '$.predicate')
                  AND f.value_type = json_extract(pa.applied_payload_json, '$.valueType')
                  AND f.value_json = json(pa.applied_payload_json -> '$.value')
                  AND f.scope = json_extract(pa.applied_payload_json, '$.scope')
                  AND f.scene_id IS json_extract(pa.applied_payload_json, '$.sceneId')
                  AND f.valid_from_scene_id IS json_extract(pa.applied_payload_json, '$.validFromSceneId')
                  AND f.valid_to_scene_id IS json_extract(pa.applied_payload_json, '$.validToSceneId')
                  AND f.promoted_from_inference_id IS NEW.inference_id
                  AND (NEW.inference_id IS NULL OR EXISTS (
                    SELECT 1 FROM inferences i WHERE i.id = NEW.inference_id AND i.project_id = NEW.project_id
                      AND i.model_run_id = NEW.model_run_id AND i.subject_entity_id = f.subject_entity_id
                      AND i.predicate = f.predicate AND i.value_type = f.value_type AND i.scope = f.scope
                      AND i.scene_id IS f.scene_id AND i.valid_from_scene_id IS f.valid_from_scene_id AND i.valid_to_scene_id IS f.valid_to_scene_id
                  ))
                  AND (NEW.inference_id IS NULL OR (
                    EXISTS (SELECT 1 FROM inference_evidence ie JOIN patch_evidence pe ON pe.project_id = ie.project_id AND pe.patch_id = NEW.id AND pe.evidence_source_id = ie.evidence_source_id WHERE ie.project_id = NEW.project_id AND ie.inference_id = NEW.inference_id)
                    AND NOT EXISTS (SELECT 1 FROM inference_evidence ie WHERE ie.project_id = NEW.project_id AND ie.inference_id = NEW.inference_id AND NOT EXISTS (SELECT 1 FROM patch_evidence pe WHERE pe.project_id = NEW.project_id AND pe.patch_id = NEW.id AND pe.evidence_source_id = ie.evidence_source_id))
                  ))
                  AND EXISTS (
                    SELECT 1 FROM patch_evidence pe JOIN evidence_sources es ON es.id = pe.evidence_source_id AND es.project_id = pe.project_id
                    WHERE pe.project_id = NEW.project_id AND pe.patch_id = NEW.id AND es.id = f.source_id
                      AND es.scene_revision_id = NEW.source_revision_id AND (NEW.model_run_id IS NULL OR es.model_run_id = NEW.model_run_id)
                  )
                  AND (
                    (NEW.operation = 'add_fact' AND NEW.target_fact_id IS NULL AND f.supersedes_fact_id IS NULL
                      AND EXISTS (SELECT 1 FROM entities e WHERE e.id = NEW.target_entity_id AND e.project_id = NEW.project_id AND e.version = NEW.base_version))
                    OR (NEW.operation = 'replace_fact' AND f.supersedes_fact_id = NEW.target_fact_id
                      AND EXISTS (SELECT 1 FROM facts previous WHERE previous.id = NEW.target_fact_id AND previous.project_id = NEW.project_id AND previous.status = 'superseded' AND previous.version = NEW.base_version + 1 AND previous.subject_entity_id = f.subject_entity_id AND previous.predicate = f.predicate AND previous.scope = f.scope AND previous.scene_id IS f.scene_id AND previous.valid_from_scene_id IS f.valid_from_scene_id AND previous.valid_to_scene_id IS f.valid_to_scene_id))
                  )
              )
            )
            OR (
              NEW.operation = 'retract_fact' AND NOT EXISTS (
                SELECT 1 FROM patch_applications pa JOIN facts f ON f.id = pa.resulting_fact_id AND f.project_id = NEW.project_id
                WHERE pa.project_id = NEW.project_id AND pa.patch_id = NEW.id AND pa.operation = 'retract_fact' AND pa.resulting_fact_id = NEW.target_fact_id
                  AND json(pa.applied_payload_json) = '{}' AND f.status = 'retracted' AND f.truth_class = 'canon' AND f.version = NEW.base_version + 1
                  AND EXISTS (SELECT 1 FROM patch_evidence pe JOIN evidence_sources es ON es.id = pe.evidence_source_id AND es.project_id = pe.project_id WHERE pe.project_id = NEW.project_id AND pe.patch_id = NEW.id AND es.scene_revision_id = NEW.source_revision_id AND (NEW.model_run_id IS NULL OR es.model_run_id = NEW.model_run_id))
              )
            )
          )
        BEGIN SELECT RAISE(ABORT, 'accepted patch result does not match Canon provenance'); END;

        CREATE TRIGGER IF NOT EXISTS pending_patches_accepted_model_provenance_guard
        BEFORE UPDATE OF status ON pending_patches
        WHEN NEW.status = 'accepted'
          AND (
            (NEW.model_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM model_runs mr WHERE mr.id = NEW.model_run_id AND mr.project_id = NEW.project_id AND mr.status = 'succeeded' AND mr.source_revision_id = NEW.source_revision_id))
            OR EXISTS (SELECT 1 FROM patch_evidence pe JOIN evidence_sources es ON es.id = pe.evidence_source_id AND es.project_id = pe.project_id WHERE pe.project_id = NEW.project_id AND pe.patch_id = NEW.id AND (es.scene_revision_id IS NOT NEW.source_revision_id OR es.model_run_id IS NOT NEW.model_run_id))
            OR (NEW.inference_id IS NOT NULL AND EXISTS (SELECT 1 FROM inference_evidence ie JOIN evidence_sources es ON es.id = ie.evidence_source_id AND es.project_id = ie.project_id WHERE ie.project_id = NEW.project_id AND ie.inference_id = NEW.inference_id AND (es.scene_revision_id IS NOT NEW.source_revision_id OR es.model_run_id IS NOT NEW.model_run_id)))
          )
        BEGIN SELECT RAISE(ABORT, 'accepted patch model/evidence provenance is invalid'); END;
      `);
    });
  }
}
