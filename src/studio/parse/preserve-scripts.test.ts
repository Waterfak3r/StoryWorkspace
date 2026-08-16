import { describe, expect, it } from "vitest";

import { preserveProposalScripts } from "./preserve-scripts";
import type { LlmParseProposal } from "./schemas";

describe("preserveProposalScripts alignment", () => {
  it("assigns Behrman-intro wording to the Behrman beat and recovery wording to Johnsy", () => {
    const sourceText = [
      "Sue and Johnsy shared a studio west of Washington Square.",
      "Johnsy became sick and counted the ivy leaves.",
      "Their neighbor, Mr. Behrman, lived downstairs.",
      "Sue told Behrman about Johnsy and the last leaf.",
      '"Is she foolish?" Behrman shouted.',
      "The next morning Johnsy said she wanted to live.",
      "Sue told her Behrman had painted the last leaf.",
    ].join("\n\n");

    const proposal: LlmParseProposal = {
      proposedScenes: [
        {
          key: "scene-studio",
          title: "A studio in Greenwich Village",
          script: "Sue and Johnsy share a studio.",
          intent: "Introduce the artists.",
          characterNames: ["Sue", "Johnsy"],
          locationName: "Greenwich Village studio",
          propNames: [],
          costumeNames: [],
          volumeName: "The Last Leaf",
          chapterName: "Greenwich Village",
        },
        {
          key: "scene-leaves",
          title: "Counting the ivy leaves",
          script: "Johnsy counts the falling leaves.",
          intent: "She ties her life to the last leaf.",
          characterNames: ["Sue", "Johnsy"],
          locationName: "Ivy wall",
          propNames: [],
          costumeNames: [],
          volumeName: "The Last Leaf",
          chapterName: "The ivy vine",
        },
        {
          key: "scene-behrman",
          title: "Behrman hears the last leaf",
          script: "Sue tells Behrman.",
          intent: "The old painter learns of Johnsy's fear.",
          characterNames: ["Sue", "Behrman"],
          locationName: "Greenwich Village studio",
          propNames: [],
          costumeNames: [],
          volumeName: "The Last Leaf",
          chapterName: "Behrman's masterpiece",
        },
        {
          key: "scene-masterpiece",
          title: "The last leaf stays",
          script: "The painted leaf holds through the storm.",
          intent: "Behrman's masterpiece saves Johnsy.",
          characterNames: ["Sue", "Johnsy", "Behrman"],
          locationName: "Ivy wall",
          propNames: [],
          costumeNames: [],
          volumeName: "The Last Leaf",
          chapterName: "Behrman's masterpiece",
        },
      ],
      proposedEntities: [
        { key: "ent-sue", kind: "character", name: "Sue", description: "Artist." },
        { key: "ent-johnsy", kind: "character", name: "Johnsy", description: "Patient." },
        { key: "ent-behrman", kind: "character", name: "Behrman", description: "Painter." },
      ],
    };

    const preserved = preserveProposalScripts(sourceText, proposal);
    const behrmanIntro = preserved.proposedScenes.find((scene) => /Behrman shouted/i.test(scene.script));
    const recovery = preserved.proposedScenes.find((scene) => /wanted to live/i.test(scene.script));

    expect(behrmanIntro).toBeDefined();
    expect(behrmanIntro!.characterNames).toEqual(expect.arrayContaining(["Behrman"]));
    expect(behrmanIntro!.title.toLowerCase()).toContain("behrman");

    expect(recovery).toBeDefined();
    expect(recovery!.characterNames).toEqual(expect.arrayContaining(["Johnsy"]));
    expect(recovery!.script).toMatch(/Johnsy/i);
  });
});
