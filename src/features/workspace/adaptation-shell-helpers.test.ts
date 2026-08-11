import { describe, expect, it } from "vitest";
import type { Adaptation } from "@/domain/adaptation";
import { adaptationSelectionAfterDelete, replaceCanonicalAdaptation, sortAdaptations } from "./adaptation-shell-helpers";

const base: Adaptation = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "99999999-9999-4999-8999-999999999999",
  format: "screenplay_scene",
  title: "One",
  body: "",
  position: 1,
  sourceGenerationId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function item(id: string, position: number): Adaptation {
  return { ...base, id, title: id, position };
}

describe("adaptation shell helpers", () => {
  it("sorts by position then id and replaces canonical records immutably", () => {
    const first = item("22222222-2222-4222-8222-222222222222", 2);
    const second = item("33333333-3333-4333-8333-333333333333", 0);
    const sorted = sortAdaptations([first, second]);
    expect(sorted.map((value) => value.id)).toEqual([second.id, first.id]);
    const replacement = { ...first, title: "Updated" };
    const result = replaceCanonicalAdaptation([first, second], replacement);
    expect(result).not.toBe(first);
    expect(result.find((value) => value.id === first.id)?.title).toBe("Updated");
  });

  it("selects the next stable record, then the previous record, after delete", () => {
    const values = [item("11111111-1111-4111-8111-111111111111", 0), item("22222222-2222-4222-8222-222222222222", 1), item("33333333-3333-4333-8333-333333333333", 2)];
    expect(adaptationSelectionAfterDelete(values, values[1].id, values[1].id)).toBe(values[2].id);
    expect(adaptationSelectionAfterDelete(values.slice(0, 2), values[1].id, values[1].id)).toBe(values[0].id);
  });
});
