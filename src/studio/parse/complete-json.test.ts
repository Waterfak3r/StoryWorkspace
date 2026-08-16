import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

import { writeProviderSettings } from "../settings";
import { completeJsonWithFetch, prefersChatCompletions } from "./complete-json";

const previousUserConfig = process.env.STORY_USER_CONFIG;
const previousAiKey = process.env.AI_API_KEY;
const previousAiModel = process.env.AI_MODEL;
const previousAiBase = process.env.AI_BASE_URL;
const previousAiProtocol = process.env.AI_PROTOCOL;

const proposal = {
  proposedScenes: [
    {
      key: "scene-a",
      title: "Harbor watch",
      script: "Jill waits.",
      intent: "Night.",
      characterNames: ["Jill"],
      locationName: "Harbor",
    },
  ],
  proposedEntities: [{ key: "ent-jill", kind: "character", name: "Jill", description: "Lookout" }],
};

const proposalSchema = z.object({
  proposedScenes: z.array(z.unknown()),
  proposedEntities: z.array(z.unknown()),
});

let userConfigDir = "";

beforeEach(() => {
  userConfigDir = mkdtempSync(path.join(tmpdir(), "studio-complete-json-"));
  process.env.STORY_USER_CONFIG = path.join(userConfigDir, "providers.json");
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_PROTOCOL;
  writeProviderSettings({
    text: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test-ocgo", model: "glm-5.3", protocol: "auto" },
    image: { baseUrl: "", apiKey: "", model: "", size: "" },
  });
});

afterEach(() => {
  rmSync(userConfigDir, { recursive: true, force: true });
  restoreEnv("STORY_USER_CONFIG", previousUserConfig);
  restoreEnv("AI_API_KEY", previousAiKey);
  restoreEnv("AI_MODEL", previousAiModel);
  restoreEnv("AI_BASE_URL", previousAiBase);
  restoreEnv("AI_PROTOCOL", previousAiProtocol);
});

describe("prefersChatCompletions", () => {
  it("uses chat for OpenCode Go in auto mode", () => {
    expect(prefersChatCompletions("https://opencode.ai/zen/go/v1", "auto")).toBe(true);
    expect(prefersChatCompletions("https://api.openai.com/v1", "auto")).toBe(false);
    expect(prefersChatCompletions("https://api.openai.com/v1", "chat")).toBe(true);
    expect(prefersChatCompletions("https://opencode.ai/zen/go/v1", "responses")).toBe(false);
  });
});

describe("completeJsonWithFetch", () => {
  it("posts chat/completions for OpenCode Go and returns the message JSON", async () => {
    writeProviderSettings({
      text: {
        baseUrl: "https://opencode.ai/zen/go/v1",
        apiKey: "sk-test-ocgo",
        model: "glm-5.3",
        protocol: "auto",
      },
      image: { baseUrl: "", apiKey: "", model: "", size: "" },
    });

    const urls: string[] = [];
    const bodies: unknown[] = [];
    const result = await completeJsonWithFetch(proposalSchema, "Jill waits on the harbor.", async (input, init) => {
      const url = String(input);
      urls.push(url);
      bodies.push(JSON.parse(String(init?.body)));
      expect(url).toContain("/chat/completions");
      expect(url).not.toContain("/responses");
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify(proposal) } }],
      });
    });

    expect(urls).toEqual(["https://opencode.ai/zen/go/v1/chat/completions"]);
    expect(bodies[0]).toMatchObject({
      model: "glm-5.3",
      messages: [
        { role: "system" },
        { role: "user", content: "Jill waits on the harbor." },
      ],
    });
    const messages = (bodies[0] as { messages: Array<{ content?: string }> }).messages;
    expect(messages.some((message) => typeof message.content === "string" && message.content.includes("proposedScenes"))).toBe(
      true,
    );
    expect(result).toEqual(proposal);
  });

  it("still uses the Responses API when protocol is responses", async () => {
    writeProviderSettings({
      text: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test-ocgo",
        model: "gpt-4.1",
        protocol: "responses",
      },
      image: { baseUrl: "", apiKey: "", model: "", size: "" },
    });

    const urls: string[] = [];
    const result = await completeJsonWithFetch(proposalSchema, "Jill waits on the harbor.", async (input, init) => {
      urls.push(String(input));
      const body = JSON.parse(String(init?.body)) as { input?: unknown };
      expect(body.input).toBeDefined();
      return jsonResponse({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(proposal) }] }],
      });
    });

    expect(urls).toEqual(["https://api.openai.com/v1/responses"]);
    expect(result).toEqual(proposal);
  });

  it("retries chat/completions after a 404 on /responses in auto mode", async () => {
    writeProviderSettings({
      text: {
        baseUrl: "https://compat.example/v1",
        apiKey: "sk-test-ocgo",
        model: "compat-model",
        protocol: "auto",
      },
      image: { baseUrl: "", apiKey: "", model: "", size: "" },
    });

    const urls: string[] = [];
    const result = await completeJsonWithFetch(proposalSchema, "Jill waits on the harbor.", async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/responses")) {
        return jsonResponse({ error: { message: "Unknown provider route" } }, 404);
      }
      return jsonResponse({
        choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\`` } }],
      });
    });

    expect(urls).toEqual(["https://compat.example/v1/responses", "https://compat.example/v1/chat/completions"]);
    expect(result).toEqual(proposal);
  });

  it("decodes chat content parts with text objects", async () => {
    writeProviderSettings({
      text: {
        baseUrl: "https://opencode.ai/zen/go/v1",
        apiKey: "sk-test-ocgo",
        model: "deepseek-v4-flash",
        protocol: "chat",
      },
      image: { baseUrl: "", apiKey: "", model: "", size: "" },
    });

    const result = await completeJsonWithFetch(proposalSchema, "Jill waits on the harbor.", async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: [{ type: "text", text: JSON.stringify(proposal) }],
            },
          },
        ],
      }),
    );

    expect(result).toEqual(proposal);
  });

  it("falls back to reasoning_content when content is empty", async () => {
    writeProviderSettings({
      text: {
        baseUrl: "https://opencode.ai/zen/go/v1",
        apiKey: "sk-test-ocgo",
        model: "deepseek-v4-flash",
        protocol: "chat",
      },
      image: { baseUrl: "", apiKey: "", model: "", size: "" },
    });

    const result = await completeJsonWithFetch(proposalSchema, "Jill waits on the harbor.", async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: JSON.stringify(proposal),
            },
          },
        ],
      }),
    );

    expect(result).toEqual(proposal);
  });

  it("decodes prose plus fenced JSON that is not the entire string", async () => {
    writeProviderSettings({
      text: {
        baseUrl: "https://opencode.ai/zen/go/v1",
        apiKey: "sk-test-ocgo",
        model: "deepseek-v4-flash",
        protocol: "chat",
      },
      image: { baseUrl: "", apiKey: "", model: "", size: "" },
    });

    const result = await completeJsonWithFetch(proposalSchema, "Jill waits on the harbor.", async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: `Here is the extract:\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\`\nDone.`,
            },
          },
        ],
      }),
    );

    expect(result).toEqual(proposal);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}
