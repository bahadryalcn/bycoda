// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceControl } from "./SourceControl";
import type { Worktrees, Worktree } from "../model/worktrees";

const state = vi.hoisted(() => ({
  snapshot: {} as { data?: Worktrees; error?: string },
  refresh: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ ...state.snapshot, refresh: state.refresh }),
}));
vi.mock("../../../platform/tauri/fs", () => ({
  basename: (path: string) => path.split("/").pop(),
  notifyGitChanged: state.notify,
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
    repository?: {
      name: string;
      expanded?: boolean;
      onToggle: (expanded: boolean) => void;
    };
    onOpenFile: (file: string, kind: string) => void;
    onOpenCommit: (commit: { sha: string }) => void;
  }) =>
    createElement(
      "section",
      { "data-cwd": props.cwd },
      createElement(
        "button",
        {
          "aria-expanded": props.repository?.expanded,
          onClick: () => props.repository?.onToggle(!props.repository.expanded),
        },
        props.repository?.name ?? "Changes",
      ),
      createElement("button", { onClick: () => props.onOpenFile("same.ts", "unstaged") }, "diff"),
      createElement("button", { onClick: () => props.onOpenCommit({ sha: "abc" }) }, "commit"),
    ),
}));
let container: HTMLDivElement;
let root: Root;
const opened = vi.fn();
const directOpen = vi.fn();
const tree = (path: string, branch: string, isMain = false): Worktree => ({
  path,
  branch,
  isMain,
  head: "abc",
  locked: false,
  prunable: false,
  missing: false,
  dirty: true,
  unpushed: 0,
  sessionIds: [],
});
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.snapshot = {};
  state.refresh.mockReset();
  state.notify.mockReset();
  opened.mockReset();
  directOpen.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (cwd = "/repo", repositoryPaths?: string[]) =>
  act(async () =>
    root.render(
      createElement(SourceControl, {
        cwd,
        repositoryPaths,
        enabled: true,
        onOpenRepository: opened,
        onOpenFile: directOpen,
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
it("opens the session checkout, lists others in the overview, and scopes diffs and commits", async () => {
  state.snapshot = {
    data: {
      defaultRoot: "/trees",
      worktrees: [
        tree("/repo", "main", true),
        tree("/trees/task", "mc/task"),
        { ...tree("/trees/deleted", "mc/deleted"), missing: true },
      ],
    },
  };
  await render("/trees/task/src");
  expect(container.querySelectorAll("section")).toHaveLength(1);
  expect(container.querySelector("section")?.dataset.cwd).toBe("/trees/task");
  const options = [...container.querySelectorAll("option")].map((option) => option.textContent);
  expect(options).toEqual(["All checkouts", "main · repo", "mc/task · task · This session"]);
  const buttons = container.querySelector("section")!.querySelectorAll("button");
  await act(async () => buttons[1].click());
  expect(opened).toHaveBeenLastCalledWith({
    type: "diff",
    cwd: "/trees/task",
    path: "same.ts",
    kind: "unstaged",
    pin: undefined,
  });
  await act(async () => buttons[2].click());
  expect(opened).toHaveBeenLastCalledWith({
    type: "commit",
    cwd: "/trees/task",
    commit: { sha: "abc" },
    pin: undefined,
  });
  expect(directOpen).not.toHaveBeenCalled();
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("section")).toBeNull();
  expect(container.textContent).toContain("mc/task");
  expect(container.textContent).not.toContain("mc/deleted");
});
it("selects a remote worktree without changing machine identity and returns to all checkouts", async () => {
  const main = "remote://mac/Users/me/repo";
  const task = "remote://mac/Users/me/trees/task";
  state.snapshot = {
    data: {
      defaultRoot: "remote://mac/Users/me/trees",
      worktrees: [tree(main, "main", true), tree(task, "mc/task")],
    },
  };
  await render(main);
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = task;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelectorAll("section")).toHaveLength(1);
  expect(container.querySelector("section")?.dataset.cwd).toBe(task);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Refresh source control"]')!.click(),
  );
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.notify).toHaveBeenLastCalledWith(task, "checkout");
  await act(async () => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("section")).toBeNull();
  expect(container.querySelectorAll("[data-checkout-list] li")).toHaveLength(2);
});
it("preserves the ordinary panel when discovery fails and keeps a usable list on refresh failure", async () => {
  state.snapshot = { error: "Unavailable" };
  await render();
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector("section")?.dataset.cwd).toBe("/repo");
  state.snapshot = {
    error: "Unavailable",
    data: {
      defaultRoot: "/trees",
      worktrees: [tree("/repo", "main", true), tree("/trees/task", "mc/task")],
    },
  };
  await render();
  expect(container.querySelectorAll("section")).toHaveLength(1);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Could not refresh worktrees",
  );
});
