// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  leaf,
  leafIds,
  layoutLeaves,
  movePane,
  placePane,
  placeLayout,
  removePane,
  selectPaneTab,
  splitPane,
  splitPaneAtSelfEdge,
  paneEdgeFromPoint,
  newTab,
  siblingLeafId,
  closeLeaf,
} from "./layout";
import {
  arrangeLayout,
  arrangeSuggestedLayout,
  suggestedPaneCount,
  type LayoutPreset,
} from "./layoutPresets";
import { collectWorkspaceSnapshot, hydrateWorkspaceSnapshot } from "./workspaceSnapshot";
import { newSession } from "../../sessions/model/session";

describe("local pane docking groups", () => {
  it.each(["left", "right", "top", "bottom"] as const)(
    "places the original session at its own %s edge with a distinct empty pane",
    (edge) => {
      const tree = splitPaneAtSelfEdge(leaf("a"), "a", edge, "empty");
      const leaves = layoutLeaves(tree);
      expect(leafIds(tree)).toHaveLength(2);
      const before = edge === "left" || edge === "top";
      expect(leaves.map((pane) => pane.id)).toEqual(before ? ["a", "empty"] : ["empty", "a"]);
      expect(tree).toMatchObject({
        type: "split",
        dir: edge === "left" || edge === "right" ? "right" : "down",
      });
      expect(splitPaneAtSelfEdge(tree, "a", "center", "unused")).toBe(tree);
    },
  );

  it.each(["columns", "rows", "grid", "main-left", "main-top"] as LayoutPreset[])(
    "creates a useful %s suggestion from one grouped pane",
    (preset) => {
      const group = placePane(leaf("a"), "b", "a", "center");
      const count = suggestedPaneCount(preset);
      const empty = Array.from({ length: count - 1 }, (_, index) => `empty-${index}`);
      const tree = arrangeSuggestedLayout(group, preset, empty, "b");
      expect(layoutLeaves(tree)).toHaveLength(count);
      expect(layoutLeaves(tree)[0]?.tabIds).toEqual(["a", "b"]);
      expect(leafIds(tree)).toEqual(["a", "b", ...empty]);
    },
  );
  it("focuses a sibling in the same group instead of an unrelated earlier group", () => {
    const firstGroup = placePane(leaf("a"), "b", "a", "center");
    const secondGroup = placePane(leaf("c"), "d", "c", "center");
    const tree = {
      type: "split" as const,
      id: "root",
      dir: "right" as const,
      children: [
        firstGroup,
        {
          type: "split" as const,
          id: "nested",
          dir: "down" as const,
          children: [secondGroup, leaf("e")],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.5, 0.5],
    };
    expect(siblingLeafId(tree, "d")).toBe("c");
    expect(closeLeaf({ ...newTab("d"), layout: tree }, "d")?.focusedId).toBe("c");
  });
  it("groups center drops without making a split or losing hidden session ids", () => {
    const tree = movePane(splitPane(leaf("a"), "a", "right", "b"), "b", "a", "center");
    expect(tree).toEqual({ type: "leaf", id: "b", tabIds: ["a", "b"] });
    expect(leafIds(tree)).toEqual(["a", "b"]);
    expect(layoutLeaves(tree)).toHaveLength(1);
    expect(selectPaneTab(tree, "a")).toMatchObject({
      id: "a",
      tabIds: ["a", "b"],
    });
  });

  it("splits an individual tab out of its own local group", () => {
    const tree = placePane(leaf("a"), "b", "a", "center");
    const next = movePane(tree, "b", "a", "bottom");
    expect(layoutLeaves(next).map((pane) => pane.id)).toEqual(["a", "b"]);
    expect(next).toMatchObject({ type: "split", dir: "down" });
  });

  it("closes only the chosen group member and keeps a valid active selection", () => {
    const tree = placePane(placePane(leaf("a"), "b", "a", "center"), "c", "b", "center");
    expect(removePane(tree, "b")).toEqual({
      type: "leaf",
      id: "c",
      tabIds: ["a", "c"],
    });
    expect(removePane(removePane(tree, "b")!, "c")).toEqual(leaf("a"));
  });

  it("groups all sessions from an incoming split without losing ids", () => {
    const tree = placeLayout(leaf("a"), splitPane(leaf("b"), "b", "right", "c"), "a", "center");
    expect(leafIds(tree)).toEqual(["a", "b", "c"]);
    expect(layoutLeaves(tree)).toHaveLength(1);
  });

  it("reorders a tab within its local group and inserts into another group at the indicated position", () => {
    const group = placePane(placePane(leaf("a"), "b", "a", "center"), "c", "b", "center");
    const reordered = movePane(group, "c", "a", "center", "before");
    expect(leafIds(reordered)).toEqual(["c", "a", "b"]);
    expect(reordered).toMatchObject({ id: "c" });
    const second = placePane(leaf("d"), "e", "d", "center");
    const joined = placeLayout(second, reordered, "d", "center", "before");
    expect(leafIds(joined)).toEqual(["c", "a", "b", "d", "e"]);
    expect(new Set(leafIds(joined)).size).toBe(5);
  });

  it("preserves local groups while arranging visible panes", () => {
    const group = placePane(leaf("a"), "b", "a", "center");
    const tree = splitPane(group, "b", "right", "c");
    const arranged = arrangeLayout(tree, "rows", "a");
    expect(layoutLeaves(arranged)).toHaveLength(2);
    expect(layoutLeaves(arranged)[0]?.tabIds).toEqual(["a", "b"]);
    expect(leafIds(arranged)).toEqual(["a", "b", "c"]);
  });

  it("restores grouped members and the selected member after a restart", () => {
    const a = { ...newSession("codex", "/repo"), id: "a" };
    const b = { ...newSession("codex", "/repo"), id: "b" };
    const tab = {
      ...newTab("a"),
      layout: placePane(leaf("a"), "b", "a", "center"),
      focusedId: "b",
    };
    const snapshot = collectWorkspaceSnapshot([tab], [a, b], tab.id, "/repo", new Map());
    const restored = hydrateWorkspaceSnapshot(JSON.parse(JSON.stringify(snapshot)), new Map());
    expect(restored?.tabs[0]?.layout).toEqual(tab.layout);
    expect(restored?.sessions.map((session) => session.id)).toEqual(["a", "b"]);
  });

  it("distinguishes a central tab target from the four split edges", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(paneEdgeFromPoint(50, 50, rect)).toBe("center");
    expect(paneEdgeFromPoint(5, 50, rect)).toBe("left");
    expect(paneEdgeFromPoint(95, 50, rect)).toBe("right");
    expect(paneEdgeFromPoint(50, 5, rect)).toBe("top");
    expect(paneEdgeFromPoint(50, 95, rect)).toBe("bottom");
  });
});
