// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LAZY_DIFF_EAGER } from "../model/lazyDiffLoader";
import { CommitDiff } from "./CommitDiff";

const api = vi.hoisted(() => ({ files: vi.fn(), diff: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  gitCommitFiles: api.files,
  gitCommitFileDiff: api.diff,
  subscribeGitChanged: () => () => {},
  basename: (path: string) => path.split("/").pop(),
}));
vi.mock("./UnifiedDiffView", () => ({ UnifiedDiffView: () => null }));

let container: HTMLDivElement;
let root: Root;
const FILE_COUNT = 60;
const files = Array.from({ length: FILE_COUNT }, (_, index) => ({
  relative: `f${index}.txt`,
  path: `f${index}.txt`,
  status: "modified",
  staged: false,
  unstaged: false,
  additions: 1,
  deletions: 1,
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  api.files.mockResolvedValue(files);
  api.diff.mockResolvedValue({ original: "a\n", current: "b\n", binary: false, tooLarge: false });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("reads only the first screenful of a large commit, not every file (#1174)", async () => {
  await act(async () => root.render(createElement(CommitDiff, { cwd: "/repo", sha: "aaaa" })));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(api.files).toHaveBeenCalledTimes(1);
  expect(api.diff.mock.calls.length).toBeGreaterThan(0);
  expect(api.diff.mock.calls.length).toBeLessThanOrEqual(LAZY_DIFF_EAGER);
  expect(api.diff.mock.calls.length).toBeLessThan(FILE_COUNT);
});
