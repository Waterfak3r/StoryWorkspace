import { describe, expect, it } from "vitest";
import { readSectionFromLocation } from "./sections";

describe("readSectionFromLocation", () => {
  it("defaults to overview when the section query is missing", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "" })).toBe("overview");
  });

  it("reads a valid section query", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "?section=story" })).toBe("story");
  });

  it("falls back to overview for an unknown section", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "?section=nope" })).toBe("overview");
  });

  it("defaults to overview when the section query is empty", () => {
    expect(readSectionFromLocation({ pathname: "/projects/p", search: "?section=" })).toBe("overview");
  });
});
