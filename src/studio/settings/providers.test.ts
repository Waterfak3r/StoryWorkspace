import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { GET as getProviders, PUT as putProviders } from "@/app/api/studio/settings/providers/route";
import { POST as postProject } from "@/app/api/studio/projects/route";
import { createProject, getWorkspaceRoot } from "../fs";
import {
  getProviderSettingsPath,
  readProviderSettings,
  resolveTextProvider,
  writeProviderSettings,
} from "./providers";

const ENV_KEYS = [
  "STORY_WORKSPACE_ROOT",
  "STORY_WORKSPACE_DB_PATH",
  "STORY_USER_CONFIG",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "IMAGE_BASE_URL",
  "IMAGE_API_KEY",
  "IMAGE_MODEL",
  "IMAGE_SIZE",
] as const;

const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
  (typeof ENV_KEYS)[number],
  string | undefined
>;

const TEXT_KEY = "sk-user-text-abcd";
const IMAGE_KEY = "sk-user-image-efgh";

let workspaceRoot = "";
let userConfigDir = "";
let userConfigPath = "";

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "studio-settings-ws-"));
  userConfigDir = mkdtempSync(path.join(tmpdir(), "studio-settings-user-"));
  userConfigPath = path.join(userConfigDir, "providers.json");
  process.env.STORY_WORKSPACE_ROOT = workspaceRoot;
  process.env.STORY_USER_CONFIG = userConfigPath;
  delete process.env.STORY_WORKSPACE_DB_PATH;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.IMAGE_BASE_URL;
  delete process.env.IMAGE_API_KEY;
  delete process.env.IMAGE_MODEL;
  delete process.env.IMAGE_SIZE;
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(userConfigDir, { recursive: true, force: true });

  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

describe("user provider settings", () => {
  it("PUT stores a key, GET hides it, and the file stays outside the project", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    const project = createProject({ title: "Harbor Night" });

    const put = await putProviders(
      jsonRequest("http://localhost/api/studio/settings/providers", "PUT", {
        text: { baseUrl: "https://user.example/v1", model: "user-text-model", apiKey: TEXT_KEY },
        image: { baseUrl: "https://image.example/v1", model: "user-image-model", size: "512x512", apiKey: IMAGE_KEY },
      }),
    );
    const putBody = await put.json();

    expect(put.status).toBe(200);
    expect(putBody.data.text).toMatchObject({
      baseUrl: "https://user.example/v1",
      model: "user-text-model",
      apiKeyConfigured: true,
      apiKeyHint: "••••abcd",
      source: "user",
    });
    expect(putBody.data.image).toMatchObject({
      baseUrl: "https://image.example/v1",
      model: "user-image-model",
      size: "512x512",
      apiKeyConfigured: true,
      apiKeyHint: "••••efgh",
      source: "user",
    });
    expect(putBody.data.text).not.toHaveProperty("apiKey");
    expect(putBody.data.image).not.toHaveProperty("apiKey");
    expect(JSON.stringify(putBody)).not.toContain(TEXT_KEY);
    expect(JSON.stringify(putBody)).not.toContain(IMAGE_KEY);

    const get = await getProviders();
    const getBody = await get.json();
    expect(get.status).toBe(200);
    expect(getBody.data.text.apiKeyConfigured).toBe(true);
    expect(getBody.data.image.apiKeyConfigured).toBe(true);
    expect(getBody.data.text).not.toHaveProperty("apiKey");
    expect(JSON.stringify(getBody)).not.toContain(TEXT_KEY);
    expect(JSON.stringify(getBody)).not.toContain(IMAGE_KEY);

    expect(getProviderSettingsPath()).toBe(userConfigPath);
    expect(existsSync(userConfigPath)).toBe(true);
    const stored = JSON.parse(readFileSync(userConfigPath, "utf8")) as { text: { apiKey: string } };
    expect(stored.text.apiKey).toBe(TEXT_KEY);

    const kept = await putProviders(
      jsonRequest("http://localhost/api/studio/settings/providers", "PUT", {
        text: { model: "user-text-model-2", apiKey: "" },
      }),
    );
    expect(kept.status).toBe(200);
    expect(readProviderSettings().text.apiKey).toBe(TEXT_KEY);
    expect(readProviderSettings().text.model).toBe("user-text-model-2");
    expect(isInsideDir(path.join(getWorkspaceRoot(), project.id), userConfigPath)).toBe(false);
    expect(userConfigPath.includes(`${path.sep}${project.id}${path.sep}`)).toBe(false);
  });

  it("resolves user text config over env after PUT", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    process.env.AI_BASE_URL = "https://env.example/v1";
    process.env.AI_API_KEY = "sk-env-key-zzzz";
    process.env.AI_MODEL = "env-model";

    const put = await putProviders(
      jsonRequest("http://localhost/api/studio/settings/providers", "PUT", {
        text: { baseUrl: "https://user.example/v1", model: "user-model", apiKey: TEXT_KEY },
      }),
    );
    expect(put.status).toBe(200);

    const resolved = resolveTextProvider();
    expect(resolved).toEqual({
      baseUrl: "https://user.example/v1",
      apiKey: TEXT_KEY,
      model: "user-model",
      protocol: "auto",
    });
    expect(readProviderSettings().text).toEqual({
      baseUrl: "https://user.example/v1",
      apiKey: TEXT_KEY,
      model: "user-model",
      protocol: "auto",
    });
  });

  it("clearApiKey wipes the stored key when env is unset", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    expect(process.env.AI_API_KEY).toBeUndefined();
    expect(process.env.IMAGE_API_KEY).toBeUndefined();

    const stored = await putProviders(
      jsonRequest("http://localhost/api/studio/settings/providers", "PUT", {
        text: { apiKey: TEXT_KEY },
      }),
    );
    expect((await stored.json()).data.text.apiKeyConfigured).toBe(true);

    const cleared = await putProviders(
      jsonRequest("http://localhost/api/studio/settings/providers", "PUT", {
        text: { clearApiKey: true },
      }),
    );
    const clearedBody = await cleared.json();
    expect(cleared.status).toBe(200);
    expect(clearedBody.data.text.apiKeyConfigured).toBe(false);
    expect(clearedBody.data.text.source).toBe("default");
    expect(clearedBody.data.text.apiKeyHint).toBe("");
    expect(readProviderSettings().text.apiKey).toBe("");

    const get = await getProviders();
    const getBody = await get.json();
    expect(getBody.data.text.apiKeyConfigured).toBe(false);
    expect(JSON.stringify(getBody)).not.toContain(TEXT_KEY);
  });

  it("does not write the saved key into project JSON files", async () => {
    expect(process.env.STORY_WORKSPACE_DB_PATH).toBeUndefined();
    const created = await postProject(jsonRequest("http://localhost/api/studio/projects", "POST", { title: "Harbor Night" }));
    expect(created.status).toBe(201);
    const projectDir = path.join(getWorkspaceRoot(), "harbor-night");

    const put = await putProviders(
      jsonRequest("http://localhost/api/studio/settings/providers", "PUT", {
        text: { apiKey: TEXT_KEY, model: "user-model" },
        image: { apiKey: IMAGE_KEY, model: "user-image" },
      }),
    );
    expect(put.status).toBe(200);
    writeProviderSettings(readProviderSettings());

    for (const file of listJsonFiles(projectDir)) {
      const raw = readFileSync(file, "utf8");
      expect(raw).not.toContain(TEXT_KEY);
      expect(raw).not.toContain(IMAGE_KEY);
      expect(raw).not.toMatch(/sk-/);
    }
    expect(existsSync(path.join(projectDir, "config", "providers.json"))).toBe(false);
    expect(isInsideDir(projectDir, userConfigPath)).toBe(false);
  });
});

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function isInsideDir(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function listJsonFiles(dir: string): string[] {
  const names = readdirSync(dir);
  const out: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listJsonFiles(full));
    } else if (name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}
