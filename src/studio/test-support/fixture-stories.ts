import { readFileSync } from "node:fs";
import path from "node:path";

import { createProject } from "../fs";
import { confirmParseRun } from "../parse/confirm-parse-run";
import { parsePastedText } from "../parse/parse-pasted-text";
import type { CompleteJson, LlmParseProposal } from "../parse/schemas";

export const FIXTURE_LAST_LEAF = path.resolve(process.cwd(), "test/resource/test_The Last Leaf.txt");
export const FIXTURE_TELL_TALE = path.resolve(process.cwd(), "test/resource/test_The Tell-Tale Heart.txt");
export const FIXTURE_MAGI = path.resolve(process.cwd(), "test/resource/test_The Gift of the Magi.txt");

export function readFixtureStory(which: "last-leaf" | "tell-tale" | "magi"): string {
  const file = which === "last-leaf" ? FIXTURE_LAST_LEAF : which === "tell-tale" ? FIXTURE_TELL_TALE : FIXTURE_MAGI;
  return readFileSync(file, "utf8");
}

export function fixtureCompleteJson(sourceText: string): CompleteJson {
  return async () => proposalForSource(sourceText);
}

export async function ingestFixtureStory(title: string, which: "last-leaf" | "tell-tale" | "magi") {
  const sourceText = readFixtureStory(which);
  const project = createProject({ title });
  const run = await parsePastedText(project.id, sourceText, fixtureCompleteJson(sourceText));
  const confirmed = await confirmParseRun(project.id, run.id);
  return { project, sourceText, run, confirmed };
}

export function proposalForSource(sourceText: string): LlmParseProposal {
  if (sourceText.includes("Greenwich Village") && sourceText.includes("Johnsy")) {
    return lastLeafProposal();
  }
  if (sourceText.includes("TRUE!") && sourceText.includes("vulture")) {
    return tellTaleProposal();
  }
  if (sourceText.includes("Sofronie") && sourceText.includes("Della")) {
    return magiProposal();
  }
  throw new Error("Unknown fixture story text.");
}

function magiProposal(): LlmParseProposal {
  return {
    proposedScenes: [
      {
        key: "scene-count",
        title: "Della counts her savings and reflects in the glass",
        script: "Della counts one dollar and eighty-seven cents.",
        intent: "Poverty and pride.",
        characterNames: ["Della"],
        locationName: "The Dillingham Flat",
        propNames: ["Della's pennies", "Jim's gold watch"],
        costumeNames: ["Old brown jacket"],
        volumeName: "The Gift of the Magi",
        chapterName: "The flat",
      },
      {
        key: "scene-shop",
        title: "Mme. Sofronie buys Della's hair",
        script: "Della sells her hair.",
        intent: "The sacrifice.",
        characterNames: ["Della", "Madame Sofronie"],
        locationName: "Mme. Sofronie",
        propNames: ["Fob chain"],
        costumeNames: ["Old brown jacket"],
        volumeName: "The Gift of the Magi",
        chapterName: "The shop",
      },
      {
        key: "scene-wait",
        title: "Della curls her hair and awaits Jim's arrival",
        script: "Della curls her hair and waits.",
        intent: "Anxiety.",
        characterNames: ["Della"],
        locationName: "The Dillingham Flat",
        propNames: ["Fob chain", "Curling irons"],
        costumeNames: [],
        volumeName: "The Gift of the Magi",
        chapterName: "Waiting",
      },
      {
        key: "scene-gifts",
        title: "Jim returns home and the gifts are revealed",
        script: "Jim comes home with the combs.",
        intent: "The exchange.",
        characterNames: ["Della", "Jim"],
        locationName: "The Dillingham Flat",
        propNames: ["Fob chain", "Gift package of combs", "Jim's gold watch"],
        costumeNames: ["Jim's worn overcoat"],
        volumeName: "The Gift of the Magi",
        chapterName: "The gifts",
      },
    ],
    proposedEntities: [
      {
        key: "ent-della",
        kind: "character",
        name: "Della",
        description: "Young American woman about twenty, slender, knee-length brown hair.",
      },
      {
        key: "ent-jim",
        kind: "character",
        name: "Jim",
        description: "Thin serious American man twenty-two, short dark hair, worn overcoat.",
      },
      {
        key: "ent-sofronie",
        kind: "character",
        name: "Madame Sofronie",
        description: "Large, too-white, chilly owner of a hair-goods shop.",
      },
      {
        key: "ent-flat",
        kind: "location",
        name: "The Dillingham Flat",
        description: "Shabby $8 furnished flat; couch opposite the door; pier glass between two windows.",
      },
      {
        key: "ent-shop",
        kind: "location",
        name: "Mme. Sofronie",
        description: "One flight up; hair goods shop; sign on the street.",
      },
      {
        key: "ent-watch",
        kind: "prop",
        name: "Jim's gold watch",
        description: "Gold watch that had been his father's and his grandfather's.",
      },
      {
        key: "ent-chain",
        kind: "prop",
        name: "Fob chain",
        description: "Simple platinum watch fob chain.",
      },
      {
        key: "ent-combs",
        kind: "prop",
        name: "Gift package of combs",
        description: "Tortoise-shell combs with jewelled rims.",
      },
      {
        key: "ent-irons",
        kind: "prop",
        name: "Curling irons",
        description: "Metal irons heated on the gas.",
      },
      {
        key: "ent-pennies",
        kind: "prop",
        name: "Della's pennies",
        description: "One dollar and eighty-seven cents in change.",
      },
      {
        key: "ent-jacket",
        kind: "costume",
        name: "Old brown jacket",
        description: "Della's old brown jacket and hat.",
      },
      {
        key: "ent-coat",
        kind: "costume",
        name: "Jim's worn overcoat",
        description: "Thin worn overcoat, no gloves.",
      },
    ],
  };
}

function lastLeafProposal(): LlmParseProposal {
  return {
    proposedScenes: [
      {
        key: "scene-studio",
        title: "A studio in Greenwich Village",
        script: "Sue and Johnsy share a studio.",
        intent: "Introduce the artists and their rooms.",
        characterNames: ["Sue", "Johnsy"],
        locationName: "Greenwich Village studio",
        propNames: ["Drawing board"],
        costumeNames: ["Paint-stained smock"],
        volumeName: "The Last Leaf",
        chapterName: "Greenwich Village",
      },
      {
        key: "scene-illness",
        title: "Pneumonia visits Johnsy",
        script: "The doctor talks with Sue.",
        intent: "Johnsy loses the will to live.",
        characterNames: ["Sue", "Johnsy", "Doctor"],
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
        propNames: ["Ivy vine"],
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
        costumeNames: ["Old blue shirt"],
        volumeName: "The Last Leaf",
        chapterName: "Behrman's masterpiece",
      },
      {
        key: "scene-masterpiece",
        title: "The last leaf stays",
        script: "The painted leaf holds through the storm.",
        intent: "Behrman's masterpiece saves Johnsy.",
        characterNames: ["Sue", "Johnsy", "Behrman", "Doctor"],
        locationName: "Ivy wall",
        propNames: ["Ivy vine"],
        costumeNames: [],
        volumeName: "The Last Leaf",
        chapterName: "Behrman's masterpiece",
      },
    ],
    proposedEntities: [
      {
        key: "ent-sue",
        kind: "character",
        name: "Sue",
        description: "Young woman from Maine, brown bob, alert eyes, paint-stained smock.",
      },
      {
        key: "ent-johnsy",
        kind: "character",
        name: "Johnsy",
        description: "Frail young woman from California, pale face, dark hair on a white pillow.",
      },
      {
        key: "ent-behrman",
        kind: "character",
        name: "Behrman",
        description: "Aged painter, fierce whiskers, small fierce eyes, old blue shirt.",
      },
      {
        key: "ent-doctor",
        kind: "character",
        name: "Doctor",
        description: "Quiet city doctor, dark coat, measured voice.",
      },
      {
        key: "ent-studio",
        kind: "location",
        name: "Greenwich Village studio",
        description: "Top-floor brick studio west of Washington Square, cramped, north light.",
      },
      {
        key: "ent-ivy",
        kind: "location",
        name: "Ivy wall",
        description: "Old ivy vine on the neighboring brick wall, autumn leaves falling.",
      },
      {
        key: "ent-board",
        kind: "prop",
        name: "Drawing board",
        description: "Sue's wooden drawing board.",
      },
      {
        key: "ent-vine",
        kind: "prop",
        name: "Ivy vine",
        description: "Bare ivy vine clinging to wet brick.",
      },
      {
        key: "ent-smock",
        kind: "costume",
        name: "Paint-stained smock",
        description: "Sue's work smock with dried pigment.",
      },
      {
        key: "ent-shirt",
        kind: "costume",
        name: "Old blue shirt",
        description: "Behrman's worn blue painter's shirt.",
      },
    ],
  };
}

function tellTaleProposal(): LlmParseProposal {
  return {
    proposedScenes: [
      {
        key: "scene-eye",
        title: "The vulture eye",
        script: "The narrator hates the old man's eye.",
        intent: "Establish the obsession.",
        characterNames: ["Narrator", "Old man"],
        locationName: "The old man's chamber",
        propNames: [],
        costumeNames: ["Dark Victorian coat"],
        volumeName: "The Tell-Tale Heart",
        chapterName: "The vulture eye",
      },
      {
        key: "scene-watch",
        title: "Seven midnights",
        script: "He watches with a dark lantern.",
        intent: "The nightly vigil.",
        characterNames: ["Narrator", "Old man"],
        locationName: "The old man's chamber",
        propNames: ["Dark lantern"],
        costumeNames: ["Dark Victorian coat"],
        volumeName: "The Tell-Tale Heart",
        chapterName: "The vulture eye",
      },
      {
        key: "scene-kill",
        title: "The eighth night",
        script: "He kills the old man.",
        intent: "The murder.",
        characterNames: ["Narrator", "Old man"],
        locationName: "The old man's chamber",
        propNames: ["Bed"],
        costumeNames: [],
        volumeName: "The Tell-Tale Heart",
        chapterName: "The eighth night",
      },
      {
        key: "scene-hide",
        title: "Under the floorboards",
        script: "He hides the body.",
        intent: "Concealment.",
        characterNames: ["Narrator"],
        locationName: "The old man's chamber",
        propNames: ["Floorboards"],
        costumeNames: [],
        volumeName: "The Tell-Tale Heart",
        chapterName: "The eighth night",
      },
      {
        key: "scene-officers",
        title: "The beating heart",
        script: "The officers sit; he confesses.",
        intent: "Guilt breaks him.",
        characterNames: ["Narrator", "Officers"],
        locationName: "The old man's chamber",
        propNames: ["Floorboards"],
        costumeNames: ["Dark Victorian coat"],
        volumeName: "The Tell-Tale Heart",
        chapterName: "The beating heart",
      },
    ],
    proposedEntities: [
      {
        key: "ent-narrator",
        kind: "character",
        name: "Narrator",
        description: "Hollow-eyed man, taut smile, dark Victorian coat, sharp hearing.",
      },
      {
        key: "ent-oldman",
        kind: "character",
        name: "Old man",
        description: "Aged man, thin white hair, pale blue filmed vulture eye.",
      },
      {
        key: "ent-officers",
        kind: "character",
        name: "Officers",
        description: "Three calm policemen in dark uniforms.",
      },
      {
        key: "ent-chamber",
        kind: "location",
        name: "The old man's chamber",
        description: "Dark shuttered bedroom, heavy wood, a single lantern ray.",
      },
      {
        key: "ent-lantern",
        kind: "prop",
        name: "Dark lantern",
        description: "Closed lantern that opens to a thin ray.",
      },
      {
        key: "ent-bed",
        kind: "prop",
        name: "Bed",
        description: "The old man's wooden bed.",
      },
      {
        key: "ent-floor",
        kind: "prop",
        name: "Floorboards",
        description: "Loose chamber floorboards.",
      },
      {
        key: "ent-coat",
        kind: "costume",
        name: "Dark Victorian coat",
        description: "The narrator's close-cut dark coat.",
      },
    ],
  };
}
