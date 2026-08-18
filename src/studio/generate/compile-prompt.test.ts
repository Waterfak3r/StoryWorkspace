import { describe, expect, it } from "vitest";

import type { StudioContextSnapshot } from "../domain";
import {
  buildContinuityConstraints,
  compileComicsPagePrompt,
  compileImagePrompt,
  mentionsCharacterOnScreen,
} from "./compile-prompt";

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
            spatial: "",
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
      storyPosition: { events: [] },
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
          visual: { base: "brown bob, paint-stained smock", references: [], spatial: "" },
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
      storyPosition: { events: [] },
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
          visual: { base: "brown bob, paint-stained smock", references: [], spatial: "" },
          state: { outfit: "", condition: "" },
        },
        {
          id: "character-02",
          kind: "character",
          name: "Johnsy",
          description: "Frail young woman.",
          visual: { base: "pale face, dark hair on a white pillow", references: [], spatial: "" },
          state: { outfit: "", condition: "" },
        },
        {
          id: "character-03",
          kind: "character",
          name: "Behrman",
          description: "Aged painter.",
          visual: { base: "fierce whiskers, old blue shirt", references: [], spatial: "" },
          state: { outfit: "", condition: "" },
        },
        {
          id: "location-01",
          kind: "location",
          name: "Ivy wall",
          description: "Brick wall with ivy.",
          visual: { base: "wet brick, last leaf", references: [], spatial: "" },
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
      storyPosition: { events: [] },
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
      visual: { base: "brown bob, paint-stained smock", references: [], spatial: "" },
      state: { outfit: "", condition: "" },
    };
    const johnsy = {
      id: "character-02",
      kind: "character" as const,
      name: "Johnsy",
      description: "Frail young woman.",
      visual: { base: "pale face, dark hair on a white pillow", references: [], spatial: "" },
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
        storyPosition: { events: [] },
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
        storyPosition: { events: [] },
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
        storyPosition: { events: [] },
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
          storyPosition: { events: [] },
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

  it("forks page prompts for model and overlay lettering without scanning the script", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-01",
        title: "The last leaf",
        script: "“I want to live,” she said. Sue hugged her.",
        intent: "Hope returns.",
      },
      entities: [
        {
          id: "character-02",
          kind: "character",
          name: "Johnsy",
          description: "Frail young woman.",
          visual: { base: "pale face", references: [], spatial: "" },
          state: { outfit: "", condition: "" },
        },
      ],
      style: { id: "default", label: "Default", visual: "Sequential comic stills." },
      intent: "Hope returns.",
      shot: {
        id: "shot-01",
        purpose: "Johnsy chooses life",
        action: "Johnsy watches the leaf",
        camera: "medium",
      },
      continuity: { from: null, prior: null },
      storyPosition: { events: [] },
    };
    const speech = {
      "shot-01": [
        {
          id: "line-01",
          speaker: "Johnsy",
          speakerId: "character-02",
          text: "I want to live,",
          kind: "speech" as const,
          eventId: "volume-01-chapter-01-scene-01",
        },
      ],
    };

    const modeled = compileComicsPagePrompt([snapshot], "", [], speech, "model");
    expect(modeled.prompt).toContain("speech: Johnsy: I want to live,");
    expect(modeled.prompt).toContain("Letter ONLY the listed speech:");
    expect(modeled.prompt).not.toContain("Do not letter the words in the pixels");
    expect(modeled.prompt).not.toContain(snapshot.scene.script);

    const overlaid = compileComicsPagePrompt([snapshot], "", [], speech, "overlay");
    expect(overlaid.prompt).toContain("speech: Johnsy: I want to live,");
    expect(overlaid.prompt).toContain("Do not letter the words in the pixels");
    expect(overlaid.prompt).not.toContain(snapshot.scene.script);
    expect(modeled.prompt).toContain("Cast (draw only these people, no extras): Johnsy.");

    const silent = compileComicsPagePrompt(
      [
        {
          ...snapshot,
          style: {
            ...snapshot.style,
            visual: "Sequential comic stills; leave space for speech balloons.",
          },
        },
      ],
      "",
      [],
      {},
      "model",
    );
    expect(silent.prompt).toContain("Do not draw speech balloons, empty balloon outlines");
    expect(silent.prompt).not.toContain("leave space for speech balloons");
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
          visual: { base: "brown bob, paint-stained smock", references: [], spatial: "" },
          state: { outfit: "", condition: "" },
        },
        {
          id: "character-02",
          kind: "character",
          name: "Johnsy",
          description: "Frail young woman.",
          visual: { base: "pale face, dark hair on a white pillow", references: [], spatial: "" },
          state: { outfit: "", condition: "" },
        },
        {
          id: "character-03",
          kind: "character",
          name: "Behrman",
          description: "Aged painter.",
          visual: { base: "fierce whiskers, old blue shirt", references: [], spatial: "" },
          state: { outfit: "", condition: "" },
        },
        {
          id: "location-02",
          kind: "location",
          name: "Ivy wall",
          description: "Brick wall with ivy.",
          visual: { base: "wet brick, last leaf", references: [], spatial: "" },
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
      storyPosition: { events: [] },
    };

    const compiled = compileImagePrompt(snapshot);
    expect(compiled.prompt).toContain("identity lock Sue:");
    expect(compiled.prompt).toContain("identity lock Johnsy:");
    expect(compiled.prompt).not.toContain("identity lock Behrman");
    expect(compiled.prompt).not.toMatch(/character Behrman/);
  });

  it("includes prior story titles and stacked entity condition", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-02",
        title: "After the storm",
        script: "Jill stands injured on the dock.",
        intent: "Show the cost of the wait.",
      },
      entities: [
        {
          id: "character-01",
          kind: "character",
          name: "Jill",
          description: "A harbor lookout",
          visual: { base: "wool coat", references: [], spatial: "" },
          state: { outfit: "navy coat", condition: "injured" },
        },
      ],
      style: { id: "default", label: "Default", visual: "Cinematic night." },
      intent: "Show the cost of the wait.",
      shot: {
        id: "shot-01",
        purpose: "Aftermath",
        action: "Jill stands on the dock",
        camera: "medium",
      },
      continuity: { from: null, prior: null },
      storyPosition: {
        events: [{ title: "Harbor watch", summary: "Jill waits under a lantern for a signal." }],
      },
    };

    const compiled = compileImagePrompt(snapshot);
    expect(compiled.prompt).toContain("Prior story:");
    expect(compiled.prompt).toContain("Harbor watch");
    expect(compiled.prompt).toContain("condition: injured");
    expect(compiled.prompt).not.toContain(snapshot.scene.script);
  });

  it("lets a stacked hair condition override identity hair length in the compile string", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-03",
        title: "Jim returns home and the gifts are revealed",
        script: "Jim stepped in. Della had sold her hair.",
        intent: "Jim confronts the haircut.",
      },
      entities: [
        {
          id: "character-01",
          kind: "character",
          name: "Della",
          description: "A slender young woman. Her pride is knee-length brown hair.",
          visual: {
            base: "young American woman about twenty, slender, knee-length brown hair, 1900s tenement blouse",
            references: [],
            spatial: "",
          },
          state: {
            outfit: "1900s tenement blouse",
            condition: "hair cut short into tiny close-lying curls",
            supersedes: ["knee-length brown hair"],
          },
        },
      ],
      style: { id: "default", label: "Default", visual: "Watercolor indie." },
      intent: "Jim confronts the haircut.",
      shot: {
        id: "shot-01",
        purpose: "Jim's entrance",
        action: "Jim stops in the doorway and stares at Della",
        camera: "push-in",
      },
      continuity: { from: null, prior: null },
      storyPosition: { events: [] },
    };

    const compiled = compileComicsPagePrompt([snapshot]);
    expect(compiled.prompt).toContain("condition: hair cut short into tiny close-lying curls");
    expect(compiled.prompt).toContain("identity lock Della:");
    expect(compiled.prompt).not.toMatch(/knee-length brown hair/i);
    expect(compiled.prompt).toMatch(/tiny close-lying curls/i);
  });

  it("adds a Spatial lock line from location visual.spatial", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-01",
        title: "The studio",
        script: "Johnsy looks at the window.",
        intent: "Lock the room.",
      },
      entities: [
        {
          id: "location-01",
          kind: "location",
          name: "Studio",
          description: "A top-floor room.",
          visual: { base: "brick and ivy", references: [], spatial: "bed on the left, window on the right" },
          state: { outfit: "", condition: "" },
        },
      ],
      style: { id: "default", label: "Default", visual: "Sequential comic stills." },
      intent: "Lock the room.",
      shot: {
        id: "shot-01",
        purpose: "Look",
        action: "Johnsy looks at the window",
        camera: "medium",
      },
      continuity: { from: null, prior: null },
      storyPosition: { events: [] },
    };

    const page = compileComicsPagePrompt([snapshot]);
    expect(page.prompt).toContain("Spatial lock: bed on the left, window on the right");
    expect(buildContinuityConstraints(snapshot)).toContain("Spatial lock: bed on the left, window on the right");
  });

  it("uses an irregular Marvel-style sentence and omits regular grid phrases", () => {
    const snapshot: StudioContextSnapshot = {
      scene: {
        id: "scene-01",
        title: "The studio",
        script: "Sue opens the curtain.",
        intent: "Open.",
      },
      entities: [],
      style: { id: "default", label: "Default", visual: "Sequential comic stills." },
      intent: "Open.",
      shot: {
        id: "shot-01",
        purpose: "Open",
        action: "Sue opens the curtain",
        camera: "wide",
      },
      continuity: { from: null, prior: null },
      storyPosition: { events: [] },
    };
    const second = {
      ...snapshot,
      shot: { id: "shot-02", purpose: "Look", action: "Johnsy stares at the leaf", camera: "close-up" },
    };

    const marvel = compileComicsPagePrompt([snapshot, second], "", [], {}, "model", {
      layout: "marvel",
      compose: "page",
    });
    expect(marvel.prompt).toMatch(/irregular|Marvel-style/i);
    expect(marvel.prompt).not.toContain("2x2 grid");
    expect(marvel.prompt).not.toContain("two stacked panels");

    const stacked = compileComicsPagePrompt([snapshot, second], "", [], {}, "model", {
      layout: "2",
      compose: "page",
    });
    expect(stacked.prompt).toContain("two stacked panels");

    const panel = compileComicsPagePrompt([snapshot], "", [], {}, "model", {
      layout: "marvel",
      compose: "panels",
    });
    expect(panel.prompt).not.toMatch(/irregular|Marvel-style/i);
    expect(panel.prompt).not.toContain("2x2 grid");
    expect(panel.prompt).not.toContain("two stacked panels");
  });
});
