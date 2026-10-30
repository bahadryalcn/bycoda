// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectRail } from "./ProjectRail";
import {
  loadProjectRailOrder,
  savePinnedProjects,
  saveProjectRailOrder,
} from "../../features/projects/model/recents";
import { loadProjectGroups, saveProjectGroups } from "../../features/projects/model/projectGroups";
import { loadRailSectionOrder } from "../../features/projects/model/railSections";

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

async function withRail(run: (helpers: { row: (path: string) => HTMLElement }) => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const paths = ["/a", "/b", "/c"];
  saveProjectRailOrder(paths);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "/b",
          recents: paths.map((path) => ({ path, openedAt: 1 })),
          onSelectProject: vi.fn(),
          onOpenProject: vi.fn(),
        }),
      ),
    );
    run({
      row: (path) => container.querySelector<HTMLElement>(`[data-project-path="${path}"]`)!,
    });
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
}

function altArrow(target: Element, key: "ArrowUp" | "ArrowDown") {
  const event = new KeyboardEvent("keydown", {
    key,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

it("moves a project row with Alt+Arrow and announces it", async () => {
  await withRail(({ row }) => {
    const event = altArrow(row("/a").querySelector("button")!, "ArrowDown");
    expect(event.defaultPrevented).toBe(true);
    expect(loadProjectRailOrder()).toEqual(["/b", "/a", "/c"]);
    expect(document.querySelector("[data-drag-announcer]")?.textContent).toBe(
      "Moved a to position 2 of 3",
    );
  });
});

it("leaves plain arrows to the browser and stays put at the list edge", async () => {
  await withRail(({ row }) => {
    const plain = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      row("/a").querySelector("button")!.dispatchEvent(plain);
    });
    expect(plain.defaultPrevented).toBe(false);
    expect(loadProjectRailOrder()).toEqual(["/a", "/b", "/c"]);
    altArrow(row("/a").querySelector("button")!, "ArrowUp");
    expect(loadProjectRailOrder()).toEqual(["/a", "/b", "/c"]);
    expect(document.querySelector("[data-drag-announcer]")?.textContent).toBe(
      "a stays at position 1 of 3",
    );
  });
});

it("offers Move up/down in the project row menu, disabled at the list edge", async () => {
  await withRail(({ row }) => {
    act(() => {
      row("/a").dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const item = (label: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === label,
      );
    expect(
      item("Move up")?.getAttribute("aria-disabled") ??
        String(item("Move up")?.hasAttribute("disabled")),
    ).toMatch(/true/);
    const down = item("Move down")!;
    expect(down).toBeTruthy();
    act(() => down.click());
    expect(loadProjectRailOrder()).toEqual(["/b", "/a", "/c"]);
  });
});

async function withGroupsRail(run: (helpers: { container: HTMLElement }) => void) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  saveProjectGroups([
    { id: "alpha", name: "Alpha", collapsed: true },
    { id: "beta", name: "Beta", collapsed: true },
  ]);
  savePinnedProjects(["/a"]);
  const paths = ["/a", "/b", "/c"];
  saveProjectRailOrder(paths);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(ProjectRail, {
          cwd: "/b",
          recents: paths.map((path) => ({ path, openedAt: 1 })),
          onSelectProject: vi.fn(),
          onOpenProject: vi.fn(),
        }),
      ),
    );
    run({ container });
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
}

it("moves a project group with Alt+Arrow through the shared path and announces it", async () => {
  await withGroupsRail(({ container }) => {
    const header = container.querySelector<HTMLElement>(
      '[data-project-group="alpha"] [aria-keyshortcuts]',
    )!;
    const plain = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    act(() => {
      header.dispatchEvent(plain);
    });
    expect(plain.defaultPrevented).toBe(false);
    expect(loadProjectGroups().map((group) => group.id)).toEqual(["alpha", "beta"]);
    const event = altArrow(header, "ArrowDown");
    expect(event.defaultPrevented).toBe(true);
    expect(loadProjectGroups().map((group) => group.id)).toEqual(["beta", "alpha"]);
    expect(document.querySelector("[data-drag-announcer]")?.textContent).toBe(
      "Moved Alpha to position 2 of 2",
    );
    altArrow(
      container.querySelector<HTMLElement>('[data-project-group="alpha"] [aria-keyshortcuts]')!,
      "ArrowDown",
    );
    expect(loadProjectGroups().map((group) => group.id)).toEqual(["beta", "alpha"]);
    expect(document.querySelector("[data-drag-announcer]")?.textContent).toBe(
      "Alpha stays at position 2 of 2",
    );
  });
});

it("moves a rail section with Alt+Arrow and its menu, announcing the section by name", async () => {
  await withGroupsRail(({ container }) => {
    const header = (name: string) =>
      [...container.querySelectorAll<HTMLElement>('[title="Drag to reorder"]')].find(
        (node) => node.textContent?.trim().startsWith(name),
      )!;
    const order = () => loadRailSectionOrder().filter((id) => ["pinned", "groups", "projects"].includes(id));
    expect(order()).toEqual(["pinned", "groups", "projects"]);
    const event = altArrow(header("Pinned"), "ArrowDown");
    expect(event.defaultPrevented).toBe(true);
    expect(order()).toEqual(["groups", "pinned", "projects"]);
    expect(document.querySelector("[data-drag-announcer]")?.textContent).toBe(
      "Moved Pinned to position 2 of 3",
    );
    // The section menu goes through the same move and announcement.
    act(() => {
      header("Projects").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }),
      );
    });
    const up = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (node) => node.textContent?.trim() === "Move section up",
    )!;
    act(() => up.click());
    expect(order()).toEqual(["groups", "projects", "pinned"]);
    expect(document.querySelector("[data-drag-announcer]")?.textContent).toBe(
      "Moved Projects to position 2 of 3",
    );
  });
});
