import { describe, expect, it } from "vitest";

import { preserveProposalScripts, scriptMostlyCoveredBy, scriptsCoverSource } from "./preserve-scripts";
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

  it("fails coverage when a long source span is omitted even if length still matches", () => {
    const source = [
      "Della counted one dollar and eighty-seven cents on Christmas Eve.",
      "She let her hair fall to its full length. Jim's gold watch was their other pride.",
      "Where she stopped the sign read: “Mme. Sofronie. Hair Goods of All Kinds.” Will you buy my hair? Twenty dollars, said Madame.",
      "When Della reached home she curled the ravages made by generosity.",
      "Jim stepped in. You’ve cut off your hair? I sold the watch to buy your combs.",
    ].join("\n\n");
    const scripts = [
      "Della counted one dollar and eighty-seven cents on Christmas Eve. She let her hair fall to its full length. Jim's gold watch was their other pride.",
      "When Della reached home she curled the ravages made by generosity. Jim stepped in. You’ve cut off your hair? I sold the watch to buy your combs.",
    ];
    expect(scripts.join(" ").length).toBeGreaterThan(source.length * 0.6);
    expect(scriptsCoverSource(source, scripts)).toBe(false);
  });

  it("puts the omitted shop visit back into a scene when the model jumped home", () => {
    const source = [
      "Della counted one dollar and eighty-seven cents on Christmas Eve.",
      "She let her hair fall to its full length. Jim's gold watch was their other pride.",
      "Where she stopped the sign read: “Mme. Sofronie. Hair Goods of All Kinds.” Will you buy my hair? Twenty dollars, said Madame.",
      "When Della reached home she curled the ravages made by generosity.",
      "Jim stepped in. You’ve cut off your hair? I sold the watch to buy your combs.",
    ].join("\n\n");
    const proposal: LlmParseProposal = {
      proposedScenes: [
        {
          key: "scene-count",
          title: "Della counts",
          script: "Della counts her money.",
          intent: "Poverty.",
          characterNames: ["Della"],
          locationName: "The flat",
          propNames: [],
          costumeNames: [],
          volumeName: "The Gift of the Magi",
          chapterName: "The flat",
        },
        {
          key: "scene-wait",
          title: "Della waits",
          script: "Della curls her hair.",
          intent: "Wait.",
          characterNames: ["Della"],
          locationName: "The flat",
          propNames: [],
          costumeNames: [],
          volumeName: "The Gift of the Magi",
          chapterName: "Waiting",
        },
        {
          key: "scene-gifts",
          title: "The gifts",
          script: "Jim comes home.",
          intent: "Exchange.",
          characterNames: ["Della", "Jim"],
          locationName: "The flat",
          propNames: [],
          costumeNames: [],
          volumeName: "The Gift of the Magi",
          chapterName: "The gifts",
        },
      ],
      proposedEntities: [
        { key: "ent-della", kind: "character", name: "Della", description: "Young wife." },
        { key: "ent-jim", kind: "character", name: "Jim", description: "Young husband." },
      ],
    };

    const preserved = preserveProposalScripts(source, proposal);
    expect(preserved.proposedScenes.some((scene) => /Sofronie|buy my hair/i.test(scene.script))).toBe(true);
    expect(scriptsCoverSource(source, preserved.proposedScenes.map((scene) => scene.script))).toBe(true);
  });

  it("treats a duplicate dump as already covered by earlier directed scripts", () => {
    const directed = [
      "Della counted one dollar and eighty-seven cents on Christmas Eve. She let her hair fall to its full length.",
      "When Della reached home she curled the ravages. Jim stepped in. I sold the watch.",
    ];
    const dump = `${directed[0]}\n\n${directed[1]}`;
    expect(scriptMostlyCoveredBy(dump, directed)).toBe(true);
    expect(scriptMostlyCoveredBy("Where she stopped the sign read: “Mme. Sofronie. Hair Goods of All Kinds.” Will you buy my hair?", directed)).toBe(
      false,
    );
  });
});
