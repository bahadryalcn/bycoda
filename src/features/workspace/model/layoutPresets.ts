import { leaf, layoutLeaves, splitPane, type LayoutNode, type SplitDir } from "./layout";

/**
 * One-click arrangements for the panes of a tab. Every preset rebuilds the
 * split tree from the existing leaf order and keeps leaf ids untouched; sizes
 * are fractions of the parent group that sum to 1 (same as layout.ts).
 */

export type LayoutPreset = "columns" | "rows" | "grid" | "main-left" | "main-top" | "equalize";

export function suggestedPaneCount(preset: LayoutPreset): number {
  return preset === "grid"
    ? 4
    : preset === "main-left" || preset === "main-top"
      ? 3
      : preset === "equalize"
        ? 1
        : 2;
}

/** A single-pane suggestion creates space to work; existing arrangements only rearrange. */
export function arrangeSuggestedLayout(
  node: LayoutNode,
  preset: LayoutPreset,
  emptyPaneIds: string[],
  focusedId: string,
): LayoutNode {
  let next = node;
  if (layoutLeaves(node).length === 1) {
    let anchorId = focusedId;
    for (const id of emptyPaneIds.slice(0, suggestedPaneCount(preset) - 1)) {
      next = splitPane(next, anchorId, "right", id);
      anchorId = id;
    }
  }
  return arrangeLayout(next, preset, focusedId);
}

export const LAYOUT_PRESETS: {
  id: LayoutPreset;
  label: string;
  description: string;
}[] = [
  {
    id: "columns",
    label: "Columns",
    description: "Every pane side by side",
  },
  {
    id: "rows",
    label: "Rows",
    description: "Every pane stacked top to bottom",
  },
  {
    id: "grid",
    label: "Grid",
    description: "Panes in an even grid",
  },
  {
    id: "main-left",
    label: "Main + Stack",
    description: "Focused pane on the left, the rest stacked on the right",
  },
  {
    id: "main-top",
    label: "Main + Row",
    description: "Focused pane on top, the rest in a row below",
  },
  {
    id: "equalize",
    label: "Equalize Sizes",
    description: "Keep the arrangement, give every pane equal space",
  },
];

const MAIN_SIZE = 0.6;
const EPSILON = 1e-6;

type SplitNode = Extract<LayoutNode, { type: "split" }>;

function equalSizes(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

function split(
  id: string | undefined,
  dir: SplitDir,
  children: LayoutNode[],
  sizes: number[] = equalSizes(children.length),
): LayoutNode {
  if (children.length === 1) return children[0];
  return {
    type: "split",
    id: id ?? crypto.randomUUID(),
    dir,
    children,
    sizes,
  };
}

function leaves(ids: string[]): LayoutNode[] {
  return ids.map((id) => leaf(id));
}

function buildLayout(
  ids: string[],
  preset: Exclude<LayoutPreset, "equalize">,
  focusedId: string | undefined,
  rootId: string | undefined,
): LayoutNode {
  if (ids.length === 0) throw new Error("A layout needs at least one pane.");
  if (ids.length === 1) return leaf(ids[0]);

  if (preset === "columns") return split(rootId, "right", leaves(ids));
  if (preset === "rows") return split(rootId, "down", leaves(ids));

  if (preset === "grid") {
    const cols = Math.ceil(Math.sqrt(ids.length));
    const rows: LayoutNode[] = [];
    for (let i = 0; i < ids.length; i += cols) {
      rows.push(split(undefined, "right", leaves(ids.slice(i, i + cols))));
    }
    if (rows.length === 1) {
      return split(rootId, "right", leaves(ids));
    }
    return split(rootId, "down", rows);
  }

  const main = focusedId && ids.includes(focusedId) ? focusedId : ids[0];
  const rest = ids.filter((id) => id !== main);
  const stackDir: SplitDir = preset === "main-left" ? "down" : "right";
  const rootDir: SplitDir = preset === "main-left" ? "right" : "down";
  return split(
    rootId,
    rootDir,
    [leaf(main), split(undefined, stackDir, leaves(rest))],
    [MAIN_SIZE, 1 - MAIN_SIZE],
  );
}

function equalizeNode(node: LayoutNode): LayoutNode {
  if (node.type === "leaf") return node;
  return {
    ...node,
    children: node.children.map(equalizeNode),
    sizes: equalSizes(node.children.length),
  };
}

/** Rebuild `node` in the chosen arrangement. Leaf ids and their order survive. */
export function arrangeLayout(
  node: LayoutNode,
  preset: LayoutPreset,
  focusedId?: string,
): LayoutNode {
  if (node.type === "leaf") return node;
  if (preset === "equalize") return equalizeNode(node);
  const panes = layoutLeaves(node);
  const activeFocus = panes.find((pane) => pane.tabIds?.includes(focusedId ?? ""))?.id ?? focusedId;
  const arranged = buildLayout(
    panes.map((pane) => pane.id),
    preset,
    activeFocus,
    node.id,
  );
  const restoreGroups = (next: LayoutNode): LayoutNode => {
    if (next.type === "leaf") {
      const pane = panes.find((pane) => pane.id === next.id);
      return pane?.tabIds ? { ...next, tabIds: pane.tabIds } : next;
    }
    return { ...next, children: next.children.map(restoreGroups) };
  };
  return restoreGroups(arranged);
}

/** Fresh layout for several sessions opened at once. */
export function layoutFromLeafIds(
  ids: string[],
  preset: LayoutPreset,
  focusedId?: string,
): LayoutNode {
  const unique = [...new Set(ids)];
  if (preset === "equalize") return buildLayout(unique, "columns", focusedId, undefined);
  return buildLayout(unique, preset, focusedId, undefined);
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

function isEqual(sizes: number[]): boolean {
  return sizes.every((size) => near(size, 1 / sizes.length));
}

function isFlat(node: LayoutNode, dir: SplitDir): node is SplitNode {
  return (
    node.type === "split" &&
    node.dir === dir &&
    node.children.every((child) => child.type === "leaf") &&
    isEqual(node.sizes)
  );
}

function isGrid(node: LayoutNode): boolean {
  if (node.type !== "split" || node.dir !== "down") return false;
  if (!isEqual(node.sizes)) return false;
  const total = layoutLeaves(node).length;
  const cols = Math.ceil(Math.sqrt(total));
  if (node.children.length !== Math.ceil(total / cols)) return false;
  return node.children.every((row, index) => {
    const expected = index < node.children.length - 1 ? cols : total - cols * index;
    if (row.type === "leaf") return expected === 1;
    return isFlat(row, "right") && row.children.length === expected;
  });
}

function isMain(node: LayoutNode, rootDir: SplitDir): boolean {
  if (node.type !== "split" || node.dir !== rootDir) return false;
  if (node.children.length !== 2) return false;
  if (!near(node.sizes[0], MAIN_SIZE) || !near(node.sizes[1], 1 - MAIN_SIZE)) {
    return false;
  }
  const [main, rest] = node.children;
  if (main.type !== "leaf") return false;
  return rest.type === "leaf" || isFlat(rest, rootDir === "right" ? "down" : "right");
}

function allEqual(node: LayoutNode): boolean {
  return node.type === "leaf" || (isEqual(node.sizes) && node.children.every(allEqual));
}

/** Which preset `node` currently matches, or null for a custom arrangement. */
export function detectLayoutPreset(node: LayoutNode): LayoutPreset | null {
  if (node.type === "leaf") return null;
  if (isFlat(node, "right")) return "columns";
  if (isFlat(node, "down")) return "rows";
  if (isGrid(node)) return "grid";
  if (isMain(node, "right")) return "main-left";
  if (isMain(node, "down")) return "main-top";
  return allEqual(node) ? "equalize" : null;
}
