import type { OutlineNode } from "@/domain/narrative";

export type OutlineTreeNode = {
  node: OutlineNode;
  depth: number;
  children: OutlineTreeNode[];
};

export type SiblingMoveState = {
  canMoveUp: boolean;
  canMoveDown: boolean;
};

function compareNodes(left: OutlineNode, right: OutlineNode) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

function getNormalizedParentId(node: OutlineNode, nodesById: Map<string, OutlineNode>) {
  if (!node.parentId || node.parentId === node.id || !nodesById.has(node.parentId)) {
    return null;
  }

  const visited = new Set<string>([node.id]);
  let cursor: string | null = node.parentId;
  while (cursor) {
    if (visited.has(cursor)) {
      return null;
    }
    visited.add(cursor);
    cursor = nodesById.get(cursor)?.parentId ?? null;
  }
  return node.parentId;
}

function createSiblingGroups(nodes: OutlineNode[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string | null, OutlineNode[]>();

  for (const node of nodes) {
    const parentId = getNormalizedParentId(node, nodesById);
    const siblings = groups.get(parentId) ?? [];
    siblings.push(node);
    groups.set(parentId, siblings);
  }

  for (const siblings of groups.values()) {
    siblings.sort(compareNodes);
  }
  return { groups, nodesById };
}

function flattenSiblingGroups(groups: Map<string | null, OutlineNode[]>) {
  const ordered: OutlineNode[] = [];
  const visited = new Set<string>();

  function visit(node: OutlineNode) {
    if (visited.has(node.id)) {
      return;
    }
    visited.add(node.id);
    ordered.push(node);
    for (const child of groups.get(node.id) ?? []) {
      visit(child);
    }
  }

  for (const root of groups.get(null) ?? []) {
    visit(root);
  }

  // A malformed cycle should remain visible rather than disappearing from the
  // navigator. Any unvisited records become safe top-level orphans.
  for (const siblings of groups.values()) {
    for (const node of siblings) {
      visit(node);
    }
  }

  return ordered;
}

export function projectOutlineTree(nodes: OutlineNode[]): OutlineTreeNode[] {
  const { groups } = createSiblingGroups(nodes);

  function visit(node: OutlineNode, depth: number, path: Set<string>): OutlineTreeNode {
    if (path.has(node.id)) {
      return { node, depth, children: [] };
    }
    const nextPath = new Set(path).add(node.id);
    return {
      node,
      depth,
      children: (groups.get(node.id) ?? []).map((child) => visit(child, depth + 1, nextPath)),
    };
  }

  return (groups.get(null) ?? []).map((node) => visit(node, 0, new Set()));
}

export function toPreOrderIds(nodes: OutlineNode[]) {
  return flattenSiblingGroups(createSiblingGroups(nodes).groups).map((node) => node.id);
}

export function getOutlineDescendantIds(nodes: OutlineNode[], nodeId: string) {
  const { groups } = createSiblingGroups(nodes);
  const descendants: string[] = [];

  function visit(parentId: string) {
    for (const child of groups.get(parentId) ?? []) {
      if (descendants.includes(child.id)) {
        continue;
      }
      descendants.push(child.id);
      visit(child.id);
    }
  }

  visit(nodeId);
  return descendants;
}

export function getOutlineParentChoices(nodes: OutlineNode[], nodeId: string | null) {
  const excluded = nodeId ? new Set([nodeId, ...getOutlineDescendantIds(nodes, nodeId)]) : new Set<string>();
  return nodes.filter((node) => !excluded.has(node.id)).sort(compareNodes);
}

export function getSiblingMoveState(nodes: OutlineNode[], nodeId: string): SiblingMoveState {
  const { groups, nodesById } = createSiblingGroups(nodes);
  const node = nodesById.get(nodeId);
  if (!node) {
    return { canMoveUp: false, canMoveDown: false };
  }
  const parentId = getNormalizedParentId(node, nodesById);
  const siblings = groups.get(parentId) ?? [];
  const index = siblings.findIndex((sibling) => sibling.id === nodeId);
  return {
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < siblings.length - 1,
  };
}

export function moveOutlineNode(nodes: OutlineNode[], nodeId: string, direction: "up" | "down") {
  const { groups, nodesById } = createSiblingGroups(nodes);
  const node = nodesById.get(nodeId);
  if (!node) {
    return toPreOrderIds(nodes);
  }

  const parentId = getNormalizedParentId(node, nodesById);
  const siblings = groups.get(parentId) ?? [];
  const currentIndex = siblings.findIndex((sibling) => sibling.id === nodeId);
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= siblings.length) {
    return flattenSiblingGroups(groups).map((item) => item.id);
  }

  [siblings[currentIndex], siblings[nextIndex]] = [siblings[nextIndex], siblings[currentIndex]];
  return flattenSiblingGroups(groups).map((item) => item.id);
}

export function replaceCanonicalRecord<T extends { id: string }>(records: T[], next: T) {
  return records.map((record) => (record.id === next.id ? next : record));
}
