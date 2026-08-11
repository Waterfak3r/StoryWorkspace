import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bootstrapDatabase } from "./schema";

type DatabaseState = {
  database: DatabaseSync;
  filePath: string;
};

const globalDatabase = globalThis as typeof globalThis & {
  __storyWorkspaceDatabase?: DatabaseState;
};

export function getDatabasePath() {
  return resolve(/* turbopackIgnore: true */ process.env.STORY_WORKSPACE_DB_PATH ?? join(process.cwd(), ".data", "story-workspace.db"));
}

export function createDatabase(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  bootstrapDatabase(database);
  return database;
}

export function getDatabase() {
  const filePath = getDatabasePath();
  const current = globalDatabase.__storyWorkspaceDatabase;

  if (current?.filePath === filePath) {
    return current.database;
  }

  if (current) {
    current.database.close();
  }

  const database = createDatabase(filePath);
  globalDatabase.__storyWorkspaceDatabase = { database, filePath };

  return database;
}

export function closeDatabase() {
  const current = globalDatabase.__storyWorkspaceDatabase;
  if (!current) {
    return;
  }

  current.database.close();
  delete globalDatabase.__storyWorkspaceDatabase;
}
