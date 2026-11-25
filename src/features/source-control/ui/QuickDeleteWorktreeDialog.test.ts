// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickDeleteWorktreeDialog } from "./QuickDeleteWorktreeDialog";
import { listWorktrees, type Worktree } from "../model/worktrees";
import { gitDiffIndex, type GitDiffIndex } from "../../../platform/tauri/fs";

vi.mock("../model/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/worktrees")>()),
  listWorktrees: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", () => ({ gitDiffIndex: vi.fn() }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: vi.fn() }));
const tree: Worktree = {
  path: "remote://host/trees/feature",
  branch: "feature",
  isMain: false,
  locked: false,
  missing: false,
  prunable: false,
  dirty: true,
  unpushed: 3,
  head: "abc",
  sessionIds: ["saved"],
};
const index = {
  files: [
    { staged: true, unstaged: false },
    { staged: false, unstaged: true },
    { staged: true, unstaged: true },
  ],
  conflicts: [],
} as unknown as GitDiffIndex;
let host: HTMLDivElement;
let root: Root;
const onRemove = vi.fn();
const onClose = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(listWorktrees).mockResolvedValue({ worktrees: [tree], defaultRoot: "/trees" });
  vi.mocked(gitDiffIndex).mockResolvedValue(index);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const render = (request = { cwd: "remote://host/repo", deletePath: tree.path }) =>
  act(async () =>
    root.render(
      createElement(QuickDeleteWorktreeDialog, {
        request,
        onRemove,
        onClose,
      }),
    ),
  );
const remove = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Delete worktree",
  )!;

it("shows separate changes, staged and unpushed counts and preserves sessions when confirmed", async () => {
  await render();
  expect(gitDiffIndex).toHaveBeenCalledWith(tree.path);
  expect([...document.querySelectorAll("dd")].map((value) => value.textContent)).toEqual([
    "2",
    "2",
    "3",
  ]);
  expect(onRemove).not.toHaveBeenCalled();
  await act(async () => remove().click());
  expect(onRemove).toHaveBeenCalledWith("remote://host/repo", tree.path, true, true);
  expect(onClose).toHaveBeenCalledOnce();
});

it("requires fresh branch-delete consent for each worktree selection", async () => {
  const first = { ...tree, unpushed: 0 };
  const second = { ...first, path: "remote://host/trees/other", branch: "other" };
  vi.mocked(listWorktrees).mockResolvedValue({
    worktrees: [first, second],
    defaultRoot: "/trees",
  });
  await render({ cwd: first.path, deletePath: "" });
  const checkbox = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const select = async (label: string) => {
    const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    await act(async () => trigger.click());
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) => option.textContent?.trim() === label)!
        .click(),
    );
  };

  await act(async () => checkbox().click());
  expect(checkbox().checked).toBe(true);
  await select("other");
  expect(checkbox().checked).toBe(false);
  await select("feature");
  expect(checkbox().checked).toBe(false);
  await select("other");
  await act(async () => remove().click());
  expect(onRemove).toHaveBeenCalledWith(first.path, second.path, true, true);
});

it("does not treat a status failure as zero changes or allow deletion", async () => {
  vi.mocked(gitDiffIndex).mockRejectedValue(new Error("Status unavailable"));
  await render();
  expect(remove().getAttribute("aria-disabled") === "true").toBe(true);
  expect(document.querySelector("dl")).toBeNull();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Details")!
      .click(),
  );
  expect(document.body.textContent).toContain("Status unavailable");
  expect(onRemove).not.toHaveBeenCalled();
});

it("requires renewed consent when the branch at the selected path changes", async () => {
  const first = { ...tree, unpushed: 0 };
  vi.mocked(listWorktrees).mockResolvedValue({ worktrees: [first], defaultRoot: "/trees" });
  await render();
  const checkbox = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox().click());
  expect(checkbox().checked).toBe(true);

  vi.mocked(listWorktrees).mockResolvedValue({
    worktrees: [{ ...first, branch: "renamed" }],
    defaultRoot: "/trees",
  });
  await render();
  expect(document.body.textContent).toContain("Also delete branch renamed");
  expect(checkbox().checked).toBe(false);
  await act(async () => remove().click());
  expect(onRemove).toHaveBeenCalledWith("remote://host/repo", tree.path, true, true);
});

it.each([{ locked: true }, { isMain: true }, { branch: null }])(
  "keeps deletion safeguards for %s",
  async (blocked) => {
    vi.mocked(listWorktrees).mockResolvedValue({
      worktrees: [{ ...tree, ...blocked }],
      defaultRoot: "/trees",
    });
    await render();
    expect(remove().getAttribute("aria-disabled") === "true").toBe(true);
    expect(onRemove).not.toHaveBeenCalled();
  },
);

it("keeps a failed deletion open with the original output", async () => {
  onRemove.mockRejectedValueOnce(new Error("worktree remove failed"));
  await render();
  await act(async () => remove().click());
  expect(onClose).not.toHaveBeenCalled();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Details")!
      .click(),
  );
  expect(document.querySelector("pre")?.textContent).toContain("worktree remove failed");
});
