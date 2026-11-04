// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useProjectRailData, type ProjectRailData } from "./useProjectRailData";

vi.mock("../../features/projects/model/recents", () => ({
  loadPinnedProjects: () => [], loadProjectRailOrder: () => [], saveProjectRailOrder: () => {},
  subscribeProjectPathsChanged: () => () => {}, knownProjectPaths: () => [], notifyProjectPathsChanged: () => {},
}));
vi.mock("../../features/projects/model/projectGroups", () => ({
  loadProjectGroups: () => [], loadProjectGroupAssignments: () => ({}),
}));
vi.mock("../../features/sync/model/syncProjects", () => ({ remoteOnlyProjects: () => [] }));

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each([
  ["labels", "groupLabels", "Remote label", "Remote label"],
  ["colors", "groupColors", "2", 2],
  ["custom-colors", "groupCustomColors", "#abcdef", "#abcdef"],
  ["mascots", "groupMascots", "cat", "cat"],
] as const)("refreshes mounted rail for another window's %s change", async (suffix, field, stored, expected) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let observed!: ProjectRailData;
  function Probe() { observed = useProjectRailData(); return null; }
  try {
    await act(async () => root.render(createElement(Probe)));
    const originalOrder = observed.railOrder;
    const key = `bycoda:tab-group:${suffix}`;
    const newValue = JSON.stringify({ "/repo": stored });
    localStorage.setItem(key, newValue);
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key, newValue })); });
    expect(observed[field]["/repo"]).toBe(expected);
    expect(observed.railOrder).toBe(originalOrder);
    localStorage.removeItem(key);
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key, newValue: null })); });
    expect(observed[field]["/repo"]).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
  }
});
