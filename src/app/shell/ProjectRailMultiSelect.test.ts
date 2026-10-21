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
  isTauri: () => false,
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

it("collapses Groups and Projects independently and restores their saved state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const onOpenProject = vi.fn();
  const render = async () =>
    act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "/a",
          recents: [{ path: "/a", openedAt: 1 }],
          onSelectProject: vi.fn(),
          onOpenProject,
        }),
      ),
    );
  const toggle = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
      (button) => button.textContent === label,
    )!;
  const body = (label: string) => toggle(label).parentElement!.nextElementSibling as HTMLElement;
  try {
    await render();
    expect(toggle("Groups").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("true");
    act(() => toggle("Groups").click());
    expect(body("Groups").hidden).toBe(true);
    expect(body("Projects").hidden).toBe(false);
    act(() => toggle("Projects").click());
    expect(body("Projects").hidden).toBe(true);
    expect(toggle("Projects").getAttribute("aria-expanded")).toBe("false");
    // The add action stays available and does not reopen the section.
    const add = container.querySelector<HTMLButtonElement>('button[aria-label="Open project"]')!;
    act(() => add.click());
    expect(add.getAttribute("aria-expanded")).toBe("true");
    expect(body("Projects").hidden).toBe(true);
    act(() => add.click());
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(body("Groups").hidden).toBe(true);
    expect(body("Projects").hidden).toBe(true);
    act(() => toggle("Groups").click());
    expect(body("Groups").hidden).toBe(false);
    expect(body("Projects").hidden).toBe(true);
    act(() => toggle("Projects").click());
    expect(body("Projects").hidden).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([
  { modifier: "shiftKey", start: "/a", target: "/c", selected: ["/a", "/b", "/c"] },
  { modifier: "shiftKey", start: "/c", target: "/a", selected: ["/a", "/b", "/c"] },
  { modifier: "ctrlKey", start: "/a", target: "/c", selected: ["/a", "/c"] },
  { modifier: "metaKey", start: "/a", target: "/c", selected: ["/a", "/c"] },
])(
  "uses the last normal click on $start for the first $modifier click on $target",
  async ({ modifier, start, target, selected }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    const paths = ["/a", "/b", "/c"];
    saveProjectRailOrder(paths);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onSelectProject = vi.fn();
    try {
      await act(async () =>
        root.render(
          createElement(ProjectRail, {
            cwd: "/b",
            recents: paths.map((path) => ({ path, openedAt: 1 })),
            onSelectProject,
            onOpenProject: vi.fn(),
          }),
        ),
      );
      const row = (path: string) =>
        container.querySelector<HTMLElement>(`[data-project-path="${path}"]`)!;
      // Navigation stays a normal single-project action until a modifier is used.
      act(() => row("/b").querySelector("button")!.click());
      act(() => row(start).querySelector("button")!.click());
      expect(onSelectProject).toHaveBeenLastCalledWith(start);
      expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
      onSelectProject.mockClear();
      act(() =>
        row(target)
          .querySelector("button")!
          .dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              [modifier]: true,
            }),
          ),
      );
      expect(paths.filter((path) => row(path).dataset.multiSelected === "true")).toEqual(selected);
      expect(onSelectProject).not.toHaveBeenCalled();
      // Escape clears both the selection and its previous navigation anchor.
      act(() =>
        row(target)
          .querySelector("button")!
          .dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
            }),
          ),
      );
      act(() =>
        row(target)
          .querySelector("button")!
          .dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              [modifier]: true,
            }),
          ),
      );
      expect(paths.filter((path) => row(path).dataset.multiSelected === "true")).toEqual([target]);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);

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

it.each([
  { modifier: "ctrlKey", start: 0, target: 2, selected: [0, 2] },
  { modifier: "metaKey", start: 0, target: 2, selected: [0, 2] },
  { modifier: "shiftKey", start: 0, target: 2, selected: [0, 1, 2] },
  { modifier: "shiftKey", start: 2, target: 0, selected: [0, 1, 2] },
])(
  "selects synced suggestions with $modifier and removes only the selection",
  async ({ modifier, start, target, selected }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    setLocalHostEnvironmentId("env-own");
    // Duplicate names on different machines must remain separately selectable.
    const projects = [0, 1, 2, 3].map((index) => {
      const path = "/srv/same-name";
      const hostEnvironmentId = `env-other-${index}`;
      return {
        projectId: hostProjectId(hostEnvironmentId, path),
        path,
        hostEnvironmentId,
        archived: false,
      };
    });
    applyRemoteProjectRecords(
      "test-host",
      projects.map((value) => ({
        table: "projectPath" as const,
        id: value.projectId,
        rev: 1,
        value,
      })),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onOpenSyncedProject = vi.fn();
    const onRemoveProject = vi.fn();
    try {
      await act(async () =>
        root.render(
          createElement(ProjectRail, {
            cwd: "~",
            recents: [],
            onSelectProject: vi.fn(),
            onOpenProject: vi.fn(),
            onOpenSyncedProject,
            onRemoveProject,
          }),
        ),
      );
      const rows = () => [
        ...container.querySelectorAll<HTMLButtonElement>("[data-remote-project-id]"),
      ];
      const click = (index: number, key: string) =>
        act(() =>
          rows()[index].dispatchEvent(new MouseEvent("click", { bubbles: true, [key]: true })),
        );
      click(start, "ctrlKey");
      click(target, modifier);
      expect(
        rows().flatMap((row, index) =>
          row.getAttribute("aria-pressed") === "true" ? [index] : [],
        ),
      ).toEqual(selected);
      expect(onOpenSyncedProject).not.toHaveBeenCalled();
      // Clicking again deselects; modifier selection never tries to reconnect.
      click(target, "ctrlKey");
      expect(rows()[target].getAttribute("aria-pressed")).toBe("false");
      click(target, "ctrlKey");
      act(() =>
        rows()[start].dispatchEvent(
          new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }),
        ),
      );
      act(() =>
        [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
          .find((button) => button.textContent?.includes("Remove"))!
          .click(),
      );
      expect(remoteOnlyProjects().map((project) => project.projectId)).toEqual(
        projects
          .filter((_, index) => !selected.includes(index))
          .map((project) => project.projectId),
      );
      expect(rows()).toHaveLength(4 - selected.length);
      expect(onRemoveProject).not.toHaveBeenCalled();
      expect(onOpenSyncedProject).not.toHaveBeenCalled();
      // Ctrl+A stays scoped to the remaining suggestions; Escape restores normal opening.
      act(() =>
        rows()[0].dispatchEvent(
          new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }),
        ),
      );
      expect(rows().every((row) => row.getAttribute("aria-pressed") === "true")).toBe(true);
      act(() =>
        rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      );
      expect(rows().every((row) => row.getAttribute("aria-pressed") === "false")).toBe(true);
      act(() => rows()[0].click());
      expect(onOpenSyncedProject).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);

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
