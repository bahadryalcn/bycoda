import { describe, expect, it } from "vitest";
import { leaf, leafIds, splitPane, type LayoutNode } from "./layout";
import {
  LAYOUT_PRESETS,
  arrangeLayout,
  detectLayoutPreset,
  layoutFromLeafIds,
  type LayoutPreset,
} from "./layoutPresets";

const ARRANGEMENTS: LayoutPreset[] = ["columns", "rows", "grid", "main-left", "main-top"];

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

/** Same shape, sizes and leaves; split ids replaced so trees compare. */
function shape(node: LayoutNode): unknown {
  if (node.type === "leaf") return node.id;
  return {
    dir: node.dir,
    sizes: node.sizes.map((s) => Math.round(s * 1e6) / 1e6),
    children: node.children.map(shape),
  };
}

function checkSizes(node: LayoutNode) {
  if (node.type === "leaf") return;
  expect(node.children).toHaveLength(node.sizes.length);
  expect(node.children.length).toBeGreaterThanOrEqual(2);
  expect(node.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  node.children.forEach(checkSizes);
}

function fromIds(list: string[]): LayoutNode {
  let tree = leaf(list[0]);
  for (let i = 1; i < list.length; i++) {
    tree = splitPane(tree, list[i - 1], "right", list[i]);
  }
  return tree;
}

describe("LAYOUT_PRESETS", () => {
  it("lists every preset once with labels", () => {
    expect(LAYOUT_PRESETS.map((p) => p.id)).toEqual([
      "columns",
      "rows",
      "grid",
      "main-left",
      "main-top",
      "equalize",
    ]);
    for (const preset of LAYOUT_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.description).toBeTruthy();
    }
  });
});

describe("arrangeLayout", () => {
  it("returns a single leaf unchanged for every preset", () => {
    const only = leaf("a");
    for (const { id } of LAYOUT_PRESETS) {
      expect(arrangeLayout(only, id)).toEqual(only);
    }
  });

  it("columns: one right split with equal sizes", () => {
    const out = arrangeLayout(fromIds(ids(3)), "columns");
    expect(shape(out)).toEqual({
      dir: "right",
      sizes: [1 / 3, 1 / 3, 1 / 3].map((s) => Math.round(s * 1e6) / 1e6),
      children: ["p1", "p2", "p3"],
    });
  });

  it("rows: one down split with equal sizes", () => {
    const out = arrangeLayout(fromIds(ids(2)), "rows");
    expect(shape(out)).toEqual({
      dir: "down",
      sizes: [0.5, 0.5],
      children: ["p1", "p2"],
    });
  });

  it("grid: 2 panes sit in one row", () => {
    expect(shape(arrangeLayout(fromIds(ids(2)), "grid"))).toEqual({
      dir: "right",
      sizes: [0.5, 0.5],
      children: ["p1", "p2"],
    });
  });

  it("grid: 3 panes make a short last row", () => {
    expect(shape(arrangeLayout(fromIds(ids(3)), "grid"))).toEqual({
      dir: "down",
      sizes: [0.5, 0.5],
      children: [{ dir: "right", sizes: [0.5, 0.5], children: ["p1", "p2"] }, "p3"],
    });
  });

  it("grid: 4 panes make 2x2", () => {
    const out = arrangeLayout(fromIds(ids(4)), "grid");
    expect(out.type === "split" && out.dir).toBe("down");
    expect(shape(out)).toEqual({
      dir: "down",
      sizes: [0.5, 0.5],
      children: [
        { dir: "right", sizes: [0.5, 0.5], children: ["p1", "p2"] },
        { dir: "right", sizes: [0.5, 0.5], children: ["p3", "p4"] },
      ],
    });
  });

  it("grid: 5 and 7 panes use three columns", () => {
    const five = arrangeLayout(fromIds(ids(5)), "grid");
    if (five.type !== "split") throw new Error("expected split");
    expect(five.children.map((c) => leafIds(c).length)).toEqual([3, 2]);
    const seven = arrangeLayout(fromIds(ids(7)), "grid");
    if (seven.type !== "split") throw new Error("expected split");
    expect(seven.children.map((c) => leafIds(c).length)).toEqual([3, 3, 1]);
    expect(seven.children[2]).toEqual(leaf("p7"));
  });

  it("main-left: focused pane takes 60% on the left, rest stacked", () => {
    const out = arrangeLayout(fromIds(ids(4)), "main-left", "p3");
    expect(shape(out)).toEqual({
      dir: "right",
      sizes: [0.6, 0.4],
      children: [
        "p3",
        {
          dir: "down",
          sizes: [1 / 3, 1 / 3, 1 / 3].map((s) => Math.round(s * 1e6) / 1e6),
          children: ["p1", "p2", "p4"],
        },
      ],
    });
  });

  it("main-top: focused pane takes 60% on top, rest in a row", () => {
    const out = arrangeLayout(fromIds(ids(3)), "main-top", "p2");
    expect(shape(out)).toEqual({
      dir: "down",
      sizes: [0.6, 0.4],
      children: ["p2", { dir: "right", sizes: [0.5, 0.5], children: ["p1", "p3"] }],
    });
  });

  it("main presets fall back to the first pane without a valid focus", () => {
    const tree = fromIds(ids(3));
    for (const focus of [undefined, "missing"]) {
      const out = arrangeLayout(tree, "main-left", focus);
      if (out.type !== "split") throw new Error("expected split");
      expect(out.children[0]).toEqual(leaf("p1"));
    }
  });

  it("main presets with 2 panes put the other pane alone", () => {
    const out = arrangeLayout(fromIds(ids(2)), "main-left", "p2");
    expect(shape(out)).toEqual({
      dir: "right",
      sizes: [0.6, 0.4],
      children: ["p2", "p1"],
    });
  });

  it("equalize keeps structure and resets sizes", () => {
    const uneven: LayoutNode = {
      type: "split",
      id: "root",
      dir: "right",
      sizes: [0.7, 0.3],
      children: [
        leaf("a"),
        {
          type: "split",
          id: "inner",
          dir: "down",
          sizes: [0.9, 0.05, 0.05],
          children: [leaf("b"), leaf("c"), leaf("d")],
        },
      ],
    };
    const out = arrangeLayout(uneven, "equalize");
    if (out.type !== "split") throw new Error("expected split");
    expect(out.id).toBe("root");
    expect(out.sizes).toEqual([0.5, 0.5]);
    const inner = out.children[1];
    if (inner.type !== "split") throw new Error("expected split");
    expect(inner.id).toBe("inner");
    expect(inner.dir).toBe("down");
    checkSizes(out);
    expect(inner.sizes.every((s) => Math.abs(s - 1 / 3) < 1e-9)).toBe(true);
    expect(leafIds(out)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not mutate its input", () => {
    const tree = fromIds(ids(4));
    const copy = structuredClone(tree);
    for (const { id } of LAYOUT_PRESETS) arrangeLayout(tree, id, "p2");
    expect(tree).toEqual(copy);
  });

  for (const n of [2, 3, 4, 5, 7]) {
    describe(`${n} leaves`, () => {
      for (const preset of ARRANGEMENTS) {
        it(`${preset}: keeps ids and order, sizes sum to 1, idempotent, detects`, () => {
          const tree = fromIds(ids(n));
          const out = arrangeLayout(tree, preset, "p1");
          const expectedOrder = preset === "main-left" || preset === "main-top" ? ids(n) : ids(n);
          expect(leafIds(out)).toEqual(expectedOrder);
          expect(new Set(leafIds(out)).size).toBe(n);
          checkSizes(out);
          expect(shape(arrangeLayout(out, preset, "p1"))).toEqual(shape(out));
          expect(detectLayoutPreset(out)).toBe(
            // 2-pane grid is the same picture as columns.
            preset === "grid" && n === 2 ? "columns" : preset,
          );
        });
      }

      it("equalize on an uneven tree is detected and stable", () => {
        const out = arrangeLayout(fromIds(ids(n)), "equalize");
        checkSizes(out);
        expect(shape(arrangeLayout(out, "equalize"))).toEqual(shape(out));
      });
    });
  }

  it("keeps the root split id and preserves other leaf ids", () => {
    const tree = fromIds(["x", "y", "z"]);
    if (tree.type !== "split") throw new Error("expected split");
    for (const preset of ARRANGEMENTS) {
      const out = arrangeLayout(tree, preset);
      if (out.type !== "split") throw new Error("expected split");
      expect(out.id).toBe(tree.id);
      expect([...leafIds(out)].sort()).toEqual(["x", "y", "z"]);
    }
  });

  it("generates unique ids for new nested splits", () => {
    const out = arrangeLayout(fromIds(ids(7)), "grid");
    const found: string[] = [];
    const walk = (n: LayoutNode) => {
      if (n.type === "split") {
        found.push(n.id);
        n.children.forEach(walk);
      }
    };
    walk(out);
    expect(new Set(found).size).toBe(found.length);
  });

  it("main preset leaves the focused pane at the head of the leaf order", () => {
    const out = arrangeLayout(fromIds(ids(4)), "main-top", "p4");
    expect(leafIds(out)).toEqual(["p4", "p1", "p2", "p3"]);
  });
});

describe("layoutFromLeafIds", () => {
  it("builds each preset from scratch", () => {
    expect(layoutFromLeafIds(["a"], "grid")).toEqual(leaf("a"));
    for (const preset of ARRANGEMENTS) {
      const out = layoutFromLeafIds(ids(5), preset, "p2");
      checkSizes(out);
      expect([...leafIds(out)].sort()).toEqual(ids(5));
      expect(detectLayoutPreset(out)).toBe(preset);
    }
  });

  it("honours focus for main-left", () => {
    const out = layoutFromLeafIds(["a", "b", "c"], "main-left", "c");
    expect(leafIds(out)).toEqual(["c", "a", "b"]);
  });

  it("treats equalize as columns and drops duplicate ids", () => {
    const out = layoutFromLeafIds(["a", "b", "a"], "equalize");
    expect(detectLayoutPreset(out)).toBe("columns");
    expect(leafIds(out)).toEqual(["a", "b"]);
  });

  it("rejects an empty list", () => {
    expect(() => layoutFromLeafIds([], "columns")).toThrow();
  });
});

describe("detectLayoutPreset", () => {
  it("returns null for a lone leaf", () => {
    expect(detectLayoutPreset(leaf("a"))).toBeNull();
  });

  it("returns null for custom sizes", () => {
    const out = arrangeLayout(fromIds(ids(3)), "columns");
    if (out.type !== "split") throw new Error("expected split");
    expect(detectLayoutPreset({ ...out, sizes: [0.5, 0.3, 0.2] })).toBeNull();
  });

  it("returns null for a main layout with a dragged sash", () => {
    const out = arrangeLayout(fromIds(ids(3)), "main-left");
    if (out.type !== "split") throw new Error("expected split");
    expect(detectLayoutPreset({ ...out, sizes: [0.7, 0.3] })).toBeNull();
  });

  it("returns null for an uneven nested tree", () => {
    const tree = splitPane(fromIds(["a", "b"]), "a", "down", "c");
    if (tree.type !== "split") throw new Error("expected split");
    expect(detectLayoutPreset({ ...tree, sizes: [0.7, 0.3] })).toBeNull();
  });

  it("reports equalize for an equal irregular tree", () => {
    const tree = arrangeLayout(splitPane(fromIds(["a", "b"]), "a", "down", "c"), "equalize");
    expect(detectLayoutPreset(tree)).toBe("equalize");
  });
});
