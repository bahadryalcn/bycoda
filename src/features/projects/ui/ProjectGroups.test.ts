// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import {
  loadProjectGroupAssignments,
  loadProjectGroups,
  deleteProjectGroup,
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../model/projectGroups";
import { loadPinnedProjects, savePinnedProjects } from "../model/recents";
import * as groupLock from "../../group-lock/model/groupLock";
import { hideGroup, restoreHiddenGroup } from "../../group-lock/model/groupLock";
import { useProjectMenu } from "../../../app/shell/useProjectMenu";
import { ProjectRail } from "../../../app/shell/ProjectRail";
import {
  useProjectDiffStats,
  useProjectsDiffStats,
} from "../../source-control/hooks/useProjectDiffStats";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock("../../source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: vi.fn(() => null),
  useProjectsDiffStats: vi.fn((paths: string[]) => paths.map(() => null)),
}));
vi.mock("../model/projectData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/projectData")>()),
  projectSessionCount: vi.fn(async () => 0),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(useProjectDiffStats).mockClear();
  vi.mocked(useProjectDiffStats).mockReturnValue(null);
  vi.mocked(useProjectsDiffStats).mockImplementation((paths) => paths.map(() => null));
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderRail(
  visible = true,
  overrides: Partial<ComponentProps<typeof ProjectRail>> = {},
) {
  await act(async () =>
    root.render(
      createElement(ProjectRail, {
        visible,
        cwd: "/work/personal",
        recents: [
          { path: "/work/client", openedAt: 1 },
          { path: "/work/personal", openedAt: 2 },
        ],
        onSelectProject: vi.fn(),
        onOpenProject: vi.fn(),
        ...overrides,
      }),
    ),
  );
}

it("keeps quick project actions visible and opens appearance and folder actions from flyouts", async () => {
  await renderRail(true, { onRenameProjectFolder: vi.fn() });
  await act(async () =>
    button("personal").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 40 }),
    ),
  );
  expect(document.querySelector('button[aria-label="Add project logo"]')).toBeNull();
  expect(button("Pin project")).toBeDefined();
  expect(button("Open in editor")).toBeDefined();
  const appearance = button("Appearance");
  act(() =>
    appearance.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"][aria-label="Appearance"]')).not.toBeNull();
  expect(button("Add project logo")).toBeDefined();
  expect(button("Background image")).toBeDefined();
  act(() => button("Folders").dispatchEvent(new Event("pointermove", { bubbles: true })));
  expect(document.querySelector('[role="dialog"][aria-label="Appearance"]')).toBeNull();
  expect(button("Rename folder…")).toBeDefined();
  expect(button("Additional folders…")).toBeDefined();
  await act(async () => button("Additional folders…").click());
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  expect(dialog?.querySelector("h2")?.textContent).toBe("Additional folders");
});

it("shows project changes inside its menu", async () => {
  vi.mocked(useProjectDiffStats).mockReturnValue({ files: 3, additions: 12, deletions: 4 });
  await renderRail();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[data-project-path="/work/personal"] button')!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 40 })),
  );
  expect(document.querySelector("[data-project-menu-git]")?.textContent).toBe("3 files · +12 -4");
  vi.mocked(useProjectDiffStats).mockReturnValue(null);
});

for (const linked of [false, true]) {
  it(`retains cached Git changes in ${linked ? "workspace" : "group"} menus`, async () => {
    saveProjectGroups([
      {
        id: "team",
        name: "Team",
        collapsed: false,
        ...(linked
          ? { workspaceFile: "/work/team/team.code-workspace", workspaceFolders: ["/work/client"] }
          : {}),
      },
    ]);
    saveProjectGroupAssignments({ "/work/client": "team" });
    vi.mocked(useProjectsDiffStats).mockImplementation((paths) =>
      paths.map(() => ({ files: 2, additions: 7, deletions: 3 })),
    );
    await renderRail();
    await act(async () => button("Team group options").click());
    expect(document.querySelector("[data-group-menu-git]")?.textContent).toBe("2 files · +7 -3");
  });
}

it("conceals cached member Git data in a locked group menu", async () => {
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false, lockable: true }]);
  saveProjectGroupAssignments({ "/work/client": "team" });
  const view = groupLock.getGroupLockView();
  const spy = vi
    .spyOn(groupLock, "getGroupLockView")
    .mockReturnValue({ ...view, lock: { ...view.lock, lockedGroupIds: new Set(["team"]) } });
  try {
    vi.mocked(useProjectsDiffStats).mockReturnValue([{ files: 2, additions: 7, deletions: 3 }]);
    await renderRail();
    vi.mocked(useProjectsDiffStats).mockClear();
    await act(async () => button("Team group options").click());
    expect(document.querySelector("[data-group-menu-git]")).toBeNull();
    expect(
      vi
        .mocked(useProjectsDiffStats)
        .mock.calls.some(([paths, enabled]) => enabled && paths.includes("/work/client")),
    ).toBe(false);
  } finally {
    spy.mockRestore();
  }
});

it("opens the existing Git overview through group options and conceals it when locked", async () => {
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  const overview = vi.fn();
  function MenuFixture() {
    const menu = useProjectMenu({});
    return createElement(
      "div",
      null,
      createElement(
        "button",
        { onClick: () => menu.openGroupMenu("team", 20, 40, undefined, overview) },
        "Open menu",
      ),
      menu.element,
    );
  }
  await act(async () => root.render(createElement(MenuFixture)));
  await act(async () => button("Open menu").click());
  await act(async () => button("Changes").click());
  expect(overview).toHaveBeenCalledTimes(1);
  await act(async () => button("Open menu").click());
  const staleAction = button("Changes");
  const view = groupLock.getGroupLockView();
  const spy = vi
    .spyOn(groupLock, "getGroupLockView")
    .mockReturnValue({ ...view, lock: { ...view.lock, lockedGroupIds: new Set(["team"]) } });
  try {
    await act(async () => staleAction.click());
    expect(overview).toHaveBeenCalledTimes(1);
    await act(async () => button("Open menu").click());
    expect(
      [...document.querySelectorAll("button")].some((item) => item.textContent === "Changes"),
    ).toBe(false);
    expect(overview).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it("ungroups a project when its selected group is clicked again", async () => {
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  saveProjectGroupAssignments({ "/work/client": "team" });
  await renderRail();
  await act(async () =>
    button("client").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 40 }),
    ),
  );
  await act(async () => button("Move to group").click());
  expect(
    [...document.querySelectorAll("button")].some((item) => item.textContent === "Ungrouped"),
  ).toBe(false);
  await act(async () => button("Team").click());
  expect(loadProjectGroupAssignments()).toEqual({});
});

it("offers group locking directly while keeping lock setup in the privacy flyout", async () => {
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  await renderRail();
  act(() => button("Team group options").click());
  const lock = button("Lock group");
  expect(lock.closest('[role="menu"]')?.getAttribute("aria-label")).toBe("Project group actions");
  act(() => button("Group privacy").click());
  expect(button("Make lockable")).toBeDefined();
  expect(
    [...document.querySelectorAll("button")].filter((item) => item.textContent === "Lock group"),
  ).toHaveLength(1);
});

it("moves a linked workspace into a group through its menu and back out without changing its folders", async () => {
  saveProjectGroups([
    { id: "team", name: "Team", collapsed: true },
    {
      id: "wallet",
      name: "Wallet",
      collapsed: false,
      workspaceFile: "/work/wallet/wallet.code-workspace",
      workspaceFolders: ["/work/client"],
    },
  ]);
  saveProjectGroupAssignments({ "/work/client": "wallet" });
  await renderRail();
  await act(async () => button("Wallet group options").click());
  await act(async () => button("Move to group").click());
  await act(async () => button("Team").click());
  const parent = container.querySelector('[data-project-group="team"]')!;
  expect(parent.querySelector('[data-project-group="wallet"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-project-group="wallet"]')).toHaveLength(1);
  expect(parent.querySelector('[data-project-path="/work/client"]')).not.toBeNull();
  expect(loadProjectGroupAssignments()).toEqual({
    "/work/client": "wallet",
    "/work/wallet": "team",
  });
  expect(loadProjectGroups()[1].workspaceFolders).toEqual(["/work/client"]);
  expect(loadProjectGroups()[0].collapsed).toBe(false);
  await act(async () => button("Team, 1 project").click());
  expect(parent.querySelector('[data-open="false"]')?.getAttribute("aria-hidden")).toBe("true");
  await act(async () => button("Team, 1 project").click());
  await act(async () => button("Wallet group options").click());
  await act(async () => button("Move to group").click());
  expect(
    [...document.querySelectorAll("button")].some((item) => item.textContent === "Ungrouped"),
  ).toBe(false);
  await act(async () => button("Team").click());
  expect(parent.querySelector('[data-project-group="wallet"]')).toBeNull();
  expect(container.querySelector('[data-project-group="wallet"]')).not.toBeNull();
  expect(loadProjectGroupAssignments()).toEqual({ "/work/client": "wallet" });
});

it("moves a nested workspace above the group's projects and drags it by its name", async () => {
  saveProjectGroups([
    { id: "team", name: "Team", collapsed: false },
    {
      id: "wallet",
      name: "Wallet",
      collapsed: false,
      workspaceFile: "/work/wallet/wallet.code-workspace",
    },
  ]);
  saveProjectGroupAssignments({ "/work/client": "team", "/work/wallet": "team" });
  await renderRail();
  const members = () =>
    [
      ...container.querySelectorAll(
        '[data-project-group="team"] [data-project-group-items] > [data-project-row], [data-project-group="team"] [data-project-group-items] > [data-project-group]',
      ),
    ].map(
      (node) => node.getAttribute("data-project-path") ?? node.getAttribute("data-project-group"),
    );
  expect(members()).toEqual(["/work/client", "wallet"]);
  // The workspace name is part of the header's drag handle, like a project row's name.
  expect(button("Open Wallet").hasAttribute("data-no-drag")).toBe(false);
  await act(async () =>
    button("Open Wallet").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
    ),
  );
  expect(members()).toEqual(["wallet", "/work/client"]);
  expect(loadProjectGroups().find((group) => group.id === "team")?.memberOrder).toEqual([
    "group:wallet",
    pathKey("/work/client"),
  ]);
});

it("creates a parent from the workspace menu and restores the workspace when that parent is deleted", async () => {
  saveProjectGroups([
    {
      id: "wallet",
      name: "Wallet",
      collapsed: false,
      workspaceFile: "/work/wallet/wallet.code-workspace",
    },
  ]);
  await renderRail();
  await act(async () => button("Wallet group options").click());
  await act(async () => button("Move to group").click());
  await act(async () => button("New group…").click());
  const parent = loadProjectGroups().find((group) => !group.workspaceFile)!;
  expect(loadProjectGroupAssignments()["/work/wallet"]).toBe(parent.id);
  expect(document.querySelector('[aria-label="Project group actions"]')).not.toBeNull();
  expect(
    container.querySelector(`[data-project-group="${parent.id}"] [data-project-group="wallet"]`),
  ).not.toBeNull();
  await act(async () => hideGroup(parent.id));
  expect(container.querySelector('[data-project-group="wallet"]')).toBeNull();
  await act(async () => restoreHiddenGroup(parent.id));
  expect(container.querySelector('[data-project-group="wallet"]')).not.toBeNull();
  await act(async () => deleteProjectGroup(parent.id));
  expect(loadProjectGroupAssignments()).toEqual({});
  expect(container.querySelector('[data-project-group="wallet"]')).not.toBeNull();
});

it("confirms group deletion with projects and removes the active project last", async () => {
  saveProjectGroups([{ id: "clients", name: "Client work", collapsed: false }]);
  saveProjectGroupAssignments({
    [pathKey("/work/client")]: "clients",
    [pathKey("/work/personal")]: "clients",
  });
  const remove = vi.fn(async () => {});
  await renderRail(true, { onRemoveProject: remove });
  act(() => button("Client work group options").click());
  expect(document.querySelector('[aria-label="Project icon: Database / Analytics"]')).toBeNull();
  act(() => button("Delete").click());
  await act(async () => button("Delete group with projects").click());
  expect(remove).not.toHaveBeenCalled();
  expect(loadProjectGroups()).toHaveLength(1);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Their folders on disk stay put");
  await act(async () =>
    (
      Array.from(dialog.querySelectorAll("button")).find(
        (item) => item.textContent === "Delete",
      ) as HTMLButtonElement
    ).click(),
  );
  expect(remove.mock.calls).toEqual([
    ["/work/client", { purgeData: true }],
    ["/work/personal", { purgeData: true }],
  ]);
  expect(loadProjectGroups()).toEqual([]);
  expect(loadProjectGroupAssignments()).toEqual({});
});

it("blocks group project deletion when a project starts working during confirmation", async () => {
  saveProjectGroups([{ id: "clients", name: "Client work", collapsed: false }]);
  saveProjectGroupAssignments({ [pathKey("/work/client")]: "clients" });
  const remove = vi.fn(async () => {});
  await renderRail(true, { onRemoveProject: remove });
  act(() => button("Client work group options").click());
  act(() => button("Delete").click());
  await act(async () => button("Delete group with projects").click());
  await renderRail(true, { onRemoveProject: remove, busyPaths: ["/work/client"] });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(
    (
      Array.from(dialog.querySelectorAll("button")).find(
        (item) => item.textContent === "Delete",
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(remove).not.toHaveBeenCalled();
  expect(loadProjectGroups()).toHaveLength(1);
});

it("keeps the group and failed projects retryable after a partial removal", async () => {
  saveProjectGroups([{ id: "clients", name: "Client work", collapsed: false }]);
  saveProjectGroupAssignments({
    [pathKey("/work/client")]: "clients",
    [pathKey("/work/personal")]: "clients",
  });
  const remove = vi.fn(async (path: string) => {
    if (path === "/work/personal") throw new Error("Removal failed");
  });
  await renderRail(true, { onRemoveProject: remove });
  act(() => button("Client work group options").click());
  act(() => button("Delete").click());
  await act(async () => button("Delete group with projects").click());
  await act(async () => button("Delete").click());
  expect(loadProjectGroups()).toHaveLength(1);
  expect(loadProjectGroupAssignments()).toEqual({ [pathKey("/work/personal")]: "clients" });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Removal failed");
  remove.mockImplementation(async () => {});
  await act(async () => button("Delete").click());
  expect(remove.mock.calls.map(([path]) => path)).toEqual([
    "/work/client",
    "/work/personal",
    "/work/personal",
  ]);
  expect(loadProjectGroups()).toEqual([]);
});

it("invalidates confirmation when another project joins the group", async () => {
  saveProjectGroups([{ id: "clients", name: "Client work", collapsed: false }]);
  saveProjectGroupAssignments({ [pathKey("/work/client")]: "clients" });
  const remove = vi.fn(async () => {});
  await renderRail(true, { onRemoveProject: remove });
  act(() => button("Client work group options").click());
  act(() => button("Delete").click());
  await act(async () => button("Delete group with projects").click());
  act(() =>
    saveProjectGroupAssignments({
      [pathKey("/work/client")]: "clients",
      [pathKey("/work/personal")]: "clients",
    }),
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(
    (
      Array.from(dialog.querySelectorAll("button")).find(
        (item) => item.textContent === "Delete",
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(remove).not.toHaveBeenCalled();
  expect(loadProjectGroups()).toHaveLength(1);
});

it("removes hidden group names and pinned projects while retaining settings access and restoration", async () => {
  saveProjectGroups([{ id: "private-hidden", name: "Secret group", collapsed: false }]);
  saveProjectGroupAssignments({ [pathKey("/work/personal")]: "private-hidden" });
  savePinnedProjects(["/work/personal"]);
  const openSettings = vi.fn();
  const selectSection = vi.fn();
  await act(async () =>
    root.render(
      createElement(ProjectRail, {
        cwd: "/work/client",
        recents: [
          { path: "/work/client", openedAt: 1 },
          { path: "/work/personal", openedAt: 2 },
        ],
        onSelectProject: vi.fn(),
        onOpenProject: vi.fn(),
        onOpenSettings: openSettings,
        onSelectSettingsSection: selectSection,
      }),
    ),
  );
  act(() => button("Secret group group options").click());
  act(() => button("Group privacy").click());
  await act(async () => {
    button("Hide group").click();
    await Promise.resolve();
  });
  expect(container.textContent).not.toContain("Secret group");
  expect(container.querySelector('button[aria-label="personal"]')).toBeNull();
  expect(loadProjectGroupAssignments()[pathKey("/work/personal")]).toBe("private-hidden");
  act(() => button("Settings").click());
  expect(openSettings).toHaveBeenCalledOnce();
  await act(async () => {
    await restoreHiddenGroup("private-hidden");
  });
  expect(container.textContent).toContain("Secret group");
  expect(button("personal")).toBeDefined();
});

it("suspends project Git stats while the rail is hidden", async () => {
  await renderRail();
  expect(vi.mocked(useProjectDiffStats).mock.calls.some(([, enabled]) => enabled)).toBe(true);

  vi.mocked(useProjectDiffStats).mockClear();
  vi.mocked(useProjectDiffStats).mockReturnValue(null);
  await renderRail(false);
  expect(vi.mocked(useProjectDiffStats).mock.calls.length).toBeGreaterThan(0);
  expect(vi.mocked(useProjectDiffStats).mock.calls.every(([, enabled]) => !enabled)).toBe(true);
  expect(container.querySelector('nav[aria-label="Projects"]')).not.toBeNull();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  expect(found, label).toBeDefined();
  return found!;
}

function sectionLabels(): string[] {
  return [...container.querySelectorAll("span")]
    .map((element) => element.textContent ?? "")
    .filter((text) => ["Pinned", "Groups", "Projects"].includes(text));
}

it("keeps group members indented without offering group pins", async () => {
  saveProjectGroups([
    { id: "alpha", name: "Alpha", collapsed: false },
    { id: "clients", name: "Client work", collapsed: false },
  ]);
  saveProjectGroupAssignments({ [pathKey("/work/client")]: "clients" });
  savePinnedProjects(["/work/client", "/work/personal"]);
  await renderRail();
  const groupIds = () =>
    [...container.querySelectorAll<HTMLElement>("[data-project-group]")].map(
      (element) => element.dataset.projectGroup,
    );
  const row = container.querySelector<HTMLElement>('[data-project-path="/work/client"]')!;
  expect(row.closest('[data-project-group="clients"]')).not.toBeNull();
  expect(row.parentElement?.classList).toContain("ps-5");
  expect(row.querySelector('button[aria-label$="pin project" i]')).toBeNull();
  // A grouped project's old pin is dropped; ungrouped pins stay.
  expect(loadPinnedProjects()).toEqual(["/work/personal"]);
  await act(async () =>
    row
      .querySelector("button")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 40 })),
  );
  expect(button("Open in editor")).toBeDefined();
  expect(
    [...document.querySelectorAll("button")].some((item) => item.textContent === "Pin project"),
  ).toBe(false);
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

  await act(async () => button("Client work group options").click());
  expect(
    [...document.querySelectorAll("button")].some((item) =>
      /^(Unpin|Pin) group$/.test(item.textContent ?? ""),
    ),
  ).toBe(false);
  expect(groupIds()).toEqual(["alpha", "clients"]);
});

it("renders assigned projects in persistent collapsible groups", async () => {
  savePinnedProjects(["/work/personal"]);
  saveProjectGroups([{ id: "clients", name: "Client work", collapsed: false, colorIndex: 4 }]);
  saveProjectGroupAssignments({ [pathKey("/work/client")]: "clients" });
  await renderRail();

  expect(button("personal")).toBeDefined();
  expect(button("client")).toBeDefined();
  expect(sectionLabels()).toEqual(["Pinned", "Groups", "Projects"]);

  const group = container.querySelector<HTMLElement>('[data-project-group="clients"]')!;
  const groupRow = group.firstElementChild as HTMLElement;
  expect(groupRow.classList).toContain("project-reorder-item");
  expect(groupRow.classList).toContain("h-(--ui-control-height-compact)");
  expect(groupRow.classList).toContain("px-2");
  const options = button("Client work group options");
  expect(options.getAttribute("aria-haspopup")).toBe("menu");
  expect(options.closest("[data-project-group]")).toBe(group);

  const header = button("Client work, 1 project");
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(group.classList).toContain("overflow-hidden");
  expect(group.classList).toContain("rounded-md");
  // The expanded group is separated by spacing, not a tinted fill.
  expect(group.classList).not.toContain("bg-content/3");
  expect(group.getAttribute("style")).toBeNull();
  expect(group.querySelector("[data-project-group-items]")?.classList).toContain("p-1");
  expect(group.querySelector("[data-group-chevron]")).not.toBeNull();
  expect(group.querySelector("[data-group-mascot]")).toBeNull();

  act(() => header.click());
  // Closing rows stay mounted until height has animated to zero, but are inert.
  expect(document.querySelector('button[aria-label="client"]')).not.toBeNull();
  expect(loadProjectGroups()[0].collapsed).toBe(true);
  const collapsedGroup = container.querySelector<HTMLElement>('[data-project-group="clients"]')!;
  const body = collapsedGroup.querySelector<HTMLElement>(".project-group-body")!;
  expect(body.dataset.open).toBe("false");
  expect(body.getAttribute("aria-hidden")).toBe("true");
  expect(body.hasAttribute("inert")).toBe(true);
  expect(collapsedGroup.classList).not.toContain("bg-content/3");
  const transitionEnd = new Event("transitionend", { bubbles: true });
  Object.defineProperty(transitionEnd, "propertyName", {
    value: "height",
  });
  act(() => body.dispatchEvent(transitionEnd));
  expect(collapsedGroup.classList).not.toContain("bg-content/3");
  expect(collapsedGroup.querySelector("[data-project-group-items]")).toBeNull();
  expect(collapsedGroup.querySelector("[data-group-mascot]")?.classList).toContain(
    "group-hover:hidden",
  );
  expect(collapsedGroup.querySelector("[data-group-chevron]")?.classList).toContain(
    "group-hover:block",
  );

  act(() => root.unmount());
  root = createRoot(container);
  await renderRail();
  expect(button("Client work, 1 project").getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector('button[aria-label="client"]')).toBeNull();
  expect(button("personal")).toBeDefined();
});

it("keeps a reopened group visible when a closing transition finishes late", async () => {
  saveProjectGroups([{ id: "clients", name: "Client work", collapsed: false, colorIndex: 4 }]);
  saveProjectGroupAssignments({ [pathKey("/work/client")]: "clients" });
  await renderRail();
  const header = button("Client work, 1 project");
  const body = container.querySelector<HTMLElement>(".project-group-body")!;
  act(() => header.click());
  act(() => header.click());
  const transitionEnd = new Event("transitionend", { bubbles: true });
  Object.defineProperty(transitionEnd, "propertyName", {
    value: "height",
  });
  act(() => body.dispatchEvent(transitionEnd));
  expect(body.dataset.open).toBe("true");
  expect(body.hasAttribute("inert")).toBe(false);
  expect(button("client")).toBeDefined();
});

it("removes closing rows immediately when reduced motion is requested", async () => {
  saveProjectGroups([{ id: "clients", name: "Client work", collapsed: false, colorIndex: 4 }]);
  saveProjectGroupAssignments({ [pathKey("/work/client")]: "clients" });
  await renderRail();
  const matchMedia = vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  try {
    act(() => button("Client work, 1 project").click());
    expect(container.querySelector("[data-project-group-items]")).toBeNull();
  } finally {
    matchMedia.mockRestore();
  }
});

it("creates, styles, assigns, and deletes a group from the rail", async () => {
  await renderRail();
  expect(sectionLabels()).toEqual(["Projects"]);
  expect(document.querySelector('button[aria-label="New project group"]')).toBeNull();

  const personal = button("personal");
  await act(async () => {
    personal.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 40,
      }),
    );
  });
  act(() => button("Move to group").click());
  const moveMenu = document.querySelector('[role="menu"][aria-label="Move to group"]')!;
  const newGroup = [...moveMenu.querySelectorAll("button")].find(
    (item) => item.textContent === "New group…",
  )!;
  await act(async () => {
    newGroup.click();
    await Promise.resolve();
  });

  const input = document.querySelector<HTMLInputElement>(
    '[role="menu"][aria-label="Project group actions"] input[aria-label="Group name"]',
  )!;
  expect(input.value).toBe("New group");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, "Side projects");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(loadProjectGroups()[0].name).toBe("Side projects");
  const groupId = loadProjectGroups()[0].id;
  expect(loadProjectGroupAssignments()).toEqual({
    [pathKey("/work/personal")]: groupId,
  });
  expect(button("Side projects, 1 project")).toBeDefined();

  act(() => button("Side projects group options").click());
  act(() => button("Appearance").click());
  act(() => button("Project icon: Database / Analytics").click());
  expect(loadProjectGroups()[0].mascot).toBe("orbit");
  act(() => button("Delete").click());
  await act(async () => {
    button("Delete group").click();
    await Promise.resolve();
  });
  expect(loadProjectGroups()).toEqual([]);
  expect(loadProjectGroupAssignments()).toEqual({});
  expect(button("personal")).toBeDefined();
  expect(sectionLabels()).toEqual(["Projects"]);
  expect(document.querySelector('button[aria-label="New project group"]')).toBeNull();
});
