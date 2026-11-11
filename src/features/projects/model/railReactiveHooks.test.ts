// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveTabGroupColor,
  saveTabGroupCustomColor,
  saveTabGroupMascot,
  useResolvedTabGroupLogos,
  useTabGroupColors,
  useTabGroupCustomColors,
} from "../../workspace/model/tabGroups";
import { additionalDirCandidates, additionalDirCandidatesFrom } from "./additionalDirs";
import {
  saveProjectGroupAssignments,
  saveProjectGroups,
  useProjectGroupAssignments,
} from "./projectGroups";
import {
  loadRecents,
  projectRailItems,
  projectRailItemsFrom,
  saveProjectRailOrder,
  savePinnedProjects,
  useProjectRailLayout,
} from "./recents";

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function probe<T>(read: () => T) {
  const seen: T[] = [];
  function Probe() {
    seen.push(read());
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return { seen, rerender: () => act(() => root.render(createElement(Probe))) };
}

const recents = [
  { path: "/work/web", openedAt: 30 },
  { path: "/work/api", openedAt: 20 },
  { path: "/work/ui", openedAt: 10 },
];

describe("useProjectRailLayout", () => {
  it("follows the saved order and pins, and keeps its identity otherwise", () => {
    const { seen, rerender } = probe(useProjectRailLayout);
    expect(seen.at(-1)).toEqual({ order: [], pinned: [] });
    rerender();
    expect(seen.at(-1)).toBe(seen.at(-2));
    act(() => saveProjectRailOrder(["/work/ui", "/work/web"]));
    expect(seen.at(-1)?.order).toEqual(["/work/ui", "/work/web"]);
    act(() => savePinnedProjects(["/work/api"]));
    expect(seen.at(-1)).toEqual({ order: ["/work/ui", "/work/web"], pinned: ["/work/api"] });
  });

  it("projectRailItemsFrom matches projectRailItems", () => {
    saveProjectRailOrder(["/work/ui", "/work/web"]);
    savePinnedProjects(["/work/api"]);
    const { seen } = probe(useProjectRailLayout);
    const layout = seen.at(-1)!;
    for (const cwd of ["/work/web", "", "/work/new"])
      expect(projectRailItemsFrom(recents, cwd, layout).map((item) => item.path)).toEqual(
        projectRailItems(recents, cwd).map((item) => item.path),
      );
  });
});

describe("useProjectGroupAssignments", () => {
  it("follows saved groups and assignments, and keeps its identity otherwise", () => {
    const { seen, rerender } = probe(useProjectGroupAssignments);
    expect(seen.at(-1)).toEqual({});
    rerender();
    expect(seen.at(-1)).toBe(seen.at(-2));
    act(() => {
      saveProjectGroups([{ id: "g1", name: "Group", collapsed: false }]);
      saveProjectGroupAssignments({ "/work/web": "g1" });
    });
    expect(seen.at(-1)).toEqual({ "/work/web": "g1" });
  });

  it("additionalDirCandidatesFrom matches additionalDirCandidates", () => {
    localStorage.setItem("bycoda.recentProjects", JSON.stringify(recents));
    saveProjectGroups([{ id: "g1", name: "Group", collapsed: false }]);
    saveProjectGroupAssignments({ "/work/web": "g1", "/work/api": "g1" });
    const { seen } = probe(useProjectGroupAssignments);
    expect(additionalDirCandidatesFrom("/work/web", loadRecents(), seen.at(-1)!)).toEqual(
      additionalDirCandidates("/work/web"),
    );
  });
});

describe("tab group appearance hooks", () => {
  it("useTabGroupColors and useTabGroupCustomColors follow saved colors", () => {
    const { seen, rerender } = probe(() => ({
      indices: useTabGroupColors(),
      custom: useTabGroupCustomColors(),
    }));
    rerender();
    expect(seen.at(-1)?.indices).toBe(seen.at(-2)?.indices);
    act(() => saveTabGroupColor("/work/web", 2));
    expect(seen.at(-1)?.indices).toEqual({ "/work/web": 2 });
    act(() => saveTabGroupCustomColor("/work/web", "#AABBCC"));
    expect(seen.at(-1)?.custom).toEqual({ "/work/web": "#aabbcc" });
    expect(seen.at(-1)?.indices).toEqual({});
  });

  it("useResolvedTabGroupLogos follows logos and mascots", () => {
    const logos = { "/work/web": "/logos/web.png" };
    const { seen } = probe(() => useResolvedTabGroupLogos(["/work/web", "/work/api"], logos));
    expect(seen.at(-1)).toEqual({ "/work/web": "/logos/web.png", "/work/api": null });
    act(() => saveTabGroupMascot("/work/web", "fox"));
    expect(seen.at(-1)).toEqual({ "/work/web": "/logos/web.png", "/work/api": null });
  });
});
