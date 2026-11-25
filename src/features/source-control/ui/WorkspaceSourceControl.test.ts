// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceSourceControl } from "./WorkspaceSourceControl";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { Worktree } from "../model/worktrees";
import { saveWorkspaceProjectNames } from "../../workspace/model/tabGroups";

const { notify, discovery, discover } = vi.hoisted(() => ({
  notify: vi.fn(),
  discover: vi.fn(),
  discovery: {
    modules: {} as Record<string, string[]>,
    error: undefined as string | undefined,
    limits: {} as Record<string, string>,
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
      nested?: boolean;
      scope?: { only: boolean; onToggle: () => void };
      onToggle: (value: boolean) => void;
    };
    onOpenFile: (path: string, kind: string) => void;
    onOpenInEditor: (path: string, pin: boolean) => void;
    onOpenAllChanges: (kind: string) => void;
    onOpenCommit: (commit: { sha: string }) => void;
    checkout?: { onRefresh: () => void };
  }) =>
    createElement(
      "section",
      {
        "data-cwd": props.cwd,
        "data-compact": !!props.repository,
        "data-has-checkout": !!props.checkout,
        "data-nested": !!props.repository?.nested,
        "data-scope": props.repository?.scope
          ? props.repository.scope.only
            ? "only"
            : "all"
          : undefined,
      },
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
      createElement("button", { onClick: () => props.repository?.scope?.onToggle() }, "scope"),
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
  discovery.limits = {};
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

it("lists repositories found before a size limit and says the scan was limited, not failed", async () => {
  discovery.modules = { "/wallet/api": ["/wallet/api/core-pack"] };
  discovery.limits = { "/wallet/api": "entries" };
  await render();
  expect(host.querySelectorAll("section")).toHaveLength(3);
  expect(host.textContent).toContain("(scan limited)");
  expect(host.querySelector('[role="alert"]')).toBeNull();
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
  "/t/work": tree("/t/work", { dirty: true }),
  "/t/idle": tree("/t/idle"),
  "/t/idle2": tree("/t/idle2"),
};
const renderCheckouts = (
  cwd = "/t/mine/src",
  worktrees: Record<string, Worktree> = trees,
  focusPath?: string,
) =>
  act(async () =>
    root.render(
      createElement(WorkspaceSourceControl, {
        cwd,
        paths: Object.keys(worktrees),
        worktrees,
        checkouts: true,
        focusPath,
        enabled: true,
        onOpen: opened,
      }),
    ),
  );
const mounted = () => [...host.querySelectorAll("section")].map((panel) => panel.dataset.cwd);
const text = (path: string) => host.querySelector<HTMLElement>(`[data-cwd="${path}"]`)!;
const scopeButton = (path: string) =>
  [...text(path).querySelectorAll("button")].find((button) => button.textContent === "scope")!;
const cleanTrees = Object.fromEntries(
  Object.entries(trees).map(([path, item]) => [path, { ...item, dirty: false }]),
);

it("has no tabs and no worktree selector in the overview", async () => {
  await renderCheckouts();
  expect(host.querySelector("select")).toBeNull();
  expect(host.querySelector('[role="tab"]')).toBeNull();
});
it("lists only worktrees with uncommitted changes as same-level sections, session first", async () => {
  await renderCheckouts();
  // The clean project folder and the clean worktrees live in the header picker, not here.
  expect(mounted()).toEqual(["/t/mine", "/t/work"]);
  // Same level: every section sits directly in the overview, with no indent wrapper.
  for (const section of host.querySelectorAll("section")) {
    expect(section.parentElement!.parentElement).toBe(
      host.querySelector("[data-checkout-overview]"),
    );
  }
  expect(host.textContent).not.toContain("With changes");
  expect(host.textContent).not.toContain("Clean");
  expect(host.textContent).not.toContain("idle");
});
it("opens the first section and leaves the others one click away", async () => {
  await renderCheckouts();
  expect(text("/t/mine").querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  expect(text("/t/work").querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  await act(async () => text("/t/work").querySelector("button")!.click());
  expect(text("/t/work").querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
});
it("runs child-repository discovery only for the listed sections", async () => {
  await renderCheckouts();
  expect(discover).toHaveBeenLastCalledWith(["/t/mine", "/t/work"], true, true);
  for (const call of discover.mock.calls) expect(call[0]).not.toContain("/t/idle");
});
it("shows the session worktree when no worktree has uncommitted changes", async () => {
  await renderCheckouts("/t/mine/src", cleanTrees);
  expect(mounted()).toEqual(["/t/mine"]);
});
it("never counts an unknown state as changes: such a worktree is not a section", async () => {
  const unknown = Object.fromEntries(
    Object.entries(trees).map(([path, item]) => [path, { ...item, dirty: null }]),
  );
  await renderCheckouts("/t/mine/src", unknown);
  expect(mounted()).toEqual(["/t/mine"]);
});
it("keeps expansion and scroll across remounts of the same session", async () => {
  await renderCheckouts();
  await act(async () => text("/t/work").querySelector("button")!.click());
  const overview = host.querySelector<HTMLElement>("[data-checkout-overview]")!;
  overview.scrollTop = 120;
  overview.dispatchEvent(new Event("scroll"));
  await renderCheckouts(undefined, trees, "/t/idle");
  expect(mounted()).toEqual(["/t/idle"]);
  await renderCheckouts();
  expect(text("/t/work").querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector<HTMLElement>("[data-checkout-overview]")!.scrollTop).toBe(120);
});
it("shows only the focused worktree as one panel with no overview", async () => {
  await renderCheckouts("/t/mine/src", trees, "/t/idle");
  expect(mounted()).toEqual(["/t/idle"]);
  const panel = host.querySelector<HTMLElement>("section")!;
  expect(panel.getAttribute("data-compact")).toBe("false");
  expect(panel.dataset.hasCheckout).toBe("true");
  expect(host.querySelector("[data-checkout-overview]")).toBeNull();
  expect(host.querySelector("select")).toBeNull();
  expect(discover).toHaveBeenLastCalledWith(["/t/idle"], true, true);
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "diff")!.click(),
  );
  expect(opened.mock.calls[0][0]).toMatchObject({ cwd: "/t/idle" });
});
it("treats the project folder as a focus like any worktree", async () => {
  await renderCheckouts("/t/mine/src", trees, "/repo");
  expect(mounted()).toEqual(["/repo"]);
});
it("lists a focused worktree and its separate repositories as same-level sections", async () => {
  discovery.modules = { "/t/idle": ["/t/idle/pkg"] };
  await renderCheckouts("/t/mine/src", trees, "/t/idle");
  expect(mounted()).toEqual(["/t/idle", "/t/idle/pkg"]);
  // No indent wrapper for the nested repository: it sits at the root section level.
  expect(text("/t/idle/pkg").parentElement!.className).toBe(
    text("/t/idle").parentElement!.className,
  );
  expect(text("/t/idle/pkg").parentElement!.parentElement).toBe(
    text("/t/idle").parentElement!.parentElement,
  );
  expect(text("/t/idle/pkg").dataset.nested).toBe("true");
  expect(text("/t/idle").dataset.nested).toBe("false");
  expect(host.textContent).not.toContain("Separate repository");
});
it("never lists another worktree as a separate repository of the focused one", async () => {
  // A worktree that lives inside the project folder is found by child discovery too.
  discovery.modules = { "/repo": ["/repo/mobile", "/t/work", "/t/idle"] };
  await renderCheckouts("/t/mine/src", trees, "/repo");
  expect(mounted()).toEqual(["/repo", "/repo/mobile"]);
  const mobile = text("/repo/mobile");
  expect(mobile.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  expect(mobile.dataset.nested).toBe("true");
});
it("narrows to one repository from its menu, persists it per project and shows all again", async () => {
  discovery.modules = { "/repo": ["/repo/mobile"] };
  await renderCheckouts("/t/mine/src", trees, "/repo");
  expect(text("/repo").dataset.scope).toBe("all");
  await act(async () => scopeButton("/repo/mobile").click());
  expect(mounted()).toEqual(["/repo/mobile"]);
  expect(text("/repo/mobile").dataset.scope).toBe("only");
  expect(localStorage.getItem("bycoda.sourceControl.onlyRepository.v1:/repo")).toBe("/repo/mobile");
  // The choice survives a remount.
  await act(async () => root.unmount());
  root = createRoot(host);
  resetRetainedState();
  await renderCheckouts("/t/mine/src", trees, "/repo");
  expect(mounted()).toEqual(["/repo/mobile"]);
  await act(async () => scopeButton("/repo/mobile").click());
  expect(mounted()).toEqual(["/repo", "/repo/mobile"]);
  expect(localStorage.getItem("bycoda.sourceControl.onlyRepository.v1:/repo")).toBeNull();
});
it("offers the single-repository toggle only when there are several sections", async () => {
  await renderCheckouts("/t/mine/src", trees, "/t/idle");
  expect(text("/t/idle").dataset.scope).toBeUndefined();
});
it("falls back to the overview when the focused worktree left the list", async () => {
  await renderCheckouts("/t/mine/src", trees, "/t/gone");
  expect(host.querySelector("[data-checkout-overview]")).not.toBeNull();
  expect(mounted()).toEqual(["/t/mine", "/t/work"]);
});
it("falls back to the project folder outside every worktree", async () => {
  await renderCheckouts("/elsewhere", cleanTrees);
  expect(mounted()).toEqual(["/repo"]);
});
it("drops the retired per-session checkout choices once", async () => {
  localStorage.setItem("bycoda.sourceControl.checkout.v1:/t/mine", "/t/idle");
  await renderCheckouts();
  expect(localStorage.getItem("bycoda.sourceControl.checkout.v1:/t/mine")).toBeNull();
  // The stored choice no longer retargets the panel.
  expect(mounted()).toEqual(["/t/mine", "/t/work"]);
});
