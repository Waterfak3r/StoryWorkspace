import { describe, expect, it } from "vitest";

import type { StudioContextSnapshot } from "../domain";
import { compileImagePrompt } from "./compile-prompt";

describe("compileImagePrompt", () => {
  it("prefixes costume entities and includes visual base plus textual references", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-01",
        title: "Harbor watch",
        script: "Jill waits under a lantern.",
        intent: "Establish Jill waiting.",
      },
      entities: [
        {
          id: "costume-01",
          kind: "costume",
          name: "Wool coat",
          description: "Heavy coat for night watch.",
          visual: {
            base: "navy wool",
            references: ["assets/images/coat.png"],
          },
          state: { outfit: "", condition: "" },
        },
      ],
      style: {
        id: "default",
        label: "Default",
        visual: "Cinematic night.",
      },
      intent: "Establish Jill waiting.",
      shot: {
        id: "shot-01",
        purpose: "Wide establishing",
        action: "Jill waits",
        camera: "Wide",
      },
      continuity: {
        from: null,
        prior: null,
      },
    };

    const compiled = compileImagePrompt(snapshot);

    expect(compiled.prompt).toContain("costume reference");
    expect(compiled.prompt).toContain("navy wool");
    expect(compiled.prompt).toContain("assets/images/coat.png");
    expect(compiled.prompt).toMatch(/reference:\s*assets\/images\/coat\.png/);
  });
});
