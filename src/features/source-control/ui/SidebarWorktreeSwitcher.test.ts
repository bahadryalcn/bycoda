// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import {
  setWorktreeFocus,
  worktreeFocus,
  type WorktreeFocus,
} from "../model/worktreeFocus";
import { type Worktree } from "../model/worktrees";
import { createProjectWorktree as createWorktree } from "../model/remoteWorktrees";
import { SidebarWorktreeSwitcher } from "./SidebarWorktreeSwitcher";

vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: vi.fn(),
}));
vi.mock("../model/remoteWorktrees", async (original) => ({
  ...(await original<typeof import("../model/remoteWorktrees")>()),
  createProjectWorktree: vi.fn(),
}));
const tree = (
  path: string,
  branch: string | null,
  isMain = false,
): Worktree => ({
  path,
  branch,
  isMain,
  head: "abcdef123456",
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
});
const refresh = vi.fn<() => Promise<boolean>>();
let root: Root;
let container: HTMLDivElement;
const select = vi.fn<(focus?: WorktreeFocus) => void>();
const render = async (pending = false, switchError?: string) => {
  await act(async () =>
    root.render(
      createElement(SidebarWorktreeSwitcher, {
        cwd: "/picker",
        onSelect: select,
        pending,
        switchError,
      }),
    ),
  );
};
const trigger = () =>
  container.querySelector<HTMLButtonElement>('[aria-label="Switch worktree"]')!;
const option = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent?.includes(name),
  )!;
const copyName = () =>
  trigger().querySelector("[data-workspace-copy-name] > :not([aria-hidden])")
    ?.textContent;
const search = () =>
  document.querySelector<HTMLInputElement>(
    'input[placeholder="Search or create a worktree…"]',
  )!;
const typeQuery = async (value: string) => {
  await act(async () => {
    const input = search();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const press = async (key: string, target: HTMLElement = search()) => {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );
};
const createButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.startsWith("Create worktree "),
  ) ?? null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setWorktreeFocus("/picker", undefined);
  select.mockReset();
  refresh.mockReset().mockResolvedValue(true);
  vi.mocked(createWorktree).mockReset();
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: [
        tree("/picker", "main", true),
        tree("/picker-a", "feature-a"),
        tree("/picker-b", "feature-b"),
      ],
      defaultRoot: "/picker-worktrees",
    },
    refresh,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("requests a switch without publishing the destination and permits a newer selection", async () => {
  await render();
  await act(async () => trigger().click());
  await act(async () => option("feature-a").click());
  expect(select).toHaveBeenLastCalledWith({
    path: "/picker-a",
    branch: "feature-a",
  });
  expect(worktreeFocus("/picker")).toBeUndefined();
  await render(true);
  expect(trigger().getAttribute("aria-busy")).toBe("true");
  expect(copyName()).toBe("All worktrees");
  await act(async () => trigger().click());
  await act(async () => option("feature-b").click());
  expect(select).toHaveBeenLastCalledWith({
    path: "/picker-b",
    branch: "feature-b",
  });
  expect(worktreeFocus("/picker")).toBeUndefined();
});

it("shows a switch failure in the reopened picker", async () => {
  await render();
  await render(false, "Working copy no longer exists");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Working copy no longer exists",
  );
  expect(copyName()).toBe("All worktrees");
});

it("names the project and the focused working copy in the trigger", async () => {
  setWorktreeFocus("/picker", { path: "/picker-a", branch: "feature-a" });
  await render();
  expect(trigger().textContent).toBe("pickerfeature-a");
});

it("requests fallback from a deleted worktree once and does not retry while pending or failed", async () => {
  setWorktreeFocus("/picker", { path: "/deleted", branch: "gone" });
  await render();
  expect(select).toHaveBeenCalledExactlyOnceWith(undefined);
  await render(true);
  await render(false, "Could not switch working copy");
  expect(select).toHaveBeenCalledTimes(1);
  expect(worktreeFocus("/picker")?.path).toBe("/deleted");
});

it("filters branches and paths without case or surrounding whitespace", async () => {
  await render();
  await act(async () => trigger().click());
  await typeQuery("  FEATURE-A  ");
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(option("feature-a")).toBeDefined();
  expect(createButton()).toBeNull();

  await typeQuery("/PICKER-B");
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(option("feature-b")).toBeDefined();

  await typeQuery("main");
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  await press("Enter");
  expect(select).toHaveBeenLastCalledWith({ path: "/picker", branch: "main" });
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("supports keyboard navigation and clears search after dismissal", async () => {
  await render();
  await press("ArrowDown", trigger());
  await press("ArrowDown");
  await press("ArrowDown");
  await press("ArrowDown");
  await press("Enter");
  expect(select).toHaveBeenLastCalledWith({
    path: "/picker-b",
    branch: "feature-b",
  });

  await act(async () => trigger().click());
  await typeQuery("feature-a");
  await press("Escape");
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  await act(async () => trigger().click());
  expect(search().value).toBe("");
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(4);
});

it.each(["click", "Enter"])(
  "creates and requests the searched worktree with %s after refreshing the list",
  async (action) => {
    const created = tree("/picker-worktrees/feature-new", "feature/new");
    vi.mocked(createWorktree).mockResolvedValue(created);
    refresh.mockImplementation(async () => {
      expect(select).not.toHaveBeenCalled();
      return true;
    });
    await render();
    await act(async () => trigger().click());
    await typeQuery("  feature/new  ");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(createButton()?.textContent).toContain(
      "Create worktree feature/new",
    );
    if (action === "click") {
      await act(async () => createButton()!.click());
    } else {
      await press("Enter");
    }
    expect(createWorktree).toHaveBeenCalledExactlyOnceWith(
      "/picker",
      "feature/new",
      "HEAD",
      false,
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledExactlyOnceWith({
      path: created.path,
      branch: created.branch,
    });
    expect(worktreeFocus("/picker")).toBeUndefined();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  },
);

it("keeps the switcher available to create the first extra worktree", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: [tree("/picker", "main", true)],
      defaultRoot: "/picker-worktrees",
    },
    refresh,
  });
  await render();
  await act(async () => trigger().click());
  await typeQuery("first-worktree");
  expect(createButton()).not.toBeNull();
  await typeQuery("   ");
  expect(createButton()).toBeNull();
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
});

it("creates from the focused working copy's current commit", async () => {
  setWorktreeFocus("/picker", { path: "/picker-a", branch: "feature-a" });
  vi.mocked(createWorktree).mockResolvedValue(tree("/picker-new", "new"));
  await render();
  await act(async () => trigger().click());
  await typeQuery("new");
  await press("Enter");
  expect(createWorktree).toHaveBeenCalledExactlyOnceWith(
    "/picker-a",
    "new",
    "HEAD",
    false,
  );
});

it("shows creation errors and allows correcting the name before retrying", async () => {
  vi.mocked(createWorktree).mockRejectedValueOnce(
    new Error("Enter a valid branch name"),
  );
  await render();
  await act(async () => trigger().click());
  await typeQuery("invalid name");
  await press("Enter");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Enter a valid branch name",
  );
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(search().value).toBe("invalid name");
  expect(search().disabled).toBe(false);
  expect(select).not.toHaveBeenCalled();

  vi.mocked(createWorktree).mockResolvedValue(
    tree("/picker-new", "valid-name"),
  );
  await typeQuery("valid-name");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await press("Enter");
  expect(select).toHaveBeenCalledExactlyOnceWith({
    path: "/picker-new",
    branch: "valid-name",
  });
});

it.each([undefined, "Could not load working copies"])(
  "does not offer creation before worktrees have loaded (error: %s)",
  async (error) => {
    vi.mocked(useProjectWorktrees).mockReturnValue({ error, refresh });
    await render();
    await act(async () => trigger().click());
    await typeQuery("new-worktree");
    expect(createButton()).toBeNull();
    await press("Enter");
    expect(createWorktree).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  },
);

it("prevents duplicate creation and keeps its progress visible", async () => {
  let resolve!: (tree: Worktree) => void;
  vi.mocked(createWorktree).mockReturnValue(
    new Promise<Worktree>((done) => {
      resolve = done;
    }),
  );
  await render();
  await act(async () => trigger().click());
  await typeQuery("new-worktree");
  await press("Enter");
  expect(search().disabled).toBe(true);
  expect(createButton()?.getAttribute("aria-disabled")).toBe("true");
  expect(trigger().getAttribute("aria-busy")).toBe("true");
  await press("Enter");
  await press("Escape");
  expect(createWorktree).toHaveBeenCalledTimes(1);
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(select).not.toHaveBeenCalled();

  await act(async () => resolve(tree("/picker-new", "new-worktree")));
  expect(select).toHaveBeenCalledExactlyOnceWith({
    path: "/picker-new",
    branch: "new-worktree",
  });
  expect(trigger().getAttribute("aria-busy")).not.toBe("true");
});

it("does not navigate another project when an earlier creation finishes", async () => {
  let finish!: (created: Worktree) => void;
  vi.mocked(createWorktree).mockReturnValue(
    new Promise<Worktree>((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  await act(async () => trigger().click());
  await typeQuery("new-worktree");
  await press("Enter");
  await act(async () =>
    root.render(
      createElement(SidebarWorktreeSwitcher, {
        cwd: "/another-project",
        onSelect: select,
      }),
    ),
  );
  await act(async () => finish(tree("/picker-new", "new-worktree")));
  expect(select).not.toHaveBeenCalled();
});

it("labels detached and folder-only working copies with the shared messages", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: [tree("/picker", null, true), tree("/picker-d", null)],
      defaultRoot: "/picker-worktrees",
    },
    refresh,
  });
  setWorktreeFocus("/picker", { path: "/picker-d", branch: null });
  await render();
  expect(
    trigger().querySelector("[data-workspace-copy-name] > :not([aria-hidden])")
      ?.textContent,
  ).toBe("Detached abcdef1");
  await act(async () => trigger().click());
  const options = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ];
  expect(options).toHaveLength(3);
  expect(options[0]!.textContent).toContain("All worktrees");
  expect(options[1]!.textContent).toContain("Detached abcdef1");
  expect(options[1]!.textContent).toContain("Project folder");
  expect(options[2]!.textContent).toContain("Detached abcdef1");
});

it("hides missing and prunable worktrees and lists dirty ones before clean ones", async () => {
  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: {
      worktrees: [
        tree("/picker", "main", true),
        tree("/picker-clean", "clean"),
        { ...tree("/picker-dirty", "dirty"), dirty: true },
        { ...tree("/picker-gone", "gone"), missing: true },
        { ...tree("/picker-pruned", "pruned"), prunable: true },
      ],
      defaultRoot: "/picker-worktrees",
    },
    refresh,
  });
  await render();
  await act(async () => trigger().click());
  const titles = [...document.querySelectorAll('[role="option"]')].map(
    (node) => node.textContent,
  );
  expect(titles).toHaveLength(4);
  expect(titles[0]).toContain("All worktrees");
  expect(titles[1]).toContain("main");
  expect(titles[2]).toContain("dirty");
  expect(titles[3]).toContain("clean");
});

it("lists All worktrees first, selected by default, and picks it as no focus", async () => {
  setWorktreeFocus("/picker", { path: "/picker-a", branch: "feature-a" });
  await render();
  await act(async () => trigger().click());
  const first = document.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(first.textContent).toContain("All worktrees");
  expect(first.getAttribute("aria-selected")).not.toBe("true");
  await act(async () => first.click());
  expect(select).toHaveBeenLastCalledWith(undefined);
});

it("marks All worktrees selected without a focus and hides it for one worktree", async () => {
  await render();
  await act(async () => trigger().click());
  const first = document.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(first.textContent).toContain("All worktrees");
  expect(first.getAttribute("aria-selected")).toBe("true");
  await typeQuery("feature");
  expect(option("All worktrees")).toBeUndefined();

  vi.mocked(useProjectWorktrees).mockReturnValue({
    data: { worktrees: [tree("/picker", "main", true)], defaultRoot: "/w" },
    refresh,
  });
  await render();
  await typeQuery("");
  expect(option("All worktrees")).toBeUndefined();
  expect(trigger().textContent).toBe("pickermain");
});

it("treats the project folder as a real focus and keeps it while listed", async () => {
  setWorktreeFocus("/picker", { path: "/picker", branch: "main" });
  await render();
  expect(trigger().textContent).toBe("pickermain");
  expect(select).not.toHaveBeenCalled();
});
