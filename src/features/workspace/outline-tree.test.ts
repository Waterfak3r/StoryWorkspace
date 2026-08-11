import { describe, expect, it } from "vitest";
import type { OutlineNode } from "@/domain/narrative";
import {
  getOutlineDescendantIds,
  getOutlineParentChoices,
  getSiblingMoveState,
  moveOutlineNode,
  projectOutlineTree,
  replaceCanonicalRecord,
  toPreOrderIds,
} from "./outline-tree";

const timestamp = "2026-01-01T00:00:00.000Z";

function node(id: string, position: number, parentId: string | null = null, kind: OutlineNode["kind"] = "act"): OutlineNode {
  return {
    id,
    projectId: "00000000-0000-4000-8000-000000000001",
    parentId,
    kind,
    title: id,
    summary: "",
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("outline tree helpers", () => {
  it("projects a stable pre-order tree and safely promotes orphans", () => {
    const nodes = [
      node("child-b", 1, "root"),
      node("orphan", 4, "missing-parent"),
      node("root", 2, null, "story"),
      node("child-a", 0, "root"),
    ];

    const tree = projectOutlineTree(nodes);
    expect(tree.map((item) => item.node.id)).toEqual(["root", "orphan"]);
    expect(tree[0].children.map((item) => item.node.id)).toEqual(["child-a", "child-b"]);
    expect(toPreOrderIds(nodes)).toEqual(["root", "child-a", "child-b", "orphan"]);
  });

  it("excludes a node and all descendants from parent choices", () => {
    const nodes = [node("root", 0, null, "story"), node("child", 0, "root"), node("grandchild", 0, "child"), node("other", 1)];

    expect(getOutlineDescendantIds(nodes, "root")).toEqual(["child", "grandchild"]);
    expect(getOutlineParentChoices(nodes, "root").map((item) => item.id)).toEqual(["other"]);
  });

  it("moves only within the same sibling group and returns complete pre-order IDs", () => {
    const nodes = [
      node("root", 0, null, "story"),
      node("first", 0, "root"),
      node("second", 1, "root"),
      node("other-root", 1, null, "story"),
    ];

    expect(getSiblingMoveState(nodes, "first")).toEqual({ canMoveUp: false, canMoveDown: true });
    expect(moveOutlineNode(nodes, "second", "up")).toEqual(["root", "second", "first", "other-root"]);
    expect(moveOutlineNode(nodes, "first", "up")).toEqual(["root", "first", "second", "other-root"]);
    expect(moveOutlineNode(nodes, "other-root", "up")).toEqual(["other-root", "root", "first", "second"]);
  });

  it("replaces a canonical record immutably", () => {
    const records = [{ id: "one", title: "Old" }, { id: "two", title: "Keep" }];
    const replaced = replaceCanonicalRecord(records, { id: "one", title: "New" });

    expect(replaced).toEqual([{ id: "one", title: "New" }, { id: "two", title: "Keep" }]);
    expect(records[0].title).toBe("Old");
    expect(replaced).not.toBe(records);
  });
});
