import { describe, expect, it } from "vitest";
import { newTab } from "../../../features/workspace/model/layout";
import type { LinkedWorkItemPanelState } from "../helpers/types";
import { pruneLinkedWorkItemPanels } from "./usePruneLinkedWorkItemPanels";

const panel = {} as LinkedWorkItemPanelState;

describe("pruneLinkedWorkItemPanels", () => {
  it("returns the same map when every panel's session is in an open tab", () => {
    const panels = new Map([["a", panel]]);
    expect(pruneLinkedWorkItemPanels(panels, [newTab("a")])).toBe(panels);
  });

  it("drops panels whose session left every open tab", () => {
    const panels = new Map([
      ["a", panel],
      ["b", panel],
    ]);
    const pruned = pruneLinkedWorkItemPanels(panels, [newTab("a")]);
    expect([...pruned.keys()]).toEqual(["a"]);
  });
});
