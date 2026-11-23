// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitHistoryCommit } from "../../../platform/tauri/fs";
import { GitFileInspector, requestGitFileInspect } from "./GitFileInspector";

const reads = vi.hoisted(() => ({ history: vi.fn(), blame: vi.fn() }));
vi.mock("../../../platform/tauri/fs", () => ({
  gitFileHistory: reads.history,
  gitBlame: reads.blame,
  readTextFile: async () => "file text",
}));

let root: Root;
let host: HTMLDivElement;
const commit: GitHistoryCommit = {
  sha: "abcdef",
  shortSha: "abc",
  parents: [],
  author: "Author",
  timestamp: 1,
  subject: "Origin commit",
  refs: [],
  head: false,
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  reads.history.mockResolvedValue([commit]);
  reads.blame.mockResolvedValue([{ ...commit, summary: commit.subject, line: 1 }]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each(["history", "blame"] as const)(
  "opens a %s commit in its original repository after the active checkout changes",
  async (kind) => {
    const beforeSwitch = vi.fn();
    const afterSwitch = vi.fn();
    await act(async () =>
      root.render(createElement(GitFileInspector, { onOpenCommit: beforeSwitch })),
    );
    await act(async () =>
      requestGitFileInspect({ kind, cwd: "/origin/submodule", relative: "file.ts" }),
    );
    await act(async () =>
      root.render(createElement(GitFileInspector, { onOpenCommit: afterSwitch })),
    );
    const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (item) => item.textContent?.includes(kind === "history" ? commit.subject : commit.shortSha),
    )!;
    expect(button).toBeDefined();
    await act(async () => button.click());
    expect(afterSwitch).toHaveBeenCalledWith(commit, true, "/origin/submodule");
    expect(beforeSwitch).not.toHaveBeenCalled();
  },
);

// Regression for #1272: a long author name must be able to shrink so the subject keeps its width.
it("lets a long author name shrink and truncate instead of crushing the commit subject", async () => {
  const author = "A very long author name that would otherwise take the whole history row";
  reads.history.mockResolvedValue([{ ...commit, author }]);
  await act(async () => root.render(createElement(GitFileInspector, { onOpenCommit: vi.fn() })));
  await act(async () =>
    requestGitFileInspect({ kind: "history", cwd: "/repo", relative: "file.ts" }),
  );
  const row = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (item) => item.textContent?.includes(commit.subject),
  )!;
  const name = [...row.querySelectorAll<HTMLElement>("*")].find(
    (node) => node.children.length === 0 && node.textContent === author,
  )!;
  expect(name.className).toContain("min-w-0");
  expect(name.className).toContain("max-w-32");
  expect(name.className).not.toContain("shrink-0");
  const subject = [...row.querySelectorAll<HTMLElement>("*")].find(
    (node) => node.textContent === commit.subject,
  )!;
  expect(subject.className).toContain("flex-1");
});
