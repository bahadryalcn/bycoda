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
      (item) => item.textContent?.includes(kind === "history" ? commit.subject : commit.author),
    )!;
    expect(button).toBeDefined();
    await act(async () => button.click());
    expect(afterSwitch).toHaveBeenCalledWith(commit, true, "/origin/submodule");
    expect(beforeSwitch).not.toHaveBeenCalled();
  },
);
