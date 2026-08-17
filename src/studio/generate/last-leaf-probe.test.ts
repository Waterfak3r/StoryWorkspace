import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createProject } from "../fs";
import { openaiCompatibleImageAdapter } from "./openai-image-adapter";

const LIVE = process.env.LAST_LEAF_PROBE === "1";
const SCRATCH = process.env.LAST_LEAF_SCRATCH ?? "";

describe.skipIf(!LIVE)("image provider probe", () => {
  it("completes a short gpt-image-2 still before the 250s proxy timeout", async () => {
    process.env.STORY_WORKSPACE_ROOT = path.resolve(".data/projects");
    const project = existsSync(path.resolve(".data/projects/the-last-leaf/project.json"))
      ? { id: "the-last-leaf" }
      : createProject({ title: "Probe" });
    bumpCount();
    const started = Date.now();
    const result = await openaiCompatibleImageAdapter({
      projectId: project.id,
      sceneId: "scene-02",
      shotId: "shot-01",
      runId: "probe-01",
      prompt: "One simple comic panel of a small Greenwich Village art studio, ink and watercolor, no text.",
      provider: {
        model: "gpt-image-2",
        size: "1024x1024",
        quality: "low",
      },
    });
    const elapsed = Date.now() - started;
    const absolute = path.resolve(".data/projects", project.id, ...result.relativePath.split("/"));
    const bytes = existsSync(absolute) ? readFileSync(absolute) : Buffer.alloc(0);
    const line = `PROBE ok path=${result.relativePath} bytes=${bytes.length} elapsed_ms=${elapsed}`;
    if (SCRATCH) {
      writeFileSync(path.join(SCRATCH, "probe.log"), `${line}\n`, "utf8");
    }
    expect(bytes.length).toBeGreaterThan(80);
  }, 300_000);
});

function bumpCount() {
  if (!SCRATCH) {
    return;
  }
  const file = path.join(SCRATCH, "image-gen-count.txt");
  const current = existsSync(file) ? Number.parseInt(readFileSync(file, "utf8").trim() || "0", 10) : 0;
  writeFileSync(file, String(current + 1), "utf8");
}
