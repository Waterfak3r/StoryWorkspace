import { defineConfig, devices } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const webPort = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT ?? "43140", 10);
const fakeProviderPort = Number.parseInt(process.env.PLAYWRIGHT_FAKE_OPENAI_PORT ?? "43141", 10);
const databasePath = resolve(process.env.PLAYWRIGHT_DB_PATH ?? ".tmp/playwright/story-workspace.db");
const workspaceRoot = resolve(process.env.PLAYWRIGHT_WORKSPACE_ROOT ?? ".tmp/playwright/projects");
const protectedDatabasePaths = [
  resolve(".data/story-workspace.db"),
  resolve("story-workspace.db"),
];
const applicationDataRoot = resolve(".data");
const defaultWorkspaceRoot = resolve(".data/projects");

function isSameOrInside(candidate: string, root: string) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

if (protectedDatabasePaths.includes(databasePath)) {
  throw new Error("PLAYWRIGHT_DB_PATH points at a non-isolated application database. Choose a disposable test path.");
}

if (workspaceRoot === resolve(".") || isSameOrInside(workspaceRoot, applicationDataRoot) || workspaceRoot === defaultWorkspaceRoot) {
  throw new Error("PLAYWRIGHT_WORKSPACE_ROOT points at a non-isolated workspace directory. Choose a disposable test path.");
}

mkdirSync(dirname(databasePath), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${databasePath}${suffix}`, { force: true });
}

rmSync(workspaceRoot, { recursive: true, force: true });
mkdirSync(workspaceRoot, { recursive: true });

const appEnvironment = {
  ...process.env,
  STORY_WORKSPACE_ROOT: workspaceRoot,
  STORY_WORKSPACE_DB_PATH: databasePath,
  AI_BASE_URL: `http://127.0.0.1:${fakeProviderPort}/v1`,
  AI_API_KEY: process.env.PLAYWRIGHT_AI_API_KEY ?? "playwright-local-key",
  AI_MODEL: process.env.PLAYWRIGHT_AI_MODEL ?? "playwright-fake-model",
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["studio-workspace.spec.ts", "i18n.spec.ts"],
  testIgnore: ["mvp.spec.ts", "phase*.spec.ts"],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: `node e2e/fake-openai.mjs`,
      url: `http://127.0.0.1:${fakeProviderPort}/v1/responses`,
      env: {
        FAKE_OPENAI_PORT: String(fakeProviderPort),
      },
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: `npm run start -- -p ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      env: appEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
