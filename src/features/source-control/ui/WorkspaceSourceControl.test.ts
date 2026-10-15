// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceSourceControl } from "./WorkspaceSourceControl";
import type { Worktree } from "../model/worktrees";
import { saveWorkspaceProjectNames } from "../../workspace/model/tabGroups";
import { OPEN_WORKTREE_MANAGEMENT } from "../model/worktreeManagement";

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
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
vi.mock("./GitChangesPanel", () => ({
  GitChangesPanel: (props: {
    cwd: string;
    embedded?: boolean;
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
      { "data-cwd": props.cwd, "data-compact": !!props.embedded },
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
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  opened.mockClear();
  notify.mockClear();
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
  await render();
  await choose("/wallet/mobile");
  await render(["/wallet/api"]);
  expect(host.querySelector("select")!.value).toBe("");
  expect(host.querySelector('[data-cwd="/wallet/api"]')).not.toBeNull();
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
it("shows a lightweight overview for all checkouts and selects from its rows", async () => {
  await renderCheckouts();
  await choose("");
  expect(host.querySelector("section")).toBeNull();
  const list = host.querySelector("[data-checkout-list]")!;
  expect(list.textContent).toContain("This session");
  expect(list.textContent).toContain("Main folder");
  expect(list.textContent).not.toContain("idle");
  const toggle = [...list.querySelectorAll("button")].find((b) => b.hasAttribute("aria-expanded"))!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle.click());
  expect(list.textContent).toContain("idle");
  await act(async () =>
    [...list.querySelectorAll("button")].find((b) => b.title === "/t/idle")!.click(),
  );
  expect(host.querySelector("section")!.dataset.cwd).toBe("/t/idle");
});
it("routes worktree deletion from the overview without selecting or deleting a checkout", async () => {
  const request = vi.fn();
  window.addEventListener(OPEN_WORKTREE_MANAGEMENT, request);
  try {
    await renderCheckouts();
    await choose("");
    const buttons = host.querySelectorAll<HTMLButtonElement>('[aria-label="Delete worktree"]');
    expect(buttons).toHaveLength(1);
    await act(async () => buttons[0].click());
    expect((request.mock.calls[0][0] as CustomEvent).detail).toEqual({ cwd: "/t/mine/src", deletePath: "/t/mine" });
    expect(host.querySelector("select")!.value).toBe("");
    expect(opened).not.toHaveBeenCalled();
  } finally { window.removeEventListener(OPEN_WORKTREE_MANAGEMENT, request); }
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
  expect(host.querySelector("[data-checkout-list]")).not.toBeNull();
});
