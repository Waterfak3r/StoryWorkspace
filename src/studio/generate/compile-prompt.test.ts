import { describe, expect, it } from "vitest";

import type { StudioContextSnapshot } from "../domain";
import { compileComicsPagePrompt, compileImagePrompt, mentionsCharacterOnScreen } from "./compile-prompt";

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
    expect(compiled.prompt).toContain("identity lock Wool coat: navy wool");
    expect(compiled.prompt).toContain("Keep character likeness, costume, and comic style identical");
    expect(compiled.prompt).toContain("assets/images/coat.png");
    expect(compiled.prompt).toMatch(/reference:\s*assets\/images\/coat\.png/);
  });

  it("illustrates the shot action and does not dump other scene episodes", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-01",
        title: "A studio in Greenwich Village",
        script:
          "Suppose a collector with a bill for paint, paper and canvas should suddenly meet himself.\n\nSue and Johnsy came to Greenwich Village.",
        intent: "Introduce the artists and their rooms.",
      },
      entities: [
        {
          id: "character-01",
          kind: "character",
          name: "Sue",
          description: "Young woman from Maine.",
          visual: { base: "brown bob, paint-stained smock", references: [] },
          state: { outfit: "", condition: "" },
        },
      ],
      style: {
        id: "default",
        label: "Default",
        visual: "Sequential comic stills.",
      },
      intent: "Introduce the artists and their rooms.",
      shot: {
        id: "shot-02",
        purpose: "Sue and Johnsy arrive",
        action: "Sue and Johnsy carry boxes into the top-floor studio",
        camera: "medium two-shot, slight low angle",
      },
      continuity: { from: "shot-01", prior: { purpose: "Streets", action: "Winding streets", camera: "wide" } },
    };

    const compiled = compileImagePrompt(snapshot);

    expect(compiled.prompt).toContain("Style: Sequential comic stills.");
    expect(compiled.prompt).toContain("identity lock Sue: brown bob, paint-stained smock");
    expect(compiled.prompt).toContain("Action: Sue and Johnsy carry boxes into the top-floor studio");
    expect(compiled.prompt).toContain("Illustrate only this shot's action");
    expect(compiled.prompt).not.toContain("collector with a bill");
    expect(compiled.prompt).not.toContain(snapshot.scene.script);
  });

  it("locks only characters named in the shot action", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-06",
        title: "The last leaf stays",
        script: "Sue hugged Johnsy. The doctor waited downstairs.",
        intent: "Behrman's masterpiece saves Johnsy.",
      },
      entities: [
        {
          id: "character-01",
          kind: "character",
          name: "Sue",
          description: "Young woman from Maine.",
          visual: { base: "brown bob, paint-stained smock", references: [] },
          state: { outfit: "", condition: "" },
        },
        {
          id: "character-02",
          kind: "character",
          name: "Johnsy",
          description: "Frail young woman.",
          visual: { base: "pale face, dark hair on a white pillow", references: [] },
          state: { outfit: "", condition: "" },
        },
        {
          id: "character-03",
          kind: "character",
          name: "Behrman",
          description: "Aged painter.",
          visual: { base: "fierce whiskers, old blue shirt", references: [] },
          state: { outfit: "", condition: "" },
        },
        {
          id: "location-01",
          kind: "location",
          name: "Ivy wall",
          description: "Brick wall with ivy.",
          visual: { base: "wet brick, last leaf", references: [] },
          state: { outfit: "", condition: "" },
        },
      ],
      style: { id: "default", label: "Default", visual: "Sequential comic stills." },
      intent: "Behrman's masterpiece saves Johnsy.",
      shot: {
        id: "shot-18",
        purpose: "Sue comforts Johnsy",
        action: "Sue hugs Johnsy",
        camera: "medium",
      },
      continuity: { from: null, prior: null },
    };

    const compiled = compileImagePrompt(snapshot);
    expect(compiled.prompt).toContain("identity lock Sue: brown bob, paint-stained smock");
    expect(compiled.prompt).toContain("identity lock Johnsy: pale face, dark hair on a white pillow");
    expect(compiled.prompt).toContain("Ivy wall");
    expect(compiled.prompt).not.toContain("identity lock Behrman");
    expect(compiled.prompt).not.toMatch(/character Behrman/);
    expect(compiled.prompt).toContain("Only draw the named characters for this shot");
  });

  it("compiles consecutive shots into one comic-page prompt, not four separate pictures", () => {
    const sue = {
      id: "character-01",
      kind: "character" as const,
      name: "Sue",
      description: "Young woman from Maine.",
      visual: { base: "brown bob, paint-stained smock", references: [] },
      state: { outfit: "", condition: "" },
    };
    const johnsy = {
      id: "character-02",
      kind: "character" as const,
      name: "Johnsy",
      description: "Frail young woman.",
      visual: { base: "pale face, dark hair on a white pillow", references: [] },
      state: { outfit: "", condition: "" },
    };
    const scene = {
      id: "scene-06",
      title: "The last leaf stays",
      script: "Johnsy wants to live. Sue hugged her. The painted leaf stays.",
      intent: "Hope returns.",
    };
    const style = { id: "default" as const, label: "Default", visual: "Sequential comic stills." };
    const compiled = compileComicsPagePrompt([
      {
        scene,
        entities: [sue, johnsy],
        style,
        intent: "Hope returns.",
        shot: {
          id: "shot-17",
          purpose: "Johnsy chooses life",
          action: "Johnsy continues watching the leaf, then says she wants to live and paint again.",
          camera: "medium",
        },
        continuity: { from: null, prior: null },
      },
      {
        scene,
        entities: [sue, johnsy],
        style,
        intent: "Hope returns.",
        shot: {
          id: "shot-18",
          purpose: "Sue comforts Johnsy",
          action: "Sue hugs Johnsy, expressing joy.",
          camera: "medium",
        },
        continuity: { from: "shot-17", prior: { purpose: "Johnsy chooses life", action: "Johnsy wants to live", camera: "medium" } },
      },
      {
        scene,
        entities: [sue, johnsy],
        style,
        intent: "Hope returns.",
        shot: {
          id: "shot-23",
          purpose: "The painted leaf",
          action: "The painted leaf remains on the wall, a testament to Behrman's sacrifice.",
          camera: "insert",
        },
        continuity: { from: "shot-18", prior: { purpose: "Sue comforts Johnsy", action: "Sue hugs Johnsy", camera: "medium" } },
      },
    ]);

    expect(compiled.prompt).toContain("ONE sequential comic PAGE as a single image");
    expect(compiled.prompt).toContain("Do not generate four separate pictures");
    expect(compiled.prompt).toContain("two on the top row");
    expect(compiled.prompt).toContain("Panel 1 (top-left)");
    expect(compiled.prompt).toContain("Johnsy continues watching the leaf, then says she wants to live and paint again.");
    expect(compiled.prompt).toContain("Panel 2 (top-right)");
    expect(compiled.prompt).toContain("Sue hugs Johnsy, expressing joy.");
    expect(compiled.prompt).toContain("Panel 3 (bottom wide)");
    expect(compiled.prompt).toContain("The painted leaf remains on the wall");
    expect(compiled.prompt).toContain("identity lock Sue: brown bob, paint-stained smock");
    expect(compiled.prompt).not.toContain("identity lock Behrman");
    const withRefs = compileComicsPagePrompt(
      [
        {
          scene,
          entities: [sue, johnsy],
          style,
          intent: "Hope returns.",
          shot: {
            id: "shot-17",
            purpose: "Johnsy chooses life",
            action: "Johnsy continues watching the leaf, then says she wants to live and paint again.",
            camera: "medium",
          },
          continuity: { from: null, prior: null },
        },
      ],
      "",
      ["Match identity from the attached reference images. Do not invent a new likeness."],
    );
    expect(withRefs.prompt).toContain("Match identity from the attached reference images");
  });

  it("treats a standalone name as on-screen and ignores a possessive-only mention", () => {
    expect(mentionsCharacterOnScreen("Sue hugs Johnsy, expressing joy.", "Sue")).toBe(true);
    expect(mentionsCharacterOnScreen("Johnsy continues watching the leaf.", "Sue")).toBe(false);
    expect(mentionsCharacterOnScreen("Sue smiles and tells Johnsy the leaf is there.", "Sue")).toBe(true);
    expect(mentionsCharacterOnScreen("a testament to Behrman's sacrifice.", "Behrman")).toBe(false);
    expect(mentionsCharacterOnScreen("Behrman stands at the window.", "Behrman")).toBe(true);
  });

  it("carries Sue from the prior shot onto a Johnsy-only action", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-06",
        title: "The last leaf stays",
        script: "Johnsy wants to live. Sue hugged her.",
        intent: "Behrman's masterpiece saves Johnsy.",
      },
      entities: [
        {
          id: "character-01",
          kind: "character",
          name: "Sue",
          description: "Young woman from Maine.",
          visual: { base: "brown bob, paint-stained smock", references: [] },
          state: { outfit: "", condition: "" },
        },
        {
          id: "character-02",
          kind: "character",
          name: "Johnsy",
          description: "Frail young woman.",
          visual: { base: "pale face, dark hair on a white pillow", references: [] },
          state: { outfit: "", condition: "" },
        },
        {
          id: "character-03",
          kind: "character",
          name: "Behrman",
          description: "Aged painter.",
          visual: { base: "fierce whiskers, old blue shirt", references: [] },
          state: { outfit: "", condition: "" },
        },
        {
          id: "location-02",
          kind: "location",
          name: "Ivy wall",
          description: "Brick wall with ivy.",
          visual: { base: "wet brick, last leaf", references: [] },
          state: { outfit: "", condition: "" },
        },
      ],
      style: { id: "default", label: "Default", visual: "Sequential comic stills." },
      intent: "Behrman's masterpiece saves Johnsy.",
      shot: {
        id: "shot-17",
        purpose: "Show Johnsy's realization and change of heart.",
        action: "Johnsy continues watching the leaf, then says she wants to live and paint again.",
        camera: "medium",
      },
      continuity: {
        from: "shot-16",
        prior: {
          purpose: "Show Sue's comforting smile.",
          action: "Sue smiles and tells Johnsy the leaf is there to prove her wrong.",
          camera: "medium",
        },
      },
    };

    const compiled = compileImagePrompt(snapshot);
    expect(compiled.prompt).toContain("identity lock Sue:");
    expect(compiled.prompt).toContain("identity lock Johnsy:");
    expect(compiled.prompt).not.toContain("identity lock Behrman");
    expect(compiled.prompt).not.toMatch(/character Behrman/);
  });
});
