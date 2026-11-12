// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GitGraphList, type GraphListItem, type GraphVariant } from "./GitGraphList";

const renders = vi.hoisted(() => vi.fn());
vi.mock("./GitGraphParts", () => ({
  GraphAvatar: () => null,
  RefPills: () => null,
  GraphLane: ({ row }: { row: { sha: string } }) => {
    renders(row.sha);
    return null;
  },
}));
vi.mock("./GitGraphHoverCard", () => ({ GitGraphHoverCard: () => null }));
vi.mock("../../../shared/ui/HoverCard", () => ({
  useHoverCard: () => ({ trigger: {}, close: () => {}, card: () => null }),
}));

it.each<GraphVariant>(["compact", "wide", "workspace"])(
  "renders only changed %s rows while preserving navigation and current callbacks",
  async (variant) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const items: GraphListItem[] = ["a", "b", "c"].map((sha) => ({
      commit: {
        sha,
        shortSha: sha,
        subject: sha,
        author: "Ada",
        timestamp: 1,
        parents: [],
        head: false,
        refs: [],
      },
      row: { sha, parentIds: [], kind: "node", inputSwimlanes: [], outputSwimlanes: [], refs: [] },
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const open = vi.fn(),
      menu = vi.fn(),
      latest = vi.fn();
    const props = {
      variant,
      items,
      plain: false,
      hasMore: false,
      suspendHover: false,
      onLoadMore: () => {},
      onOpen: open,
      onMenu: menu,
    };
    try {
      await act(async () => root.render(createElement(GitGraphList, props)));
      renders.mockClear();
      await act(async () =>
        root.render(
          createElement(GitGraphList, {
            ...props,
            selectedSha: "b",
            onOpen: latest,
            onMenu: (...args) => menu(...args),
          }),
        ),
      );
      expect(renders.mock.calls.map(([sha]) => sha)).toEqual(["b"]);
      renders.mockClear();
      await act(async () =>
        root.render(createElement(GitGraphList, { ...props, selectedSha: "c" })),
      );
      expect(renders.mock.calls.map(([sha]) => sha)).toEqual(["b", "c"]);
      const buttons = container.querySelectorAll<HTMLButtonElement>("button.git-history-item");
      await act(async () => {
        buttons[0].click();
        buttons[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
      expect(open).toHaveBeenCalledWith(items[0].commit, undefined);
      expect(open).toHaveBeenCalledWith(items[0].commit, true);
      await act(async () =>
        buttons[1].dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 9 }),
        ),
      );
      expect(menu).toHaveBeenCalledWith(5, 9, items[1].commit);
      buttons[0].focus();
      buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(document.activeElement).toBe(buttons[1]);
      buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(document.activeElement).toBe(buttons[0]);
      await act(async () => root.render(createElement(GitGraphList, { ...props, onOpen: latest })));
      await act(async () => buttons[0].click());
      expect(latest).toHaveBeenCalledWith(items[0].commit, undefined);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
