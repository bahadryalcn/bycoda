// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectRail } from "./ProjectRail";
import { savePinnedProjects } from "../../features/projects/model/recents";
import { OPEN_PROJECT_CHANGES_EVENT } from "../../features/projects/model/groupGit";
import {
  loadProjectGroups,
  saveProjectGroups,
  saveProjectGroupAssignments,
} from "../../features/projects/model/projectGroups";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("../../features/source-control/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
  useProjectsDiffStats: () => [],
}));
vi.mock("./SidebarUpdate", () => ({ SidebarUpdateFooter: () => null }));
vi.mock("../../features/projects/model/projectData", () => ({
  projectSessionCount: vi.fn(async () => 0),
}));

let host: HTMLDivElement;
let root: Root;
const select = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  select.mockClear();
  saveProjectGroups([
    {
      id: "wallet",
      name: "Wallet",
      collapsed: false,
      workspaceFile: "G:/wallet/wallet.code-workspace",
    },
  ]);
  saveProjectGroupAssignments({ "g:/wallet/api": "wallet", "g:/wallet/mobile": "wallet" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (cwd = "G:/wallet/api", paths = ["G:/wallet/api", "G:/wallet/mobile"]) =>
  act(async () =>
    root.render(
      createElement(ProjectRail, {
        cwd,
        recents: paths.map((path) => ({ path, openedAt: 1 })),
        onSelectProject: select,
        onOpenProject: vi.fn(),
        onRemoveProject: vi.fn(),
      }),
    ),
  );
const workspaceButton = () =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Open Wallet"]')!;

it("selects the workspace root through normal project navigation without opening a modal", async () => {
  await render();
  expect(workspaceButton().title).toBe("G:/wallet");
  expect(host.textContent).toContain("Workspace");
  await act(async () => workspaceButton().click());
  expect(select).toHaveBeenCalledWith("G:/wallet");
  expect(loadProjectGroups()[0].collapsed).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render("G:/wallet");
  expect(workspaceButton().getAttribute("aria-current")).toBe("page");
});

it("keeps expansion and child-project selection separate from workspace navigation", async () => {
  await render();
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="Wallet, 2 projects"]')!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(select).not.toHaveBeenCalled();
  await act(async () => workspaceButton().click());
  expect(select).toHaveBeenLastCalledWith("G:/wallet");
  expect(loadProjectGroups()[0].collapsed).toBe(true);
  await act(async () => toggle.click());
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-project-path="G:/wallet/mobile"] button')!.click(),
  );
  expect(select).toHaveBeenLastCalledWith("G:/wallet/mobile");
});

it("represents the root once even when it is recent or pinned", async () => {
  savePinnedProjects(["G:/wallet", "G:/wallet/mobile"]);
  await render("g:/WALLET/", ["G:/wallet", "G:/wallet/api", "G:/wallet/mobile"]);
  expect(workspaceButton().getAttribute("aria-current")).toBe("page");
  expect(host.querySelector('[data-project-path="G:/wallet"]')).toBeNull();
  expect(host.querySelector('[data-project-path="G:/wallet/api"]')).not.toBeNull();
  expect(host.querySelector('[data-project-path="G:/wallet/mobile"]')).not.toBeNull();
});

it("opens the normal Changes tab for the workspace root from its Git shortcut", async () => {
  await render();
  const opened = vi.fn();
  window.addEventListener(OPEN_PROJECT_CHANGES_EVENT, opened);
  try {
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label^="Wallet git overview"]')!.click(),
    );
    expect(opened.mock.calls[0][0].detail).toBe("G:/wallet");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    window.removeEventListener(OPEN_PROJECT_CHANGES_EVENT, opened);
  }
});

it("toggles ordinary groups from their name, header space and arrow", async () => {
  saveProjectGroups([{ id: "team", name: "Team", collapsed: false }]);
  saveProjectGroupAssignments({ "g:/wallet/api": "team" });
  await render();
  const name = [...host.querySelectorAll("span")].find((span) => span.textContent === "Team")!;
  expect(name.closest("button")).toBeNull();
  await act(async () => name.click());
  expect(select).not.toHaveBeenCalled();
  expect(loadProjectGroups()[0].collapsed).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const group = host.querySelector<HTMLElement>('[data-project-group="team"]')!;
  await act(async () => (group.firstElementChild as HTMLElement).click());
  expect(loadProjectGroups()[0].collapsed).toBe(false);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Team, 1 project"]')!.click(),
  );
  expect(loadProjectGroups()[0].collapsed).toBe(true);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Team group options"]')!.click(),
  );
  expect(loadProjectGroups()[0].collapsed).toBe(true);
});
