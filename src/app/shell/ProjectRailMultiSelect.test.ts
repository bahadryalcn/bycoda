// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectRail } from "./ProjectRail";
import {
  applyRemoteProjectRecords,
  remoteOnlyProjects,
  setLocalHostEnvironmentId,
} from "../../features/sync/model/syncProjects";
import { hostProjectId } from "../../features/sync/model/syncProjectId";
import { loadProjectRailOrder, saveProjectRailOrder } from "../../features/projects/model/recents";
import {
  loadProjectGroupAssignments,
  saveProjectGroups,
} from "../../features/projects/model/projectGroups";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
  useProjectsDiffStats: () => new Map(),
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/projects/model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 0),
}));

it("removes an unopened synced suggestion through its context menu without opening it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  setLocalHostEnvironmentId("env-own");
  const path = "/srv/gmail-plugin-gmail-openai-curated-remote";
  const projectId = hostProjectId("env-other", path);
  applyRemoteProjectRecords("test-host", [
    {
      table: "projectPath",
      id: projectId,
      rev: 1,
      value: { projectId, path, hostEnvironmentId: "env-other", archived: false },
    },
  ]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onOpenSyncedProject = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "~",
          recents: [],
          onSelectProject: vi.fn(),
          onOpenProject: vi.fn(),
          onOpenSyncedProject,
        }),
      ),
    );
    const suggestion = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "gmail-plugin-gmail-openai-curated-remote",
    )!;
    expect(suggestion).toBeDefined();
    act(() => suggestion.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    const remove = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (button) => button.textContent?.includes("Remove"),
    )!;
    act(() => remove.click());
    expect(onOpenSyncedProject).not.toHaveBeenCalled();
    expect(remoteOnlyProjects()).toEqual([]);
    expect(container.textContent).not.toContain("gmail-plugin-gmail-openai-curated-remote");
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("connects modifier selection, checkboxes, ordering and group moves to real project rows", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saveProjectRailOrder(["/a", "/b", "/c"]);
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSelectProject = vi.fn();
  const onRemoveProject = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "/a",
          recents: ["/a", "/b", "/c"].map((path) => ({ path, openedAt: 1 })),
          onSelectProject,
          onOpenProject: vi.fn(),
          onRemoveProject,
        }),
      ),
    );
    const row = (path: string) =>
      container.querySelector<HTMLElement>(`[data-project-path="${path}"]`)!;
    expect(container.querySelector("[data-project-selection-toolbar]")).toBeNull();
    expect(container.querySelector('button[aria-label="Select projects"]')).toBeNull();
    act(() => row("/b").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    act(() =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((element) => element.textContent === "Select")!
        .click(),
    );
    expect(onSelectProject).not.toHaveBeenCalled();
    expect(row("/b").querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    act(() => row("/c").querySelector<HTMLInputElement>("input")!.click());
    expect(row("/c").dataset.multiSelected).toBe("true");
    const button = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (element) => element.textContent === label || element.getAttribute("aria-label") === label,
      )!;
    act(() => row("/b").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    act(() => button("Move up").click());
    expect(loadProjectRailOrder()).toEqual(["/b", "/c", "/a"]);
    act(() => row("/b").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    act(() => button("Move to group").click());
    act(() =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((element) => element.textContent === "Team")!
        .click(),
    );
    expect(loadProjectGroupAssignments()).toEqual({
      "/b": "team",
      "/c": "team",
    });
    expect(row("/b").querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    act(() =>
      row("/b")
        .querySelector("button")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    act(() => row("/a").querySelector("button")!.click());
    expect(onSelectProject).toHaveBeenCalledWith("/a");
    act(() => row("/b").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    act(() => button("Select").click());
    act(() => row("/b").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    act(() => button("Select all").click());
    act(() => row("/b").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await act(async () => button("Delete selected").click());
    expect(onRemoveProject).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Their folders on disk stay put.");
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.textContent === "Delete",
    )!;
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    expect(onRemoveProject.mock.calls.map(([path]) => path)).toEqual(["/b", "/c", "/a"]);
    expect(onRemoveProject.mock.calls.every(([, options]) => options.purgeData)).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
