import { describe, expect, it } from "vitest";
import { newTab, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { resolveMaximizedPane } from "./useMaximizedPane";

function splitTab(): WorkspaceTab {
  const tab = newTab("a");
  return {
    ...tab,
    layout: {
      type: "split",
      id: "s",
      dir: "right",
      sizes: [1, 1],
      children: [
        { type: "leaf", id: "a" },
        { type: "leaf", id: "b" },
      ],
    },
  };
}

describe("resolveMaximizedPane", () => {
  it("keeps a valid maximized pane and null", () => {
    const tab = splitTab();
    const state = { tabId: tab.id, paneId: "a" };
    expect(resolveMaximizedPane(state, [tab])).toBe(state);
    expect(resolveMaximizedPane(null, [tab])).toBeNull();
  });

  it("clears the pane when its tab or leaf is gone", () => {
    const tab = splitTab();
    expect(resolveMaximizedPane({ tabId: "missing", paneId: "a" }, [tab])).toBeNull();
    expect(resolveMaximizedPane({ tabId: tab.id, paneId: "gone" }, [tab])).toBeNull();
  });

  it("follows focus to another pane of the same tab", () => {
    const tab = { ...splitTab(), focusedId: "b" };
    expect(resolveMaximizedPane({ tabId: tab.id, paneId: "a" }, [tab])).toEqual({
      tabId: tab.id,
      paneId: "b",
    });
  });
});
