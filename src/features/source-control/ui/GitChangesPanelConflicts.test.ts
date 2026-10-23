// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateGitIndex, resetGitIndexStore } from "../model/gitIndexStore";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
  message: vi.fn(async () => {}),
}));

vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffIndex: vi.fn(),
  gitHistory: vi.fn(async () => []),
  gitOperationStatus: vi.fn(async () => ({ operation: null, conflicts: [] })),
  gitOperationContinue: vi.fn(async () => {}),
  gitOperationAbort: vi.fn(async () => {}),
  gitResolveConflict: vi.fn(async () => {}),
  gitConflictStages: vi.fn(),
  gitStashList: vi.fn(async () => []),
  gitBranches: vi.fn(async () => ({ current: "main", detached: false, branches: [] })),
  gitRemotes: vi.fn(async () => []),
  gitTags: vi.fn(async () => []),
  gitPrStatus: vi.fn(async () => null),
  gitPull: vi.fn(async () => {}),
  gitPush: vi.fn(async () => {}),
  gitSync: vi.fn(async () => {}),
  gitCommit: vi.fn(async () => {}),
  gitHeadMessage: vi.fn(async () => ""),
  gitStageAll: vi.fn(async () => {}),
  gitUnstageAll: vi.fn(async () => {}),
  gitDiscardAll: vi.fn(async () => {}),
  gitStageFile: vi.fn(async () => {}),
  gitStageFiles: vi.fn(async () => {}),
  gitDiscardFiles: vi.fn(async () => {}),
  gitUnstageFiles: vi.fn(async () => {}),
  gitUnstageFile: vi.fn(async () => {}),
  gitDiscardFile: vi.fn(async () => {}),
  gitPrCreate: vi.fn(async () => ""),
  gitRangeContext: vi.fn(),
  readTextFile: vi.fn(async () => ""),
  writeTextFile: vi.fn(async () => {}),
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: () => () => {},
  basename: (path: string) => path.split("/").pop() ?? path,
}));

vi.mock("../../../integrations/harness", () => ({
  generateCommitMessage: vi.fn(async () => ""),
  generatePrContent: vi.fn(async () => null),
}));
vi.mock("../../files/model/fileWatch", () => ({
  invalidateWatchedFiles: vi.fn(),
  nudgeWatchedFiles: vi.fn(),
}));
vi.mock("../../inbox/model/inboxSelfActivity", () => ({ recordInboxSelfActivity: vi.fn() }));

import { ask } from "@tauri-apps/plugin-dialog";
import { GitChangesPanel } from "./GitChangesPanel";
import {
  gitDiffIndex,
  gitOperationContinue,
  gitOperationStatus,
  gitResolveConflict,
  gitStageFile,
  readTextFile,
  type GitChangedFile,
  type GitConflictFile,
  type GitDiffIndex,
} from "../../../platform/tauri/fs";

const file = (relative: string, overrides: Partial<GitChangedFile> = {}): GitChangedFile => ({
  path: `/repo/${relative}`,
  relative,
  status: "modified",
  additions: 1,
  deletions: 0,
  staged: false,
  unstaged: true,
  ...overrides,
});
const conflict = (
  relative: string,
  kind: GitConflictFile["kind"] = "both-modified",
): GitConflictFile => ({ path: `/repo/${relative}`, relative, kind });

function index(overrides: Partial<GitDiffIndex> = {}): GitDiffIndex {
  return {
    branch: "feature",
    head: "abc123",
    files: [],
    additions: 0,
    deletions: 0,
    remote: null,
    upstream: null,
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
    headPushed: true,
    conflicts: [],
    operation: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
const onOpenInEditor = vi.fn();

beforeEach(() => {
  resetGitIndexStore();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  for (const mock of [
    gitDiffIndex,
    gitOperationContinue,
    gitOperationStatus,
    gitResolveConflict,
    gitStageFile,
    readTextFile,
    ask,
  ]) {
    vi.mocked(mock).mockClear();
  }
  vi.mocked(gitOperationStatus).mockResolvedValue({ operation: null, conflicts: [] });
  vi.mocked(ask).mockResolvedValue(true);
  vi.mocked(readTextFile).mockResolvedValue("");
  onOpenInEditor.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPanel() {
  act(() =>
    root.render(
      createElement(GitChangesPanel, {
        cwd: "/repo",
        enabled: true,
        onOpenFile: vi.fn(),
        onOpenInEditor,
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  await act(async () => {});
}

const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
  );
const row = (relative: string) =>
  container.querySelector<HTMLElement>(`[data-conflict="${relative}"]`)!;
const click = (element: HTMLElement | undefined) => act(async () => element!.click());
const openMenu = (relative: string) =>
  click(row(relative).querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!);
const menuAction = async (relative: string, label: string) => {
  await openMenu(relative);
  await click(button(label, document));
};
const FILE_SECTIONS = ["Merge Conflicts", "Staged Changes", "Changes"];
const sectionTitles = () =>
  [...container.querySelectorAll("[data-file-section-title]")]
    .map((node) => node.textContent)
    .filter((title) => FILE_SECTIONS.includes(title ?? ""));

describe("Merge Conflicts section", () => {
  it("lists conflicts first, with a count and a badge per kind, and no duplicate rows", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [file("ok.ts"), file("staged.ts", { staged: true, unstaged: false })],
        conflicts: [conflict("a.ts"), conflict("sub/gone.ts", "deleted-by-us")],
        operation: "merge",
      }),
    );
    await renderPanel();

    expect(sectionTitles()).toEqual(["Merge Conflicts", "Staged Changes", "Changes"]);
    expect(container.textContent).toContain("Merge in progress · 2 conflicts");
    expect(row("a.ts").textContent).toContain("UU");
    expect(row("sub/gone.ts").textContent).toContain("DU");
    expect(row("a.ts").querySelector('[title^="Both modified"]')).not.toBeNull();
    expect(row("sub/gone.ts").querySelector('[title^="Deleted by us"]')).not.toBeNull();
    // Conflicted files are not also ordinary rows.
    expect(container.querySelectorAll('[title="a.ts"]')).toHaveLength(0);
    expect(container.querySelectorAll('[title="ok.ts"]')).toHaveLength(1);
  });

  it("offers the choices that fit each kind", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        conflicts: [
          conflict("both.ts"),
          conflict("us.ts", "deleted-by-us"),
          conflict("them.ts", "deleted-by-them"),
          conflict("dd.ts", "both-deleted"),
        ],
      }),
    );
    await renderPanel();
    const labels = async (relative: string) => {
      await openMenu(relative);
      const result = [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
      await act(async () =>
        document
          .querySelector<HTMLElement>('[role="menu"]')
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      );
      return result;
    };
    expect(await labels("both.ts")).toEqual([
      "Open",
      "Current",
      "Incoming",
      "Both",
      "Mark Resolved",
    ]);
    expect(await labels("us.ts")).toEqual(["Open", "Keep file", "Delete file", "Mark Resolved"]);
    expect(await labels("them.ts")).toEqual(["Open", "Keep file", "Delete file", "Mark Resolved"]);
    expect(await labels("dd.ts")).toEqual(["Delete file"]);
  });

  it("resolves by side, and Keep or Delete pick the side that matches", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ conflicts: [conflict("both.ts"), conflict("us.ts", "deleted-by-us")] }),
    );
    await renderPanel();
    await menuAction("both.ts", "Incoming");
    expect(gitResolveConflict).toHaveBeenLastCalledWith("/repo", "both.ts", "theirs");
    await menuAction("both.ts", "Current");
    expect(gitResolveConflict).toHaveBeenLastCalledWith("/repo", "both.ts", "ours");
    // We deleted it: keeping the file takes their side, deleting takes ours.
    await menuAction("us.ts", "Keep file");
    expect(gitResolveConflict).toHaveBeenLastCalledWith("/repo", "us.ts", "theirs");
    await menuAction("us.ts", "Delete file");
    expect(gitResolveConflict).toHaveBeenLastCalledWith("/repo", "us.ts", "ours");
  });

  it("warns before staging a file that still has conflict markers", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ conflicts: [conflict("a.ts")] }));
    vi.mocked(readTextFile).mockResolvedValue("a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> side\n");
    vi.mocked(ask).mockResolvedValueOnce(false);
    await renderPanel();
    await menuAction("a.ts", "Mark Resolved");
    expect(ask).toHaveBeenCalledOnce();
    expect(gitStageFile).not.toHaveBeenCalled();

    vi.mocked(readTextFile).mockResolvedValue("clean\n");
    await menuAction("a.ts", "Mark Resolved");
    expect(ask).toHaveBeenCalledOnce();
    expect(gitStageFile).toHaveBeenCalledWith("/repo", "a.ts");
  });

  it("accepts a side for every file only after a confirmation", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ conflicts: [conflict("a.ts"), conflict("b.ts", "both-added")] }),
    );
    vi.mocked(ask).mockResolvedValueOnce(false);
    await renderPanel();
    await click(button("Accept All Incoming"));
    expect(gitResolveConflict).not.toHaveBeenCalled();
    await click(button("Accept All Current"));
    expect(vi.mocked(ask).mock.calls[1]?.[0]).toContain("2 conflicted files");
    expect(vi.mocked(gitResolveConflict).mock.calls).toEqual([
      ["/repo", "a.ts", "ours"],
      ["/repo", "b.ts", "ours"],
    ]);
  });

  it("opens the file in the editor, so its conflict blocks can be resolved", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ conflicts: [conflict("a.ts")] }));
    await renderPanel();
    await menuAction("a.ts", "Open");
    expect(onOpenInEditor).toHaveBeenCalledWith("/repo/a.ts", true);
  });
});

describe("operation banner", () => {
  it("stays out of the way when conflicts have no operation, as after a stash pop", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ conflicts: [conflict("a.ts")], operation: null }),
    );
    await renderPanel();
    expect(sectionTitles()).toEqual(["Merge Conflicts"]);
    expect(button("Continue")).toBeUndefined();
    expect(container.textContent).not.toContain("in progress");
  });

  it("enables Continue only once no conflict is left", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ conflicts: [conflict("a.ts")], operation: "rebase" }),
    );
    await renderPanel();
    expect(container.textContent).toContain("Rebase in progress · 1 conflict");
    expect(button("Continue")!.disabled).toBe(true);
    expect(button("Abort")!.disabled).toBe(false);

    act(() => root.unmount());
    root = createRoot(container);
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ conflicts: [], operation: "rebase" }));
    // Resolving conflicts is an external Git mutation, so invalidate the shared
    // fresh index just as the real git-changed subscription does.
    invalidateGitIndex();
    await renderPanel();
    expect(container.textContent).toContain("Rebase in progress · no conflicts left");
    expect(button("Continue")!.disabled).toBe(false);
    await click(button("Continue"));
    expect(gitOperationContinue).toHaveBeenCalledWith("/repo");
  });

  it("is not polled when the index already carries the state", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ conflicts: [], operation: null }));
    await renderPanel();
    expect(gitOperationStatus).not.toHaveBeenCalled();
  });
});

describe("committing with conflicts", () => {
  it("is blocked with compact feedback and file details in the tooltip", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [file("staged.ts", { staged: true, unstaged: false })],
        conflicts: [conflict("a.ts"), conflict("b.ts")],
        operation: "merge",
      }),
    );
    await renderPanel();
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "message");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Resolve 2 conflicts before committing",
    );
    expect(container.querySelector('[role="alert"]')?.getAttribute("title")).toContain(
      "a.ts, b.ts",
    );
    expect(button("Commit")!.disabled).toBe(true);
  });
});

describe("a host that predates conflict info", () => {
  it("lifts its unmerged files out of the ordinary rows using the status commands", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [file("a.ts", { staged: true }), file("ok.ts")],
        conflicts: undefined,
        operation: undefined,
      }),
    );
    vi.mocked(gitOperationStatus).mockResolvedValue({ operation: "merge", conflicts: ["a.ts"] });
    await renderPanel();
    await act(async () => {});

    expect(sectionTitles()).toEqual(["Merge Conflicts", "Changes"]);
    expect(row("a.ts").textContent).toContain("U");
    expect(container.textContent).toContain("Merge in progress · 1 conflict");
    expect(container.querySelectorAll('[title="a.ts"]')).toHaveLength(0);
    // The kind is unknown, so only choices that work for any kind are offered.
    await openMenu("a.ts");
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual([
      "Open",
      "Current",
      "Incoming",
      "Mark Resolved",
    ]);
  });

  it("shows nothing extra when it lacks those commands too", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ files: [file("a.ts")], conflicts: undefined, operation: undefined }),
    );
    vi.mocked(gitOperationStatus).mockRejectedValue(new Error("Unsupported workspace command"));
    await renderPanel();
    await act(async () => {});
    expect(sectionTitles()).toEqual(["Changes"]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
