// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceSourceControl } from "./WorkspaceSourceControl";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { Worktree } from "../model/worktrees";
import { saveWorkspaceProjectNames } from "../../workspace/model/tabGroups";
import { OPEN_WORKTREE_MANAGEMENT } from "../model/worktreeManagement";

const { notify, discovery, discover } = vi.hoisted(() => ({
  notify: vi.fn(),
  discover: vi.fn(),
  discovery: {
    modules: {} as Record<string, string[]>,
    error: undefined as string | undefined,
    refresh: vi.fn(),
  },
}));
vi.mock("../hooks/useGitSubmodules", () => ({
  useGitSubmodules: (...args: unknown[]) => {
    discover(...args);
    return discovery;
  },
}));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").pop(),
  notifyGitChanged: notify,
}));
vi.mock("../../../shared/ui/SearchableSelect", () => ({
  SearchableSelect: (props: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) =>
    createElement(
      "select",
      {
        "aria-label": props.label,
        value: props.value,
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
      },
      props.options.map((option) =>
        createElement("option", { key: option.value, value: option.value }, option.label),
      ),
    ),
}));
vi.mock("../hooks/useProjectDiffStats", () => ({ useProjectDiffStats: () => null }));
vi.mock("./GitPanelSections", () => ({
  GitPanelSections: (props: {
    cwd: string;
    repositories: {
      value: string;
      options: { value: string; label: string }[];
      onChange: (value: string) => void;
    };
    onOpenCommit: (commit: { sha: string }) => void;
  }) =>
    createElement(
      "aside",
      {
        "data-sections": props.cwd,
        "data-choice": props.repositories.value,
        "data-options": props.repositories.options.map((option) => option.label).join("|"),
      },
      props.repositories.options.map((option) =>
        createElement(
          "button",
          { key: option.value, onClick: () => props.repositories.onChange(option.value) },
          `show ${option.value}`,
        ),
      ),
      createElement("button", { onClick: () => props.onOpenCommit({ sha: "def" }) }, "history"),
    ),
}));
vi.mock("./GitChangesPanel", () => ({
  GitChangesPanel: (props: {
    cwd: string;
    repository?: {
      name: string;
      expanded?: boolean;
      onToggle: (value: boolean) => void;
    };
    onOpenFile: (path: string, kind: string) => void;
    onOpenInEditor: (path: string, pin: boolean) => void;
    onOpenAllChanges: (kind: string) => void;
    onOpenCommit: (commit: { sha: string }) => void;
  }) =>
    createElement(
      "section",
      { "data-cwd": props.cwd, "data-compact": !!props.repository },
      createElement(
        "button",
        {
          onClick: () => props.repository?.onToggle(!props.repository.expanded),
          "aria-expanded": props.repository?.expanded ?? false,
        },
        props.repository?.name,
      ),
      createElement("button", { onClick: () => props.onOpenFile("same.ts", "staged") }, "diff"),
      createElement("button", { onClick: () => props.onOpenInEditor("same.ts", true) }, "editor"),
      createElement("button", { onClick: () => props.onOpenAllChanges("unstaged") }, "all"),
      createElement("button", { onClick: () => props.onOpenCommit({ sha: "abc" }) }, "commit"),
    ),
}));
let host: HTMLDivElement;
let root: Root;
const opened = vi.fn();
beforeEach(() => {
  resetRetainedState();
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  opened.mockClear();
  notify.mockClear();
  discover.mockClear();
  discovery.modules = {};
  discovery.error = undefined;
  discovery.refresh.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (paths = ["/wallet/api", "/wallet/mobile"]) =>
  act(async () =>
    root.render(
      createElement(WorkspaceSourceControl, {
        cwd: "/wallet",
        paths,
        enabled: true,
        onOpen: opened,
      }),
    ),
  );
const choose = async (path: string) =>
  act(async () => {
    const select = host.querySelector("select")!;
    select.value = path;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
const remount = async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
};

it("shows one Stashes and Graph below the rows, following the repository last used", async () => {
  await render();
  const sections = () => host.querySelectorAll<HTMLElement>("[data-sections]");
  const press = async (label: string) =>
    act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("aside button")]
        .find((button) => button.textContent === label)!
        .click(),
    );
  expect(sections()).toHaveLength(1);
  expect(sections()[0].dataset.sections).toBe("/wallet/api");
  expect(sections()[0].dataset.options).toBe("Auto · api|api|mobile");
  await act(async () =>
    host
      .querySelector('[data-cwd="/wallet/mobile"]')!
      .dispatchEvent(new Event("pointerdown", { bubbles: true })),
  );
  expect(sections()[0].dataset.sections).toBe("/wallet/mobile");
  expect(sections()[0].dataset.choice).toBe("");
  await press("history");
  expect(opened).toHaveBeenLastCalledWith({
    type: "commit",
    cwd: "/wallet/mobile",
    commit: { sha: "def" },
    pin: undefined,
  });
  // A manual choice stays while another row is used, until Auto is chosen again.
  await press("show /wallet/api");
  await act(async () =>
    host
      .querySelector('[data-cwd="/wallet/mobile"]')!
      .dispatchEvent(new Event("pointerdown", { bubbles: true })),
  );
  expect(sections()[0].dataset.sections).toBe("/wallet/api");
  expect(sections()[0].dataset.choice).toBe("/wallet/api");
  await press("show ");
  expect(sections()[0].dataset.sections).toBe("/wallet/mobile");
  await choose("/wallet/api");
  expect(sections()).toHaveLength(0);
});

it("restores repository choice immediately after session navigation and app reload", async () => {
  await render();
  await choose("/wallet/mobile");
  await remount();
  await render();
  expect(host.querySelector("select")!.value).toBe("/wallet/mobile");
  expect(host.querySelectorAll("section")).toHaveLength(1);
  await remount();
  resetRetainedState();
  await render();
  expect(host.querySelector("select")!.value).toBe("/wallet/mobile");
  await choose("");
  await remount();
  resetRetainedState();
  await render();
  expect(host.querySelector("select")!.value).toBe("");
});

it("keeps a selected submodule while discovery is pending and uses confirmed removal as fallback", async () => {
  discovery.modules = { "/wallet/api": ["/wallet/api/core-pack"] };
  await render();
  await choose("/wallet/api/core-pack");
  await remount();
  discovery.modules = {};
  await render();
  expect(host.querySelector("select")!.value).toBe("/wallet/api/core-pack");
  expect(host.querySelectorAll("section")).toHaveLength(1);
  expect(host.querySelector("section")!.dataset.cwd).toBe("/wallet/api/core-pack");
  discovery.modules = { "/wallet/api": [] };
  await render();
  expect(host.querySelector("select")!.value).toBe("");
});

it("retains row expansion and isolates choices when the same panel changes workspace", async () => {
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-cwd="/wallet/api"] button')!.click(),
  );
  await choose("/wallet/mobile");
  await act(async () =>
    root.render(
      createElement(WorkspaceSourceControl, {
        cwd: "/other",
        paths: ["/other/api", "/other/ui"],
        enabled: true,
        onOpen: opened,
      }),
    ),
  );
  expect(host.querySelector("select")!.value).toBe("");
  await choose("/other/ui");
  await render();
  expect(host.querySelector("select")!.value).toBe("/wallet/mobile");
  await choose("");
  expect(host.querySelector('[data-cwd="/wallet/api"] button')!.getAttribute("aria-expanded")).toBe(
    "true",
  );
});
it("uses workspace aliases for repository rows and selection, preserving same-name paths", async () => {
  const paths = ["/wallet/pf-account/srv", "/wallet/pf-payment/srv"];
  saveWorkspaceProjectNames(paths, {
    [paths[0]]: "pf-account-srv",
    [paths[1]]: "pf-payment-srv",
  });
  await render(paths);
  expect([...host.querySelectorAll("option")].map((option) => option.textContent)).toContain(
    "pf-account-srv",
  );
  expect(host.querySelector(`[data-cwd="${paths[1]}"]`)?.textContent).toContain("pf-payment-srv");
  await choose(paths[0]);
  expect(host.querySelector("section")?.dataset.cwd).toBe(paths[0]);
});
it("shows compact rows in the main panel and independently expands them", async () => {
  await render();
  expect(host.querySelectorAll('[data-compact="true"]')).toHaveLength(2);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-cwd="/wallet/mobile"] button')!.click(),
  );
  expect(
    host.querySelector('[data-cwd="/wallet/mobile"] button')!.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(host.querySelector('[data-cwd="/wallet/api"] button')!.getAttribute("aria-expanded")).toBe(
    "false",
  );
});
it("keeps all diff, file and commit targets scoped to their repo when the workspace root stays selected", async () => {
  await render();
  const row = host.querySelector('[data-cwd="/wallet/mobile"]')!;
  for (const label of ["diff", "editor", "all", "commit"])
    await act(async () =>
      [...row.querySelectorAll("button")].find((button) => button.textContent === label)!.click(),
    );
  expect(opened.mock.calls.map(([request]) => request.cwd)).toEqual(
    Array(4).fill("/wallet/mobile"),
  );
  expect(opened.mock.calls[0][0]).toMatchObject({
    type: "diff",
    path: "same.ts",
    kind: "staged",
  });
  expect(opened.mock.calls[1][0]).toMatchObject({ type: "file", pin: true });
  expect(opened.mock.calls[2][0]).toMatchObject({
    type: "diff",
    kind: "unstaged",
  });
  expect(opened.mock.calls[3][0]).toMatchObject({
    type: "commit",
    commit: { sha: "abc" },
  });
});
it("supports single-repo review, root-repo review and refreshing only the visible selection", async () => {
  await render();
  await choose("/wallet/mobile");
  expect(host.querySelectorAll("section")).toHaveLength(1);
  expect(host.querySelector("section")!.getAttribute("data-compact")).toBe("false");
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Refresh source control"]')!.click(),
  );
  expect(notify).toHaveBeenCalledWith("/wallet/mobile", "checkout");
  expect(notify).toHaveBeenCalledTimes(1);
  await choose("/wallet");
  expect(host.querySelector("section")!.getAttribute("data-cwd")).toBe("/wallet");
  await choose("");
  expect(host.querySelectorAll("section")).toHaveLength(2);
});
it("falls back to all rows when the selected repository leaves the workspace", async () => {
  await render(["/wallet/api", "/wallet/mobile", "/wallet/web"]);
  await choose("/wallet/mobile");
  await render(["/wallet/api", "/wallet/web"]);
  expect(host.querySelector("select")!.value).toBe("");
  expect(host.querySelectorAll('[data-compact="true"]')).toHaveLength(2);
});

it("shows a sole repository as the full panel named in the selector, without a row to collapse", async () => {
  await render(["/wallet/api"]);
  expect(host.querySelector("select")!.value).toBe("/wallet/api");
  expect(host.querySelector('[data-compact="true"]')).toBeNull();
  expect(host.querySelector('[data-cwd="/wallet/api"]')).not.toBeNull();
  await choose("");
  expect(host.querySelector('[data-compact="true"]')).toBeNull();
});

it("deduplicates submodules already in a workspace and preserves their own action targets", async () => {
  discovery.modules = { "/wallet/api": ["/wallet/api/core-pack"] };
  await render(["/wallet/api", "/wallet/api/core-pack"]);
  expect(host.querySelectorAll("section")).toHaveLength(2);
  await choose("/wallet/api/core-pack");
  await act(async () => host.querySelectorAll("section button")[2].click());
  expect(opened).toHaveBeenLastCalledWith({
    type: "file",
    cwd: "/wallet/api/core-pack",
    path: "same.ts",
    pin: true,
  });
});

it("retains known repositories on a discovery error and offers refresh", async () => {
  discovery.modules = { "/wallet/api": ["/wallet/api/core-pack"] };
  discovery.error = "offline";
  await render();
  expect(host.querySelectorAll("section")).toHaveLength(3);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not refresh repositories",
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Refresh source control"]')!.click(),
  );
  expect(discovery.refresh).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledWith("/wallet/api/core-pack", "checkout");
});

it("recognizes Windows submodule paths already registered with different separators and casing", async () => {
  discovery.modules = { "G:\\repo": ["G:/repo/core-pack"] };
  await render(["G:\\repo", "g:\\repo\\CORE-PACK"]);
  expect(host.querySelectorAll("section")).toHaveLength(2);
});

const tree = (path: string, extra: Partial<Worktree> = {}): Worktree => ({
  path,
  branch: path.split("/").pop()!,
  head: "abcdef1234",
  isMain: false,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
  ...extra,
});
const trees = {
  "/repo": tree("/repo", { isMain: true }),
  "/t/mine": tree("/t/mine", { dirty: true }),
  "/t/idle": tree("/t/idle"),
};
const renderCheckouts = (cwd = "/t/mine/src", worktrees: Record<string, Worktree> = trees) =>
  act(async () =>
    root.render(
      createElement(WorkspaceSourceControl, {
        cwd,
        paths: Object.keys(worktrees),
        worktrees,
        checkouts: true,
        enabled: true,
        onOpen: opened,
      }),
    ),
  );
it("shows editable checkout sections and discovered child repositories in the all view", async () => {
  discovery.modules = { "/repo": ["/repo/mobile"], "/t/mine": [], "/t/idle": [] };
  await renderCheckouts();
  await choose("");
  expect([...host.querySelectorAll("section")].map((panel) => panel.dataset.cwd)).toEqual([
    "/repo",
    "/repo/mobile",
    "/t/mine",
    "/t/idle",
  ]);
  expect(discover).toHaveBeenLastCalledWith(Object.keys(trees), true, true);
  const current = host.querySelector('[data-cwd="/t/mine"] button')!;
  expect(current.getAttribute("aria-expanded")).toBe("true");
  const mobile = host.querySelector('[data-cwd="/repo/mobile"]')!;
  expect(mobile.textContent).toContain("mobile");
  expect(mobile.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  await act(async () =>
    [...mobile.querySelectorAll("button")].find((button) => button.textContent === "diff")!.click(),
  );
  expect(opened).toHaveBeenLastCalledWith({
    type: "diff",
    cwd: "/repo/mobile",
    path: "same.ts",
    kind: "staged",
  });
});
it("defaults checkouts mode to the session checkout with the full panel", async () => {
  await renderCheckouts();
  expect(host.querySelectorAll("section")).toHaveLength(1);
  expect(host.querySelector("section")!.dataset.cwd).toBe("/t/mine");
  expect(host.querySelector("section")!.getAttribute("data-compact")).toBe("false");
  expect(host.querySelector("select")!.value).toBe("/t/mine");
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "diff")!.click(),
  );
  expect(opened.mock.calls[0][0]).toMatchObject({ cwd: "/t/mine" });
});
it("falls back to the main folder outside every checkout", async () => {
  await renderCheckouts("/elsewhere");
  expect(host.querySelector("section")!.dataset.cwd).toBe("/repo");
});
it("independently expands checkout changes and preserves expansion across target selection", async () => {
  await renderCheckouts();
  await choose("");
  expect(host.querySelectorAll("section")).toHaveLength(3);
  const overview = host.querySelector<HTMLElement>("[data-checkout-overview]")!;
  overview.scrollTop = 120;
  overview.dispatchEvent(new Event("scroll"));
  const toggle = host.querySelector<HTMLButtonElement>('[data-cwd="/t/idle"] button')!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector('[data-cwd="/t/mine"] button')!.getAttribute("aria-expanded")).toBe(
    "true",
  );
  await choose("/t/idle");
  expect(host.querySelector("section")!.dataset.cwd).toBe("/t/idle");
  await choose("");
  expect(host.querySelector('[data-cwd="/t/idle"] button')!.getAttribute("aria-expanded")).toBe(
    "true",
  );
  expect(host.querySelector<HTMLElement>("[data-checkout-overview]")!.scrollTop).toBe(120);
});
it("opens worktree management from the overview without retargeting or deleting a checkout", async () => {
  const request = vi.fn();
  window.addEventListener(OPEN_WORKTREE_MANAGEMENT, request);
  try {
    await renderCheckouts();
    await choose("");
    const buttons = host.querySelectorAll<HTMLButtonElement>('[aria-label="Manage worktrees…"]');
    expect(buttons).toHaveLength(1);
    await act(async () => buttons[0].click());
    expect((request.mock.calls[0][0] as CustomEvent).detail).toEqual({
      cwd: "/t/mine/src",
      deletePath: undefined,
    });
    expect(host.querySelector("select")!.value).toBe("");
    expect(opened).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(OPEN_WORKTREE_MANAGEMENT, request);
  }
});

it("persists the checkout choice, including all checkouts, across remounts", async () => {
  await renderCheckouts();
  await choose("/t/idle");
  await act(async () => root.unmount());
  root = createRoot(host);
  await renderCheckouts();
  expect(host.querySelector("section")!.dataset.cwd).toBe("/t/idle");
  await choose("");
  await act(async () => root.unmount());
  root = createRoot(host);
  await renderCheckouts();
  expect(host.querySelector("[data-checkout-overview]")).not.toBeNull();
});

it("retains a selected child repository while discovery is pending and falls back only after confirmed removal", async () => {
  discovery.modules = { "/repo": ["/repo/mobile"] };
  await renderCheckouts();
  await choose("/repo/mobile");
  expect(host.querySelector("section")!.dataset.cwd).toBe("/repo/mobile");
  await remount();
  discovery.modules = {};
  await renderCheckouts();
  expect(host.querySelector("select")!.value).toBe("/repo/mobile");
  expect(host.querySelector("section")!.dataset.cwd).toBe("/repo/mobile");
  discovery.modules = { "/repo": [] };
  await renderCheckouts();
  expect(host.querySelector("section")!.dataset.cwd).toBe("/t/mine");
});
