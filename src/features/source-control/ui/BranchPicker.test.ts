// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../../platform/tauri/fs", () => ({
  saveGeneratedImage: vi.fn(),
  deleteGeneratedImages: vi.fn(async () => {}),
  gitBranches: vi.fn(async () => ({
    current: "main",
    detached: false,
    branches: [{ name: "main", current: true, remote: null }],
  })),
  subscribeGitChanged: () => () => {},
  gitCheckout: vi.fn(),
  gitFetch: vi.fn(async () => {}),
  gitCommit: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitCreateBranchFrom: vi.fn(),
  gitStageAll: vi.fn(),
  gitStash: vi.fn(),
  isCheckoutBlockedByChanges: () => false,
  notifyGitChanged: vi.fn(),
}));

const worktreeState = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({ data: worktreeState.data, refresh: async () => true }),
}));

import { BranchPicker } from "./BranchPicker";
import { setWorktreeFocus, worktreeFocus } from "../model/worktreeFocus";
import {
  gitBranches,
  gitCheckout,
  gitFetch,
  notifyGitChanged,
  gitCreateBranch,
  gitCreateBranchFrom,
} from "../../../platform/tauri/fs";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("fetches missing remote refs in place without switching branches or allowing a duplicate fetch", async () => {
  let finish!: () => void;
  vi.mocked(gitFetch)
    .mockClear()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  vi.mocked(gitCheckout).mockClear();
  vi.mocked(notifyGitChanged).mockClear();
  await act(async () =>
    root.render(createElement(BranchPicker, { cwd: "/repo-fetch", branch: "feature" })),
  );
  await act(async () => container.querySelector("button")!.click());
  const fetch = document.querySelector<HTMLButtonElement>('[aria-label="Fetch"]')!;
  await act(async () => fetch.click());
  expect(fetch.getAttribute("aria-busy")).toBe("true");
  await act(async () => fetch.click());
  expect(gitFetch).toHaveBeenCalledTimes(1);
  expect(gitFetch).toHaveBeenCalledWith("/repo-fetch");
  expect(gitCheckout).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(notifyGitChanged).toHaveBeenCalledWith("/repo-fetch", "refs");
  expect(document.querySelector("[data-branch-picker]")).not.toBeNull();
});

it("shows fetch failures inside the branch picker and allows retry", async () => {
  vi.mocked(gitFetch).mockClear().mockRejectedValueOnce(new Error("Remote unavailable"));
  await act(async () =>
    root.render(createElement(BranchPicker, { cwd: "/repo-fetch-error", branch: "main" })),
  );
  await act(async () => container.querySelector("button")!.click());
  const fetch = document.querySelector<HTMLButtonElement>('[aria-label="Fetch"]')!;
  await act(async () => fetch.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Remote unavailable");
  expect(fetch.disabled).toBe(false);
  await act(async () => fetch.click());
  expect(gitFetch).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("autofocuses the branch search input only once the popover frame is visible", async () => {
  const seenVisibility: (string | undefined)[] = [];
  const nativeFocus = HTMLInputElement.prototype.focus;
  vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    const frame = this.closest("[data-popover-side]")?.parentElement as HTMLElement | null;
    seenVisibility.push(frame?.style.visibility);
    return nativeFocus.call(this);
  });

  act(() => root.render(createElement(BranchPicker, { cwd: "/repo", branch: "main" })));
  await act(async () => {});
  const button = container.querySelector("button")!;
  await act(async () => button.click());
  await act(async () => {});

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  );
  expect(input).not.toBeNull();
  // Focusing a `visibility: hidden` element is a no-op in real browsers, so
  // the popover's pre-paint measure pass must never be where focus lands.
  expect(seenVisibility).not.toContain("hidden");
  expect(document.activeElement).toBe(input);
});

it("uses the interface typeface for branch names and search", async () => {
  act(() => root.render(createElement(BranchPicker, { cwd: "/repo", branch: "main" })));
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());

  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const search = picker.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  const branchName = [...picker.querySelectorAll<HTMLElement>('[role="option"] span')].find(
    (node) => node.textContent === "main" && node.getAttribute("data-weight") === "medium",
  )!;

  expect(search.className).not.toContain("font-mono");
  expect(branchName.className).not.toContain("font-mono");
  expect(branchName.getAttribute("data-weight")).toBe("medium");
});

it("asks for a branch name before creating from the fixed action", async () => {
  act(() => root.render(createElement(BranchPicker, { cwd: "/repo", branch: "main" })));
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());

  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const create = [...picker.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "New branch",
  )!;
  const list = picker.querySelector('[role="listbox"][aria-label="Branches"]')!;
  expect(list.contains(create)).toBe(false);
  expect(create.parentElement?.getAttribute("data-surface-frame")).toBe("pane");
  expect(create.parentElement?.getAttribute("data-surface-edge")).toBe("top");
  expect(create.parentElement?.className).toContain("shrink-0");
  expect(create.parentElement).toBe(picker.lastElementChild);
  expect(create.getAttribute("data-button-variant")).toBe("item");

  await act(async () => create.click());
  expect(gitCreateBranch).not.toHaveBeenCalled();

  const input = document.querySelector<HTMLInputElement>('input[aria-label="Branch name"]')!;
  expect(input).not.toBeNull();
  await act(async () => {});
  expect(document.activeElement).toBe(input);

  const submit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Create branch",
  )!;
  expect(submit.disabled).toBe(true);

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, "feature/picker");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(submit.disabled).toBe(false);

  await act(async () => submit.click());
  expect(gitCreateBranch).toHaveBeenCalledWith("/repo", "feature/picker");
});

it.each(["develop", "origin/release", "origin/unlisted", "  origin/release  "])(
  "creates and checks out a new branch from %s",
  async (reference) => {
    const cwd = `/repo-create-from-${reference}`;
    vi.mocked(gitBranches).mockResolvedValueOnce({
      current: "main",
      detached: false,
      branches: [
        { name: "main", current: true, remote: null },
        { name: "develop", current: false, remote: null },
        { name: "release", current: false, remote: "origin" },
      ],
    });
    act(() => root.render(createElement(BranchPicker, { cwd, branch: "main" })));
    await act(async () => {});
    await act(async () => container.querySelector("button")!.click());
    const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
    const create = [...picker.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "New branch from…",
    )!;
    await act(async () => create.click());

    const base = document.querySelector<HTMLInputElement>('input[aria-label="Base branch"]')!;
    expect(base.value).toBe("main");
    expect([...base.list!.options].map((option) => option.value)).toEqual([
      "main",
      "develop",
      "origin/release",
    ]);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        base,
        reference,
      );
      base.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Branch name"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "feature/from-base");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(gitCreateBranchFrom).toHaveBeenCalledWith(cwd, "feature/from-base", reference.trim());
    expect(gitCheckout).not.toHaveBeenCalledWith(cwd, reference, expect.anything());
    expect(document.querySelector('input[aria-label="Base branch"]')).toBeNull();
  },
);

it("updates the branch creation row with the entered name", async () => {
  act(() => root.render(createElement(BranchPicker, { cwd: "/repo", branch: "main" })));
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, "feature/picker");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const create = [...picker.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.querySelector("[data-middle-truncate] > :not([aria-hidden])")?.textContent ===
      "Create and checkout feature/picker",
  );
  expect(create).not.toBeUndefined();
  expect(create?.parentElement?.getAttribute("data-surface-frame")).toBe("pane");
  expect(create?.parentElement?.getAttribute("data-surface-edge")).toBe("top");
});

it("checks out the highlighted matching branch when Enter is pressed", async () => {
  vi.mocked(gitBranches).mockResolvedValueOnce({
    current: "main",
    detached: false,
    branches: [
      { name: "main", current: true, remote: null },
      { name: "feature/picker", current: false, remote: null },
    ],
  });
  act(() =>
    root.render(
      createElement(BranchPicker, {
        cwd: "/repo-enter-existing",
        branch: "main",
      }),
    ),
  );
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, "picker");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  const highlighted = picker.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(highlighted.textContent).toContain("feature/picker");
  expect(
    [...picker.querySelectorAll<HTMLButtonElement>("button")].some(
      (button) =>
        button.querySelector("[data-middle-truncate] > :not([aria-hidden])")?.textContent ===
        "Create and checkout picker",
    ),
  ).toBe(true);

  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  expect(gitCheckout).toHaveBeenCalledWith("/repo-enter-existing", "feature/picker", null);
  expect(gitCreateBranch).not.toHaveBeenCalledWith("/repo-enter-existing", "picker");
});

it("is a branches-only picker: no worktree tabs or worktree choice", async () => {
  await act(async () =>
    root.render(createElement(BranchPicker, { cwd: "/t/task", branch: "main" })),
  );
  const trigger = container.querySelector("button")!;
  expect(trigger.textContent).toContain("main");
  expect(trigger.getAttribute("aria-label")).toBe("Branch main");
  await act(async () => trigger.click());
  const picker = document.querySelector<HTMLElement>("[data-branch-picker]")!;
  expect(picker.querySelector('[role="tab"]')).toBeNull();
  expect(picker.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Branches");
});

it("windows a repository with thousands of branches and still searches all of them", async () => {
  const sized = (element: HTMLElement) => (element.getAttribute("role") === "listbox" ? 240 : 32);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return sized(this);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return sized(this);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(0, 0, 280, sized(this));
  });
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(gitBranches).mockResolvedValueOnce({
    current: "main",
    detached: false,
    branches: [
      { name: "main", current: true, remote: null },
      ...Array.from({ length: 3000 }, (_, index) => ({
        name: `feature-${index}`,
        current: false,
        remote: "origin",
      })),
    ],
  });
  act(() => root.render(createElement(BranchPicker, { cwd: "/repo-many", branch: "main" })));
  await act(async () => {});
  await act(async () => container.querySelector("button")!.click());
  await act(async () => {});

  const rows = () => document.querySelectorAll<HTMLElement>('[role="option"]');
  expect(rows().length).toBeGreaterThan(0);
  expect(rows().length).toBeLessThan(60);
  expect(rows()[0]!.getAttribute("aria-setsize")).toBe("3001");

  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search or create a branch"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "feature-2999",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(rows()).toHaveLength(1);
  expect(rows()[0]!.textContent).toContain("feature-2999");
});

const liveTree = (path: string, branch: string, isMain = false) => ({
  path,
  branch,
  head: "abc",
  isMain,
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
});

async function openWithWorktreeBranch(props: Record<string, unknown>) {
  worktreeState.data = {
    defaultRoot: "/wt",
    worktrees: [liveTree("/repo-wt", "main", true), liveTree("/wt/feat", "feat/x")],
  };
  vi.mocked(gitBranches).mockResolvedValueOnce({
    current: "main",
    detached: false,
    branches: [
      { name: "feat/x", current: false, remote: null },
      { name: "free", current: false, remote: null },
      { name: "main", current: true, remote: null },
    ],
  });
  vi.mocked(gitCheckout).mockClear();
  await act(async () =>
    root.render(createElement(BranchPicker, { cwd: "/repo-wt", branch: "main", ...props })),
  );
  await act(async () => container.querySelector("button")!.click());
  await act(async () => {});
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  return options.find((option) => option.textContent?.includes("feat/x"))!;
}

it("badges a worktree branch, groups it last and goes to the worktree instead of checking out", async () => {
  const onSelectWorktree = vi.fn();
  const row = await openWithWorktreeBranch({ onSelectWorktree });
  expect(row.textContent).toContain("worktree");
  expect(document.querySelector("[data-branch-picker]")?.textContent).toContain("In a worktree");
  await act(async () => row.click());
  expect(onSelectWorktree).toHaveBeenCalledWith(expect.objectContaining({ path: "/wt/feat" }));
  expect(gitCheckout).not.toHaveBeenCalled();
  worktreeState.data = undefined;
});

it("disables a worktree branch on a started session and states why", async () => {
  const onSelectWorktree = vi.fn();
  const row = await openWithWorktreeBranch({ onSelectWorktree, worktreeLocked: true });
  expect(row.textContent).toContain("A started session stays in its worktree");
  await act(async () => row.click());
  expect(onSelectWorktree).not.toHaveBeenCalled();
  expect(gitCheckout).not.toHaveBeenCalled();
  worktreeState.data = undefined;
});

it("keeps the project folder as the focus when its branch is chosen from another worktree", async () => {
  worktreeState.data = {
    defaultRoot: "/wt",
    worktrees: [liveTree("/repo-wt", "main", true), liveTree("/wt/feat", "feat/x")],
  };
  vi.mocked(gitBranches).mockResolvedValueOnce({
    current: "feat/x",
    detached: false,
    branches: [
      { name: "feat/x", current: true, remote: null },
      { name: "main", current: false, remote: null },
    ],
  });
  vi.mocked(gitCheckout).mockClear();
  setWorktreeFocus("/repo-wt", { path: "/wt/feat", branch: "feat/x" });
  await act(async () =>
    root.render(createElement(BranchPicker, { cwd: "/wt/feat", branch: "feat/x" })),
  );
  await act(async () => container.querySelector("button")!.click());
  await act(async () => {});
  const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
    option.textContent?.includes("main"),
  )!;
  await act(async () => row.click());
  expect(worktreeFocus("/repo-wt")).toEqual({ path: "/repo-wt", branch: "main" });
  expect(gitCheckout).not.toHaveBeenCalled();
  setWorktreeFocus("/repo-wt", undefined);
  worktreeState.data = undefined;
});
