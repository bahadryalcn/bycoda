// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickDeleteWorktreeDialog } from "./QuickDeleteWorktreeDialog";
import { listWorktrees, type Worktree } from "../model/worktrees";
import { gitDiffIndex, type GitDiffIndex } from "../../../platform/tauri/fs";

vi.mock("../model/worktrees", () => ({ listWorktrees: vi.fn() }));
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
const render = () =>
  act(async () =>
    root.render(
      createElement(QuickDeleteWorktreeDialog, {
        request: { cwd: "remote://host/repo", deletePath: tree.path },
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

it("does not treat a status failure as zero changes or allow deletion", async () => {
  vi.mocked(gitDiffIndex).mockRejectedValue(new Error("Status unavailable"));
  await render();
  expect(remove().disabled).toBe(true);
  expect(document.querySelector("dl")).toBeNull();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Git operation failed")!
      .click(),
  );
  expect(document.body.textContent).toContain("Status unavailable");
  expect(onRemove).not.toHaveBeenCalled();
});

it.each([{ locked: true }, { isMain: true }, { branch: null }])(
  "keeps deletion safeguards for %s",
  async (blocked) => {
    vi.mocked(listWorktrees).mockResolvedValue({
      worktrees: [{ ...tree, ...blocked }],
      defaultRoot: "/trees",
    });
    await render();
    expect(remove().disabled).toBe(true);
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
      .find((button) => button.textContent === "Git operation failed")!
      .click(),
  );
  expect(document.querySelector("pre")?.textContent).toContain("worktree remove failed");
});
