import { describe, expect, it } from "vitest";

import { planScenePages } from "./plan-pages";

function shots(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `shot-${String(index + 1).padStart(2, "0")}` }));
}

function sizes(planned: ReturnType<typeof planScenePages>) {
  const pages = new Map<string, number>();
  for (const item of planned) {
    pages.set(item.pageId, (pages.get(item.pageId) ?? 0) + 1);
  }
  return [...pages.values()];
}

describe("planScenePages", () => {
  it("cuts fixed 2/3/4 by that count", () => {
    expect(sizes(planScenePages("scene-01", shots(5), "2"))).toEqual([2, 2, 1]);
    expect(sizes(planScenePages("scene-01", shots(5), "3"))).toEqual([3, 2]);
    expect(sizes(planScenePages("scene-01", shots(5), "4"))).toEqual([4, 1]);
    expect(planScenePages("scene-01", shots(5), "4").every((item) => item.panelIndex < 4)).toBe(true);
  });

  it("plans auto pages of 2–4, prefers 3, and never leaves a remainder of 1", () => {
    expect(sizes(planScenePages("scene-01", shots(2), "auto"))).toEqual([2]);
    expect(sizes(planScenePages("scene-01", shots(5), "auto"))).toEqual([3, 2]);
    expect(sizes(planScenePages("scene-01", shots(6), "auto"))).toEqual([3, 3]);
    expect(sizes(planScenePages("scene-01", shots(7), "auto"))).toEqual([4, 3]);
    expect(sizes(planScenePages("scene-01", shots(8), "auto"))).toEqual([4, 4]);
    expect(sizes(planScenePages("scene-01", shots(9), "auto"))).toEqual([3, 3, 3]);
    expect(sizes(planScenePages("scene-01", shots(5), "auto"))).not.toEqual([2, 2, 1]);
  });

  it("cuts marvel the same as auto", () => {
    expect(sizes(planScenePages("scene-06", shots(5), "marvel"))).toEqual([3, 2]);
    expect(sizes(planScenePages("scene-06", shots(8), "marvel"))).toEqual([4, 4]);
  });

  it("uses page-{sceneSlug}-{NN} from scene order", () => {
    const planned = planScenePages("scene-01", shots(5), "auto");
    expect(planned.map((item) => item.pageId)).toEqual([
      "page-01-01",
      "page-01-01",
      "page-01-01",
      "page-01-02",
      "page-01-02",
    ]);
    expect(planned.map((item) => item.panelIndex)).toEqual([0, 1, 2, 0, 1]);
    expect(planScenePages("scene-06", shots(2), "auto")[0]?.pageId).toBe("page-06-01");
  });
});
