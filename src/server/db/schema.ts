import type { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 4;

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
}
