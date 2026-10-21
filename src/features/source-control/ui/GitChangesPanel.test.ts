// @vitest-environment happy-dom
import { Activity, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetGitIndexStore } from "../model/gitIndexStore";
import { resetGitResourceCache } from "../hooks/useGitResource";
import { resetGitPanelState, withGitOperation } from "../model/gitPanelState";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
  message: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

const { invalidateWatchedFiles } = vi.hoisted(() => ({
  invalidateWatchedFiles: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", () => ({
  saveGeneratedImage: vi.fn(),
  deleteGeneratedImages: vi.fn(),
  gitDiffIndex: vi.fn(),
  gitTrustRepository: vi.fn(async () => {}),
  gitHistory: vi.fn(async () => []),
  gitOperationState: vi.fn(async () => null),
  gitConflicts: vi.fn(async () => []),
  gitOperationStatus: vi.fn(async () => ({ operation: null, conflicts: [] })),
  gitStashList: vi.fn(async () => []),
  gitBranches: vi.fn(async () => ({
    current: "main",
    detached: false,
    branches: [],
  })),
  gitCheckout: vi.fn(async () => {}),
  gitCreateBranch: vi.fn(async () => {}),
  gitStash: vi.fn(async () => {}),
  isCheckoutBlockedByChanges: vi.fn(() => false),
  gitRemotes: vi.fn(async () => []),
  gitTags: vi.fn(async () => []),
  gitPrStatus: vi.fn(async () => null),
  gitPull: vi.fn(async () => {}),
  gitPush: vi.fn(async () => {}),
  gitSync: vi.fn(async () => {}),
  gitFetch: vi.fn(async () => {}),
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
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: vi.fn(() => () => {}),
  isGitWatched: vi.fn(() => false),
  basename: (path: string) => path.split("/").pop() ?? path,
}));

vi.mock("../../../integrations/harness", () => ({
  generateCommitMessage: vi.fn(async () => ""),
  generatePrContent: vi.fn(async () => null),
}));

vi.mock("../../files/model/fileWatch", () => ({
  invalidateWatchedFiles,
  nudgeWatchedFiles: vi.fn(),
}));

vi.mock("../../inbox/model/inboxSelfActivity", () => ({
  recordInboxSelfActivity: vi.fn(),
}));

import { ChangeList, GitChangesPanel, GIT_POLL_MS } from "./GitChangesPanel";
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitHeadMessage,
  gitFetch,
  gitDiffIndex,
  gitTrustRepository,
  gitPrCreate,
  gitPrStatus,
  gitPull,
  gitPush,
  gitRangeContext,
  gitStageFile,
  gitStageFiles,
  gitDiscardFiles,
  gitUnstageFiles,
  gitStageAll,
  gitDiscardFile,
  gitUnstageFile,
  notifyGitChanged,
  subscribeGitChanged,
} from "../../../platform/tauri/fs";
import { generateCommitMessage, generatePrContent } from "../../../integrations/harness";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GitChangedFile, GitDiffIndex } from "../../../platform/tauri/fs";

function index(overrides: Partial<GitDiffIndex> = {}): GitDiffIndex {
  return {
    branch: "feature/pull",
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
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

describe("changed file context menus", () => {
  it.each(["list", "tree"] as const)("offers file and index actions in %s view", async (view) => {
    const onOpenFile = vi.fn();
    const onOpenInEditor = vi.fn();
    const onAction = vi.fn();
    act(() =>
      root.render(
        createElement(
          "ul",
          null,
          createElement(ChangeList, {
            files: [changedFile("src/app.ts")],
            view,
            kind: "unstaged",
            busy: null,
            onOpenFile,
            onOpenInEditor,
            onAction,
            onFolderAction: vi.fn(),
          }),
        ),
      ),
    );
    const row = container.querySelector<HTMLButtonElement>('button[title="src/app.ts"]')!;
    const openMenu = () => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 80,
      });
      act(() => row.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      return document.querySelector<HTMLElement>('[aria-label="Changed file actions"]')!;
    };
    const menu = openMenu();
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(
      items.some((button) => /Reveal in|Open Containing Folder/.test(button.textContent!)),
    ).toBe(true);
    expect(items.some((button) => button.textContent === "Discard Changes")).toBe(true);
    await act(async () => items.find((button) => button.textContent === "View Changes")!.click());
    expect(onOpenFile).toHaveBeenCalledWith("/repo/src/app.ts", "unstaged");
    const stage = Array.from(
      openMenu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent === "Stage Changes")!;
    await act(async () => stage.click());
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ relative: "src/app.ts" }),
      "stage",
    );
    const open = Array.from(
      openMenu().querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent?.startsWith("Open in "))!;
    await act(async () => open.click());
    expect(onOpenInEditor).toHaveBeenCalledWith("/repo/src/app.ts", true);
  });

  it("keeps reveal enabled while index actions are busy", () => {
    act(() =>
      root.render(
        createElement(
          "ul",
          null,
          createElement(ChangeList, {
            files: [changedFile("app.ts")],
            view: "list",
            kind: "staged",
            busy: "app.ts",
            onOpenFile: vi.fn(),
            onAction: vi.fn(),
            onFolderAction: vi.fn(),
          }),
        ),
      ),
    );
    act(() =>
      container
        .querySelector('button[title="app.ts"]')!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    const items = Array.from(
      document
        .querySelector('[aria-label="Changed file actions"]')!
        .querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    expect(items.find((button) => button.textContent === "Unstage Changes")!.disabled).toBe(true);
    expect(
      items.find((button) => /Reveal in|Open Containing Folder/.test(button.textContent!))!
        .disabled,
    ).toBe(false);
    expect(items.some((button) => button.textContent === "Discard Changes")).toBe(false);
  });
});

beforeEach(() => {
  vi.mocked(ask).mockReset().mockResolvedValue(true);
  vi.mocked(gitDiscardFile).mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("alert", vi.fn());
  localStorage.clear();
  vi.useFakeTimers();
  resetGitIndexStore();
  resetGitPanelState();
  resetGitResourceCache();
  vi.mocked(gitPrStatus).mockReset().mockResolvedValue(null);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(gitDiffIndex).mockReset();
  vi.mocked(gitPull).mockReset();
  vi.mocked(gitFetch).mockReset().mockResolvedValue(undefined);
  vi.mocked(generateCommitMessage).mockReset();
  vi.mocked(gitStageFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(gitStageFiles).mockReset().mockResolvedValue(undefined);
  vi.mocked(gitDiscardFiles).mockReset().mockResolvedValue(undefined);
  vi.mocked(gitUnstageFiles).mockReset().mockResolvedValue(undefined);
  vi.mocked(gitUnstageFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(notifyGitChanged).mockReset();
  vi.mocked(subscribeGitChanged).mockImplementation(() => () => {});
  invalidateWatchedFiles.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

async function fillCommitMessage(text: string) {
  const textarea = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      text,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GitChangesPanel branch switching", () => {
  it("switches the panel checkout from the header and refreshes its changes", async () => {
    const cwd = "/panel-branch-switch";
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ ahead: 2, behind: 1 }));
    vi.mocked(gitBranches).mockResolvedValue({
      current: "feature/pull",
      detached: false,
      branches: [
        { name: "feature/pull", current: true, remote: null },
        { name: "main", current: false, remote: null },
      ],
    });
    await act(async () =>
      root.render(
        createElement(GitChangesPanel, {
          cwd,
          enabled: true,
          onOpenFile: vi.fn(),
          onOpenAllChanges: vi.fn(),
          onOpenCommit: vi.fn(),
        }),
      ),
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'header button[aria-label="Branch feature/pull"]',
    )!;
    expect(trigger).not.toBeNull();
    expect(trigger.disabled).toBe(false);
    expect(container.querySelector("header")?.textContent).not.toContain("↑2");
    expect(container.querySelector("header")?.textContent).not.toContain("↓1");
    let release!: () => void;
    let operation!: Promise<void>;
    await act(async () => {
      operation = withGitOperation(
        cwd,
        "Fetching…",
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
    });
    expect(trigger.disabled).toBe(true);
    await act(async () => {
      release();
      await operation;
    });
    expect(trigger.disabled).toBe(false);
    await act(async () => trigger.click());
    const picker = document.querySelector("[data-branch-picker]")!;
    expect(picker).not.toBeNull();
    const main = [...picker.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.textContent?.trim() === "main",
    )!;
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ branch: "main" }));
    vi.mocked(gitDiffIndex).mockClear();
    await act(async () => main.click());
    expect(gitCheckout).toHaveBeenCalledWith(cwd, "main", null);
    expect(gitDiffIndex).toHaveBeenCalledWith(cwd);
    expect(invalidateWatchedFiles).toHaveBeenCalled();
    expect(container.querySelector('header button[aria-label="Branch main"]')).not.toBeNull();
    expect(document.querySelector("[data-branch-picker]")).toBeNull();
  });
});

describe("GitChangesPanel commit message generation", () => {
  it.each(["project", "default"])(
    "uses the saved %s model and advisor for generation",
    async (scope) => {
      const choice = {
        harness: "claude",
        model: "claude:sonnet-5",
        modelSettings: { advisor: "opus" },
      };
      localStorage.setItem(
        scope === "project" ? "bycoda.gitGeneration.v1:/repo" : "bycoda.gitGeneration.default.v1",
        JSON.stringify(choice),
      );
      vi.mocked(gitDiffIndex).mockResolvedValue(
        index({
          files: [
            {
              path: "/repo/file.ts",
              relative: "file.ts",
              status: "modified",
              staged: true,
              unstaged: false,
              additions: 1,
              deletions: 0,
            },
          ],
        }),
      );
      vi.mocked(generateCommitMessage).mockResolvedValue("Fix generation");
      await renderPanel();
      const extras = container.querySelector<HTMLButtonElement>(
        '[aria-label="AI generation settings"]',
      )!;
      expect(extras.textContent).toBe("");
      expect(
        extras.parentElement?.querySelector('[aria-label="Generate commit message"]'),
      ).not.toBeNull();
      expect(container.textContent).not.toContain("Commit and pull request generation");
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="Generate commit message"]')!
          .click(),
      );
      expect(generateCommitMessage).toHaveBeenCalledWith(
        "/repo",
        undefined,
        expect.any(AbortSignal),
        expect.objectContaining({
          harness: "claude",
          model: choice.model,
          modelSettings: expect.objectContaining(choice.modelSettings),
        }),
      );
    },
  );
  it("preserves the draft on generation failure and clears the error after a successful retry", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          {
            path: "/repo/file.ts",
            relative: "file.ts",
            status: "modified",
            staged: true,
            unstaged: false,
            additions: 1,
            deletions: 0,
          },
        ],
      }),
    );
    vi.mocked(generateCommitMessage)
      .mockRejectedValueOnce(new Error("Provider authentication required"))
      .mockResolvedValueOnce("Fix generated message");
    await renderPanel();
    await fillCommitMessage("Existing draft");
    const generate = () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Generate commit message"]')!.click();
    await act(async () => generate());
    expect(container.querySelector("textarea")?.value).toBe("Existing draft");
    expect(container.textContent).not.toContain("Provider authentication required");
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Git operation failed")!
        .click();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Provider authentication required",
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Close"]')!.click(),
    );
    await act(async () => generate());
    expect(container.querySelector("textarea")?.value).toBe("Fix generated message");
    expect(container.textContent).not.toContain("Provider authentication required");
  });

  it("cancels promptly and ignores a late result after a retry", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          {
            path: "/repo/change.ts",
            relative: "change.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            staged: true,
            unstaged: false,
          },
        ],
      }),
    );
    let resolveFirst!: (message: string) => void;
    vi.mocked(generateCommitMessage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("New message");
    await renderPanel();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Generate commit message"]')!.click();
    });
    const signal = vi.mocked(generateCommitMessage).mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Cancel commit message generation"]')!
        .click();
    });
    expect(signal?.aborted).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Generate commit message"]')
        ?.disabled,
    ).toBe(false);
    expect(container.querySelector("textarea")?.disabled).toBe(false);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Generate commit message"]')!.click();
    });
    expect(container.querySelector("textarea")?.value).toBe("New message");

    await act(async () => resolveFirst("Old message"));
    expect(container.querySelector("textarea")?.value).toBe("New message");
  });
});

afterEach(() => {
  act(() => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  container.remove();
  document.body.querySelectorAll("[data-popover-side]").forEach((element) => element.remove());
  vi.unstubAllGlobals();
});

async function renderPanel(cwd = "/repo") {
  act(() =>
    root.render(
      createElement(GitChangesPanel, {
        key: cwd,
        cwd,
        enabled: true,
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  await act(async () => {});
}

it.each([
  { grouped: false, ahead: 1, behind: 0 },
  { grouped: true, ahead: 1, behind: 0 },
  { grouped: true, ahead: 0, behind: 2 },
  { grouped: true, ahead: 3, behind: 2 },
])("shows sync counts only on the sync action: %j", async ({ grouped, ahead, behind }) => {
  vi.mocked(gitDiffIndex).mockResolvedValue(
    index({ remote: "origin", upstream: "origin/feature/pull", ahead, behind }),
  );
  await act(async () =>
    root.render(
      createElement(GitChangesPanel, {
        cwd: `/repo-sync-summary-${grouped}-${ahead}-${behind}`,
        enabled: true,
        embedded: grouped,
        repository: grouped ? { name: "api", expanded: true, onToggle: vi.fn() } : undefined,
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  const sync = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Sync Changes"),
  )!;
  expect(sync).toBeDefined();
  expect(sync.disabled).toBe(false);
  for (const [count, direction] of [
    [ahead, "unpushed"],
    [behind, "incoming"],
  ] as const) {
    if (!count) continue;
    const label = `${count} ${direction} commit${count === 1 ? "" : "s"}`;
    expect(container.querySelectorAll(`[aria-label="${label}"]`)).toHaveLength(1);
    expect(sync.querySelector(`[aria-label="${label}"]`)?.textContent).toBe(String(count));
    expect(container.querySelector("header")?.textContent).not.toContain(
      `${direction === "unpushed" ? "↑" : "↓"}${count}`,
    );
    expect(container.textContent).not.toContain(label);
  }
  expect(container.textContent).toContain(
    ahead && behind ? "Diverged from origin/feature/pull" : "No uncommitted changes",
  );
});

it("keeps workspace rows collapsed and stages through the checkout's overflow menu", async () => {
  vi.mocked(gitDiffIndex).mockResolvedValue(
    index({ files: [changedFile("src/app.ts")], ahead: 2, behind: 1 }),
  );
  const toggle = vi.fn();
  await act(async () =>
    root.render(
      createElement(GitChangesPanel, {
        cwd: "/repo",
        enabled: true,
        embedded: true,
        repository: { name: "api", expanded: false, onToggle: toggle },
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  expect(
    container.querySelector("header button[aria-expanded]")!.getAttribute("aria-expanded"),
  ).toBe("false");
  expect(container.querySelector("textarea")!.closest(".hidden")).not.toBeNull();
  expect(container.querySelector("header")?.textContent).toContain("↑2");
  expect(container.querySelector("header")?.textContent).toContain("↓1");
  expect(container.textContent).not.toContain("GRAPH");
  expect(container.querySelector('header button[aria-label="Stage All Changes"]')).toBeNull();
  await openBranchMenu();
  const changes = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === "Changes",
  )!;
  await act(async () => changes.click());
  const stage = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.includes("Stage All Changes"),
  )!;
  await act(async () => stage.click());
  expect(toggle).toHaveBeenCalledWith(true);
  expect(gitStageAll).toHaveBeenCalledWith("/repo");
});

it("automatically expands a workspace row with an unfinished rebase", async () => {
  vi.mocked(gitDiffIndex).mockResolvedValue(index({ conflicts: [], operation: "rebase" }));
  await act(async () =>
    root.render(
      createElement(GitChangesPanel, {
        cwd: "/repo-rebase",
        enabled: true,
        embedded: true,
        repository: { name: "mobile", onToggle: vi.fn() },
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  expect(
    container.querySelector("header button[aria-expanded]")!.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.textContent).toContain("Continue");
});

it("shows live detached HEAD instead of a stale worktree branch label", async () => {
  vi.mocked(gitDiffIndex).mockResolvedValue(index({ branch: null, head: "1234567abcdef" }));
  await act(async () =>
    root.render(
      createElement(GitChangesPanel, {
        cwd: "/repo-detached",
        enabled: true,
        embedded: true,
        repository: {
          name: "old-branch · /repo-detached",
          checkout: {
            path: "/repo-detached",
            branch: "old-branch",
            head: "abcdef0",
            isMain: false,
            locked: false,
            prunable: false,
            missing: false,
            dirty: false,
            unpushed: 0,
            sessionIds: [],
          },
          current: true,
          expanded: false,
          onToggle: vi.fn(),
        },
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  const header = container.querySelector("header")!;
  expect(header.textContent).toContain("Detached · 1234567");
  expect(header.textContent).not.toContain("old-branch");
  expect(header.textContent).toContain("Current");
  expect(header.querySelector("button")?.title).toContain("/repo-detached");
});

async function openBranchMenu() {
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Branch actions"]')!;
  await act(async () => toggle.click());
  await act(async () => {});
  return document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
}

describe("GitChangesPanel action feedback", () => {
  it("allows commit while an automatic fetch is still waiting on the network", async () => {
    localStorage.setItem("bycoda.gitAutoFetch", "1");
    const cwd = "/repo-background-fetch";
    const staged = changedFile("file.ts", { staged: true, unstaged: false });
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ remote: "origin", files: [staged] }));
    let finishFetch!: () => void;
    vi.mocked(gitFetch).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFetch = resolve;
        }),
    );
    vi.mocked(gitCommit).mockClear().mockResolvedValue(undefined);
    await renderPanel(cwd);
    await fillCommitMessage("Commit during fetch");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(gitFetch).toHaveBeenCalledTimes(1);
    const commit = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Commit",
    )!;
    expect(commit.disabled).toBe(false);
    await act(async () => {
      commit.click();
    });
    expect(gitCommit).toHaveBeenCalledWith(cwd, "Commit during fetch", false, false);
    await act(async () => {
      finishFetch();
    });
  });

  it("removes committed files without showing a success notification", async () => {
    const cwd = "/repo-silent-commit";
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          {
            path: `${cwd}/file.ts`,
            relative: "file.ts",
            status: "modified",
            staged: true,
            unstaged: false,
            additions: 1,
            deletions: 0,
          },
        ],
      }),
    );
    vi.mocked(gitCommit).mockResolvedValueOnce(undefined);
    await renderPanel(cwd);
    await fillCommitMessage("Fix commit flow");
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Commit")!
        .click();
    });
    expect(container.textContent).not.toContain("Staged Changes");
    expect(container.textContent).not.toContain("Commit created");
    expect(container.querySelector("textarea")?.value).toBe("");
    expect(container.querySelector('header [role="status"]')).toBeNull();
  });

  const changed = (staged: boolean) => ({
    path: "/repo-feedback/change.ts",
    relative: "change.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    staged,
    unstaged: !staged,
  });
  const sections = () =>
    [...container.querySelectorAll("button > span.uppercase")]
      .map((title) => title.textContent ?? "")
      .filter((title) => title.endsWith("Changes"));
  const statusText = () => container.querySelector('header [role="status"]')?.textContent ?? null;

  it("moves a file to Staged Changes before git has answered", async () => {
    const cwd = "/repo-feedback";
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changed(false)] }));
    let finishStage!: () => void;
    vi.mocked(gitStageFile).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishStage = resolve)),
    );
    vi.mocked(notifyGitChanged).mockClear();
    await renderPanel(cwd);
    expect(sections()).toEqual(["Changes"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Stage Changes"]')!.click();
    });
    expect(gitStageFile).toHaveBeenCalledWith(cwd, "change.ts");
    expect(sections()).toEqual(["Staged Changes"]);
    expect(statusText()).toBe("Staging…");
    expect(container.querySelector('[aria-label="Working"]')).not.toBeNull();

    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changed(true)] }));
    await act(async () => finishStage());
    await act(async () => {});
    expect(sections()).toEqual(["Staged Changes"]);
    expect(statusText()).toBeNull();
    expect(container.querySelector('[aria-label="Working"]')).toBeNull();
    // One announcement, limited to this checkout's changed files.
    expect(vi.mocked(notifyGitChanged).mock.calls).toEqual([[cwd, "index"]]);
  });

  it("stages files one after another while the message stays editable and a message is generated", async () => {
    const cwd = "/repo-feedback-queue";
    const other = {
      ...changed(false),
      path: `${cwd}/other.ts`,
      relative: "other.ts",
    };
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changed(false), other] }));
    const finish: (() => void)[] = [];
    vi.mocked(gitStageFile).mockReset();
    vi.mocked(gitStageFile).mockImplementation(
      () => new Promise<void>((resolve) => finish.push(resolve)),
    );
    vi.mocked(generateCommitMessage).mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(notifyGitChanged).mockClear();
    await renderPanel(cwd);
    const stageButtons = () =>
      container.querySelectorAll<HTMLButtonElement>('[aria-label="Stage Changes"]');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Generate commit message"]')!.click();
    });
    await act(async () => stageButtons()[0].click());
    expect(container.querySelector("textarea")?.disabled).toBe(true);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Cancel commit message generation"]')!
        .click();
    });
    // Staging is still running; the box is free to type in.
    expect(container.querySelector("textarea")?.disabled).toBe(false);

    await act(async () => stageButtons()[0].click());
    expect(sections()).toEqual(["Staged Changes"]);
    // The second command waits for the first.
    expect(gitStageFile).toHaveBeenCalledTimes(1);

    await act(async () => finish[0]());
    expect(gitStageFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(notifyGitChanged)).not.toHaveBeenCalled();
    expect(statusText()).toBe("Staging…");

    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [changed(true), { ...other, staged: true, unstaged: false }],
      }),
    );
    await act(async () => finish[1]());
    await act(async () => {});
    expect(sections()).toEqual(["Staged Changes"]);
    expect(statusText()).toBeNull();
    expect(vi.mocked(notifyGitChanged).mock.calls).toEqual([[cwd, "index"]]);
    vi.mocked(gitStageFile).mockReset();
    vi.mocked(gitStageFile).mockResolvedValue(undefined);
  });

  it("puts the file back when staging fails", async () => {
    const cwd = "/repo-feedback-failed";
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changed(false)] }));
    vi.mocked(gitStageFile).mockRejectedValueOnce(new Error("index.lock exists"));
    vi.stubGlobal("alert", vi.fn());
    await renderPanel(cwd);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Stage Changes"]')!.click();
    });
    await act(async () => {});
    expect(sections()).toEqual(["Changes"]);
    expect(statusText()).toBeNull();
  });

  it("names the step on the commit button while it runs", async () => {
    const cwd = "/repo-feedback-commit";
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changed(true)] }));
    let finishCommit!: () => void;
    vi.mocked(gitCommit).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishCommit = resolve)),
    );
    await renderPanel(cwd);
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setValue.call(textarea, "Fix it");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const commitButton = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
        /^(Commit|Committing…)$/.test(candidate.textContent?.trim() ?? ""),
      )!;
    expect(commitButton().textContent?.trim()).toBe("Commit");

    await act(async () => commitButton().click());
    expect(commitButton().textContent?.trim()).toBe("Committing…");
    expect(statusText()).toBe("Committing…");

    await act(async () => finishCommit());
    await act(async () => {});
    expect(commitButton().textContent?.trim()).toBe("Commit");
    expect(statusText()).toBeNull();
  });

  it("clears committed files as soon as the commit is made, before the push ends", async () => {
    const cwd = "/repo-feedback-push";
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ files: [changed(true)], remote: "origin", upstream: "origin/x" }),
    );
    vi.mocked(gitCommit).mockResolvedValueOnce(undefined);
    let finishPush!: () => void;
    vi.mocked(gitPush).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishPush = resolve)),
    );
    await renderPanel(cwd);
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setValue.call(textarea, "Fix it");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(sections()).toEqual(["Staged Changes"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Commit options"]')!.click();
    });
    const pushItem = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Commit & Push",
    )!;
    await act(async () => pushItem.click());
    await act(async () => {});

    // Still pushing, and the poll still reads the old index.
    expect(statusText()).toBe("Pushing…");
    expect(sections()).toEqual([]);
    expect(container.querySelector("textarea")?.value).toBe("");

    vi.mocked(gitDiffIndex).mockResolvedValue(index({ remote: "origin", upstream: "origin/x" }));
    await act(async () => finishPush());
    await act(async () => {});
    expect(sections()).toEqual([]);
    expect(statusText()).toBeNull();
  });
});

describe("GitChangesPanel navigation", () => {
  const cwd = "/repo-navigation";
  const changedIndex = () =>
    index({
      remote: "origin",
      upstream: "origin/feature/pull",
      files: [
        {
          path: `${cwd}/change.ts`,
          relative: "change.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
          staged: true,
          unstaged: false,
        },
      ],
    });
  const click = async (label: string) => {
    await act(async () =>
      container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(),
    );
  };
  const typeMessage = async (text: string) => {
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        text,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const status = () => container.querySelector('header [role="status"]')?.textContent;

  beforeEach(() => vi.mocked(gitDiffIndex).mockResolvedValue(changedIndex()));

  it("keeps an empty checkout's draft editable while commit and generation stay disabled", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    await renderPanel(cwd);
    expect(container.querySelector("textarea")?.disabled).toBe(false);
    await typeMessage("Write before staging");
    const field = container.querySelector("textarea")!;
    await act(async () =>
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      ),
    );
    expect(gitCommit).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Generate commit message"]')
        ?.disabled,
    ).toBe(true);
    await renderPanel("/other-empty");
    await typeMessage("Other checkout");
    await renderPanel(cwd);
    expect(container.querySelector("textarea")?.value).toBe("Write before staging");
  });

  it("keeps generation running across project switches and delivers to its original project", async () => {
    let finish!: (text: string) => void;
    vi.mocked(generateCommitMessage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderPanel(cwd);
    await click("Generate commit message");
    const signal = vi.mocked(generateCommitMessage).mock.calls[0][2];
    await renderPanel("/other-navigation");
    expect(signal?.aborted).toBe(false);
    expect(container.querySelector('[aria-label="Cancel commit message generation"]')).toBeNull();
    await typeMessage("Other draft");
    await renderPanel(cwd);
    expect(
      container.querySelector('[aria-label="Cancel commit message generation"]'),
    ).not.toBeNull();
    await renderPanel("/other-navigation");
    await act(async () => finish("Generated for original project"));
    expect(container.querySelector("textarea")?.value).toBe("Other draft");
    await renderPanel(cwd);
    expect(container.querySelector("textarea")?.value).toBe("Generated for original project");
    expect(generateCommitMessage).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="Cancel commit message generation"]')).toBeNull();
  });

  it("allows cancellation after remount and ignores the cancelled result", async () => {
    let finish!: (text: string) => void;
    vi.mocked(generateCommitMessage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce("Replacement");
    await renderPanel(cwd);
    await click("Generate commit message");
    const signal = vi.mocked(generateCommitMessage).mock.calls[0][2];
    await act(async () => root.render(null));
    expect(signal?.aborted).toBe(false);
    await renderPanel(cwd);
    await click("Cancel commit message generation");
    expect(signal?.aborted).toBe(true);
    await click("Generate commit message");
    await act(async () => finish("Cancelled result"));
    expect(container.querySelector("textarea")?.value).toBe("Replacement");
  });

  it("restores a draft after leaving the Changes page", async () => {
    await renderPanel(cwd);
    await typeMessage("Unfinished draft");
    await act(async () => root.render(null));
    await renderPanel(cwd);
    expect(container.querySelector("textarea")?.value).toBe("Unfinished draft");
  });

  it("keeps commit and push locked across remounts and clears the original draft on completion", async () => {
    let finishCommit!: () => void;
    let finishPush!: () => void;
    vi.mocked(gitCommit).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCommit = resolve;
        }),
    );
    vi.mocked(gitPush).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPush = resolve;
        }),
    );
    await renderPanel(cwd);
    await typeMessage("Commit draft");
    await click("Commit options");
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.trim() === "Commit & Push")!
        .click(),
    );
    await renderPanel("/other-navigation");
    expect(status()).toBeUndefined();
    await typeMessage("Other draft");
    await renderPanel(cwd);
    expect(status()).toBe("Committing…");
    expect(container.querySelector("textarea")?.disabled).toBe(true);
    await act(async () => finishCommit());
    expect(status()).toBe("Pushing…");
    expect(container.querySelector("textarea")?.value).toBe("");
    await renderPanel("/other-navigation");
    await act(async () => finishPush());
    expect(container.querySelector("textarea")?.value).toBe("Other draft");
    await renderPanel(cwd);
    expect(status()).toBeUndefined();
    expect(gitCommit).toHaveBeenCalledWith(cwd, "Commit draft", false, false);
    expect(gitPush).toHaveBeenCalledWith(cwd);
  });

  it("çekme durumunu geri yükler ve tamamlanınca başarı bildirimi göstermeden kilidi açar", async () => {
    let finish!: () => void;
    vi.mocked(gitPull).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await renderPanel(cwd);
    const pull = await openBranchMenu();
    await act(async () => pull.click());
    await renderPanel("/other-navigation");
    await renderPanel(cwd);
    expect(status()).toBe("Pulling…");
    await act(async () => finish());
    expect(status()).toBeUndefined();
    expect(container.textContent).not.toContain("Pull complete");
    expect((await openBranchMenu()).disabled).toBe(false);
    expect(gitPull).toHaveBeenCalledTimes(1);
  });

  it("refreshes the remounted panel when the original commit finishes", async () => {
    const listeners = new Set<() => void>();
    vi.mocked(subscribeGitChanged).mockImplementation((listener, filter) => {
      if (filter?.cwd !== cwd) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });
    vi.mocked(notifyGitChanged).mockImplementation(() => {
      listeners.forEach((listener) => listener());
    });
    let finish!: () => void;
    vi.mocked(gitCommit).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await renderPanel(cwd);
    await typeMessage("Commit draft");
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Commit")!
        .click(),
    );
    await renderPanel("/other-navigation");
    await renderPanel(cwd);
    expect(container.textContent).toContain("Staged Changes");
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ ahead: 1 }));
    await act(async () => finish());
    expect(container.textContent).not.toContain("Staged Changes");
    expect(container.textContent).toContain("No uncommitted changes");
    expect(status()).toBeUndefined();
  });
});

describe("GitChangesPanel loading and publication recovery", () => {
  it("does not repeat a manual refresh when the retained panel becomes visible again", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    const render = (mode: "visible" | "hidden") =>
      root.render(
        createElement(
          Activity,
          { mode },
          createElement(GitChangesPanel, {
            cwd: "/repo-retained-entry",
            enabled: true,
            onOpenFile: vi.fn(),
            onOpenAllChanges: vi.fn(),
            onOpenCommit: vi.fn(),
          }),
        ),
      );
    await act(async () => render("visible"));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Refresh source control"]')!
        .click(),
    );
    const reads = vi.mocked(gitDiffIndex).mock.calls.length;
    await act(async () => render("hidden"));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await act(async () => render("visible"));
    expect(gitDiffIndex).toHaveBeenCalledTimes(reads);
  });

  it("reuses a full index on entry for two minutes without resetting its fetch age", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    await renderPanel("/repo-entry-freshness");
    const initialReads = vi.mocked(gitDiffIndex).mock.calls.length;
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(119_999));
    await renderPanel("/repo-entry-freshness");
    expect(gitDiffIndex).toHaveBeenCalledTimes(initialReads);
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await renderPanel("/repo-entry-freshness");
    expect(gitDiffIndex).toHaveBeenCalledTimes(initialReads + 1);
  });

  it("waits three minutes between fallback checks and refreshes on return from hidden", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    await renderPanel("/repo-fallback-policy");
    const initialReads = vi.mocked(gitDiffIndex).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(179_999));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(gitDiffIndex).toHaveBeenCalledTimes(initialReads);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(gitDiffIndex).toHaveBeenCalledTimes(initialReads);
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(gitDiffIndex).toHaveBeenCalledTimes(initialReads + 1);
    hidden.mockRestore();
  });

  it.each(["focusin", "pointerdown"])(
    "checks stale changes on panel %s without rereading fresh data",
    async (type) => {
      vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changedFile("before.ts")] }));
      await renderPanel(`/repo-panel-${type}`);
      const target = container.querySelector("textarea")!;
      const enter = () =>
        target.dispatchEvent(
          type === "focusin"
            ? new FocusEvent(type, { bubbles: true })
            : new Event(type, { bubbles: true }),
        );
      const reads = vi.mocked(gitDiffIndex).mock.calls.length;
      await act(async () => {
        enter();
        enter();
      });
      expect(gitDiffIndex).toHaveBeenCalledTimes(reads);
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changedFile("after.ts")] }));
      await act(async () => {
        enter();
        enter();
      });
      expect(gitDiffIndex).toHaveBeenCalledTimes(reads + 1);
      expect(container.querySelector('button[title="after.ts"]')).not.toBeNull();
      expect(container.querySelector('button[title="before.ts"]')).toBeNull();
      await act(async () => enter());
      expect(gitDiffIndex).toHaveBeenCalledTimes(reads + 1);
    },
  );

  it("does not refresh just for keyboard movement within the panel", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    await renderPanel("/repo-panel-internal-focus");
    const reads = vi.mocked(gitDiffIndex).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await act(async () =>
      container.querySelector("textarea")!.dispatchEvent(
        new FocusEvent("focusin", {
          bubbles: true,
          relatedTarget: container.querySelector('button[aria-label="Refresh source control"]'),
        }),
      ),
    );
    expect(gitDiffIndex).toHaveBeenCalledTimes(reads);
  });

  it("joins a pending panel refresh and keeps the last good index until it finishes", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changedFile("before.ts")] }));
    await renderPanel("/repo-panel-pending-focus");
    const reads = vi.mocked(gitDiffIndex).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    let finish!: (value: GitDiffIndex) => void;
    vi.mocked(gitDiffIndex).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const target = container.querySelector("textarea")!;
    await act(async () => {
      target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(gitDiffIndex).toHaveBeenCalledTimes(reads + 1);
    expect(container.querySelector('button[title="before.ts"]')).not.toBeNull();
    await act(async () => finish(index({ files: [changedFile("after.ts")] })));
    expect(gitDiffIndex).toHaveBeenCalledTimes(reads + 1);
    expect(container.querySelector('button[title="after.ts"]')).not.toBeNull();
  });

  it("refreshes local changes and PR status explicitly, without polling every two seconds", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ remote: "origin" }));
    await renderPanel("/repo-manual-refresh");
    const initialReads = vi.mocked(gitDiffIndex).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(gitDiffIndex).toHaveBeenCalledTimes(initialReads);
    expect(gitPrStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Refresh source control"]')!
        .click();
    });
    expect(gitDiffIndex).toHaveBeenCalledTimes(initialReads + 1);
    expect(gitPrStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps PR failures stable during repeated focus and refs events", async () => {
    const listeners = new Set<() => void>();
    vi.mocked(subscribeGitChanged).mockImplementation((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    });
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ remote: "origin", aheadOfDefault: 1 }));
    vi.mocked(gitPrStatus).mockRejectedValue(new Error("GraphQL: API rate limit already exceeded"));
    await renderPanel("/repo-pr-focus-storm");
    expect(gitPrStatus).toHaveBeenCalledTimes(1);
    const feedback = container.textContent;
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
        listeners.forEach((listener) => listener());
      }
    });
    expect(gitPrStatus).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe(feedback);
    expect(container.textContent).not.toContain("Checking pull request…");
  });

  it("keeps the file list and layout stable while an unchanged background read is pending", async () => {
    const current = index({ remote: "origin" });
    vi.mocked(gitDiffIndex).mockResolvedValue(current);
    await renderPanel("/repo-quiet-poll");
    const before = container.textContent;
    let finish!: (value: typeof current) => void;
    vi.mocked(gitDiffIndex).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(GIT_POLL_MS));
    expect(container.textContent).toBe(before);
    expect(container.textContent).not.toContain("Refreshing changes…");
    await act(async () => finish(current));
    expect(container.textContent).toBe(before);
  });

  it("shows PR lookup errors and waits for a successful lookup before allowing creation", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        upstream: "origin/feature/pull",
        aheadOfDefault: 1,
      }),
    );
    vi.mocked(gitPrStatus).mockRejectedValueOnce(new Error("GitHub authentication required"));
    await renderPanel("/repo-pr-error");
    expect(container.textContent).toContain("Couldn’t check pull request");
    const create = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent?.trim() === "Create PR",
      )!;
    expect(create().disabled).toBe(true);
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Retry")!
        .click(),
    );
    expect(container.textContent).not.toContain("Couldn’t check pull request");
    expect(create().disabled).toBe(false);
  });

  it("ignores the previous branch’s late PR response", async () => {
    let finish!: (pr: Awaited<ReturnType<typeof gitPrStatus>>) => void;
    vi.mocked(gitPrStatus).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: "origin", branch: "first", aheadOfDefault: 1 }),
    );
    await renderPanel("/repo-pr-branch");
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: "origin", branch: "second", aheadOfDefault: 1 }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(GIT_POLL_MS));
    await act(async () =>
      finish({
        number: 42,
        state: "open",
        title: "Old branch PR",
        url: "https://example.test/pull/42",
      }),
    );
    expect(container.textContent).not.toContain("View PR");
    expect(container.querySelector("header")?.textContent).toContain("second");
  });

  it("requires native owner confirmation to trust only the failing repository", async () => {
    vi.mocked(gitDiffIndex).mockRejectedValue(
      new Error("fatal: detected dubious ownership in repository at '/repo-untrusted'"),
    );
    await renderPanel("/repo-untrusted");
    const trust = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Trust this repository",
    )!;
    expect(trust).toBeDefined();
    vi.mocked(ask).mockResolvedValueOnce(false);
    await act(async () => trust.click());
    expect(gitTrustRepository).not.toHaveBeenCalled();
    vi.mocked(ask).mockResolvedValueOnce(true);
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    await act(async () => trust.click());
    expect(ask).toHaveBeenLastCalledWith(
      expect.stringContaining("/repo-untrusted"),
      expect.objectContaining({ okLabel: "Trust this repository" }),
    );
    expect(gitTrustRepository).toHaveBeenCalledExactlyOnceWith("/repo-untrusted");
  });

  it("shows a local load error instead of indefinite loading and retries", async () => {
    vi.mocked(gitDiffIndex).mockRejectedValueOnce(new Error("Repository access denied"));
    await renderPanel("/repo-read-error");
    expect(container.textContent).toContain("Couldn’t load Git changes");
    expect(container.textContent).not.toContain("Loading changes…");
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Retry")!
        .click(),
    );
    expect(container.textContent).not.toContain("Couldn’t load Git changes");
    expect(container.textContent).toContain("No uncommitted changes");
  });

  it("distinguishes a non-repository from a clean repository", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ repository: false, branch: null }));
    await renderPanel("/ordinary-folder");
    expect(container.textContent).toContain("This folder is not a Git repository");
    expect(container.textContent).not.toContain("No uncommitted changes");
  });

  it("retries a failed push without creating another commit", async () => {
    const cwd = "/repo-push-recovery";
    vi.mocked(gitCommit).mockClear();
    vi.mocked(gitPush).mockReset();
    vi.mocked(gitPush)
      .mockRejectedValueOnce(new Error("Push authentication failed"))
      .mockResolvedValue(undefined);
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        upstream: "origin/feature/pull",
        files: [changedFile("file.ts", { staged: true, unstaged: false })],
      }),
    );
    await renderPanel(cwd);
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "Recoverable commit",
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Commit options"]')!.click(),
    );
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent?.trim() === "Commit & Push")!
        .click(),
    );
    expect(container.textContent).toContain("Commit created; push failed");
    expect(gitCommit).toHaveBeenCalledTimes(1);
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Retry")!
        .click(),
    );
    expect(gitCommit).toHaveBeenCalledTimes(1);
    expect(gitPush).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Push complete");
    expect(container.textContent).not.toContain("Commit created; push failed");
  });
});

describe("GitChangesPanel pull action", () => {
  it("disables Pull when the branch has no upstream", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ remote: null, upstream: null }));
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.textContent).toContain("Pull");
    expect(pull.disabled).toBe(true);
  });

  it("disables Pull when the repository has no remote", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: null, upstream: "origin/feature/pull" }),
    );
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.disabled).toBe(true);
  });

  it("pulls the current branch and reloads watched files", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: "origin", upstream: "origin/feature/pull" }),
    );
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.disabled).toBe(false);

    invalidateWatchedFiles.mockClear();
    await act(async () => {
      pull.click();
      await Promise.resolve();
    });

    expect(gitPull).toHaveBeenCalledWith("/repo");
    expect(invalidateWatchedFiles).toHaveBeenCalled();
  });
});

describe("GitChangesPanel actions menu", () => {
  const menuLabels = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) =>
      item.textContent?.trim(),
    );

  it("stays available on a detached HEAD without a remote", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ branch: null }));
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.disabled).toBe(true);
    expect(menuLabels()).toEqual([
      "Pull",
      "Push",
      "Checkout to…",
      "Fetch",
      "Commit",
      "Changes",
      "Pull, Push",
      "Branch",
      "Remote",
      "Stash",
      "Tags",
    ]);
    const checkout = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Checkout to…",
    );
    expect(checkout?.disabled).toBe(false);
  });

  it("pulls with a rebase from the Pull, Push group", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: "origin", upstream: "origin/feature/pull" }),
    );
    await renderPanel();
    await openBranchMenu();

    const group = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Pull, Push",
    )!;
    await act(async () => group.click());
    await act(async () => {});
    const rebase = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Pull (Rebase)",
    )!;
    expect(rebase.disabled).toBe(false);

    await act(async () => {
      rebase.click();
      await Promise.resolve();
    });
    expect(gitPull).toHaveBeenCalledWith("/repo", true);
  });
});

describe("GitChangesPanel remote pull request", () => {
  it("keeps the created PR link when opening the browser fails", async () => {
    const cwd = "remote://machine/home/user/pr-link";
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        upstream: "origin/feature/pull",
        aheadOfDefault: 1,
      }),
    );
    vi.mocked(gitRangeContext).mockResolvedValue({
      base: "main",
      head: "feature/pull",
      commitSummary: "abc123 Fix link",
      diffSummary: "1 file changed",
      diffPatch: "",
    });
    vi.mocked(gitPrCreate).mockClear().mockResolvedValue("https://example.test/pull/43");
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("Browser unavailable"));
    await renderPanel(cwd);
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Create PR")!
        .click(),
    );
    expect(container.textContent).toContain("Pull request created; couldn’t open the link");
    expect(container.textContent).toContain("Open pull request");
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Open pull request")!
        .click(),
    );
    expect(gitPrCreate).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenLastCalledWith("https://example.test/pull/43");
  });

  it("creates it from the host Git range without calling a local harness", async () => {
    const cwd = "remote://machine/home/user/repo";
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        upstream: "origin/feature/pull",
        ahead: 1,
        aheadOfDefault: 1,
      }),
    );
    vi.mocked(gitRangeContext).mockResolvedValue({
      base: "main",
      head: "feature/pull",
      commitSummary: "abc123 Fix remote flow\ndef456 Add coverage",
      diffSummary: "2 files changed, 4 insertions(+)\n",
      diffPatch: "",
    });
    vi.mocked(gitPrCreate).mockResolvedValue("https://example.test/pull/42");
    await renderPanel(cwd);

    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Create PR",
    );
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });

    expect(gitPush).toHaveBeenCalledWith(cwd);
    expect(gitRangeContext).toHaveBeenCalledWith(cwd);
    expect(generatePrContent).not.toHaveBeenCalled();
    expect(gitPrCreate).toHaveBeenCalledWith(
      cwd,
      "Fix remote flow",
      expect.stringContaining("## Changes\n\n2 files changed"),
      "main",
      "feature/pull",
    );
    expect(openUrl).toHaveBeenCalledWith("https://example.test/pull/42");
  });
});

function changedFile(relative: string, overrides: Partial<GitChangedFile> = {}): GitChangedFile {
  return {
    path: `/repo/${relative}`,
    relative,
    status: "modified",
    additions: 1,
    deletions: 0,
    staged: false,
    unstaged: true,
    ...overrides,
  };
}

async function showTree() {
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="View as Tree"]');
  if (toggle) await act(async () => toggle.click());
  let collapsed: HTMLButtonElement | null;
  while (
    (collapsed = container.querySelector<HTMLButtonElement>('button[title][aria-expanded="false"]'))
  ) {
    const folder = collapsed;
    await act(async () => folder.click());
  }
}

describe("GitChangesPanel folder actions", () => {
  it.each(["/repo", "remote://machine/home/user/repo"])(
    "stages a collapsed folder in one operation for %s",
    async (cwd) => {
      const files = [
        changedFile("src/app.ts", { path: `${cwd}/src/app.ts` }),
        changedFile("src/nested/new.ts", {
          path: `${cwd}/src/nested/new.ts`,
          status: "untracked",
        }),
        changedFile("src-other/other.ts"),
        changedFile("docs/ready.md", { staged: true, unstaged: false }),
      ];
      vi.mocked(gitDiffIndex).mockResolvedValue(index({ files }));
      await renderPanel(cwd);
      await showTree();
      const folder = container.querySelector<HTMLButtonElement>('button[title="src"]')!;
      await act(async () => folder.click());
      expect(folder.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('button[title="src/app.ts"]')).toBeNull();

      invalidateWatchedFiles.mockClear();
      vi.mocked(notifyGitChanged).mockClear();
      const reads = vi.mocked(gitDiffIndex).mock.calls.length;
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[aria-label="Stage Changes in src"]')!.click();
      });

      expect(gitStageFile).toHaveBeenCalledExactlyOnceWith(cwd, "src");
      expect(gitUnstageFile).not.toHaveBeenCalled();
      expect(invalidateWatchedFiles).toHaveBeenCalledWith([
        `${cwd}/src/app.ts`,
        `${cwd}/src/nested/new.ts`,
      ]);
      expect(notifyGitChanged).toHaveBeenCalled();
      expect(vi.mocked(gitDiffIndex).mock.calls.length).toBeGreaterThan(reads);
      expect(folder.getAttribute("aria-expanded")).toBe("false");
    },
  );

  it("stages a nested folder without toggling it or including its siblings", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          changedFile("src/app.ts"),
          changedFile("src/nested/one.ts"),
          changedFile("src/nested/deeper/two.ts"),
          changedFile("src/nested-other/three.ts"),
        ],
      }),
    );
    await renderPanel();
    await showTree();
    const folder = container.querySelector<HTMLButtonElement>('button[title="src/nested"]')!;
    invalidateWatchedFiles.mockClear();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Stage Changes in src/nested"]')!
        .click();
    });

    expect(gitStageFile).toHaveBeenCalledExactlyOnceWith("/repo", "src/nested");
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(invalidateWatchedFiles).toHaveBeenCalledWith([
      "/repo/src/nested/one.ts",
      "/repo/src/nested/deeper/two.ts",
    ]);
  });

  it("unstages the staged folder including files that also have unstaged changes", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          changedFile("src/app.ts", { staged: true, unstaged: false }),
          changedFile("src/nested/partial.ts", { staged: true }),
          changedFile("docs/readme.md", { staged: true, unstaged: false }),
        ],
      }),
    );
    await renderPanel();
    await showTree();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Unstage Changes in src"]')!.click();
    });

    expect(gitUnstageFile).toHaveBeenCalledExactlyOnceWith("/repo", "src");
    expect(gitStageFile).not.toHaveBeenCalled();
  });

  it("disables folder and file mutations while a folder action is running", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [changedFile("src/app.ts"), changedFile("docs/readme.md")],
      }),
    );
    let finish!: () => void;
    vi.mocked(gitStageFile).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await renderPanel();
    await showTree();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Stage Changes in src"]')!.click();
    });
    const actions = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Stage Changes"], button[aria-label="Discard Changes"]',
      ),
    ];
    expect(actions.length).toBeGreaterThan(2);
    expect(actions.every((action) => action.disabled)).toBe(true);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Stage Changes in docs"]')!.click();
    });
    expect(gitStageFile).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(actions.every((action) => !action.disabled)).toBe(true);
  });

  it("reports errors and enables folder actions again", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files: [changedFile("src/app.ts")] }));
    vi.mocked(gitStageFile).mockRejectedValueOnce(new Error("Git index is locked"));
    await renderPanel();
    await showTree();
    invalidateWatchedFiles.mockClear();
    const stage = container.querySelector<HTMLButtonElement>(
      '[aria-label="Stage Changes in src"]',
    )!;
    await act(async () => stage.click());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Git operation failed",
    );
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Git operation failed")!
        .click();
    });
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe("Git index is locked");
    expect(stage.disabled).toBe(false);
    expect(notifyGitChanged).toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe("Git changed file multiple selection", () => {
  const fileRow = (relative: string) =>
    container.querySelector<HTMLButtonElement>(`button[data-git-file][title="${relative}"]`)!;
  async function click(relative: string, modifiers: MouseEventInit = {}) {
    await act(async () =>
      fileRow(relative).dispatchEvent(new MouseEvent("click", { bubbles: true, ...modifiers })),
    );
  }
  async function press(relative: string, init: KeyboardEventInit) {
    await act(async () =>
      fileRow(relative).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init })),
    );
  }
  function selected() {
    return [
      ...container.querySelectorAll<HTMLElement>(
        '[role="option"][aria-selected="true"] [data-git-file]',
      ),
    ].map((row) => row.title);
  }
  it.each(["list", "tree"] as const)(
    "keeps focus and previews files during unmodified keyboard navigation in %s view",
    async (view) => {
      const onOpenFile = vi.fn();
      await act(async () =>
        root.render(
          createElement(
            "ul",
            null,
            createElement(ChangeList, {
              files: [changedFile("src/a.ts"), changedFile("src/b.ts"), changedFile("src/c.ts")],
              view,
              kind: "staged",
              busy: null,
              onOpenFile,
              onAction: vi.fn(),
              onFolderAction: vi.fn(),
            }),
          ),
        ),
      );
      await click("src/a.ts");
      expect(document.activeElement).toBe(fileRow("src/a.ts"));
      await press("src/a.ts", { key: "ArrowDown" });
      expect(document.activeElement).toBe(fileRow("src/b.ts"));
      expect(selected()).toEqual(["src/b.ts"]);
      expect(onOpenFile).toHaveBeenLastCalledWith("/repo/src/b.ts", "staged");
      await press("src/b.ts", { key: "End" });
      expect(document.activeElement).toBe(fileRow("src/c.ts"));
      expect(onOpenFile).toHaveBeenLastCalledWith("/repo/src/c.ts", "staged");
      await press("src/c.ts", { key: "ArrowUp" });
      await press("src/b.ts", { key: "Home" });
      expect(document.activeElement).toBe(fileRow("src/a.ts"));
      expect(onOpenFile).toHaveBeenLastCalledWith("/repo/src/a.ts", "staged");
      onOpenFile.mockClear();
      await press("src/a.ts", { key: "ArrowDown", ctrlKey: true });
      expect(document.activeElement).toBe(fileRow("src/b.ts"));
      expect(selected()).toEqual(["src/a.ts"]);
      await press("src/b.ts", { key: "ArrowDown", shiftKey: true });
      expect(selected()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
      expect(onOpenFile).not.toHaveBeenCalled();
      await press("src/c.ts", { key: "Enter" });
      expect(onOpenFile).toHaveBeenCalledWith("/repo/src/c.ts", "staged", true);
    },
  );
  async function menuAction(relative: string, label: string) {
    await act(async () =>
      fileRow(relative).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })),
    );
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent === label)!
        .click(),
    );
  }
  it.each(["list", "tree"] as const)(
    "supports Ctrl, Shift, keyboard ranges and contextual batches in %s view",
    async (view) => {
      const onOpenFile = vi.fn();
      const onAction = vi.fn();
      const files = [changedFile("src/a.ts"), changedFile("src/b.ts"), changedFile("src/c.ts")];
      await act(async () =>
        root.render(
          createElement(
            "ul",
            null,
            createElement(ChangeList, {
              files,
              view,
              kind: "unstaged",
              busy: null,
              onOpenFile,
              onAction,
              onFolderAction: vi.fn(),
            }),
          ),
        ),
      );
      await click("src/a.ts");
      onOpenFile.mockClear();
      await click("src/c.ts", { ctrlKey: true });
      expect(selected()).toEqual(["src/a.ts", "src/c.ts"]);
      expect(onOpenFile).not.toHaveBeenCalled();
      await click("src/a.ts", { metaKey: true });
      expect(selected()).toEqual(["src/c.ts"]);
      await click("src/a.ts", { shiftKey: true });
      expect(selected()).toEqual(["src/a.ts"]);
      await click("src/c.ts", { shiftKey: true });
      expect(selected()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
      await press("src/c.ts", { key: "ArrowUp", shiftKey: true });
      expect(selected()).toEqual(["src/a.ts", "src/b.ts"]);
      await menuAction("src/a.ts", "Stage Changes");
      expect(onAction.mock.calls.map(([file, action]) => [file.relative, action])).toEqual([
        ["src/a.ts", "stage"],
        ["src/b.ts", "stage"],
      ]);
      await menuAction("src/c.ts", "View Changes");
      expect(selected()).toEqual(["src/c.ts"]);
      expect(onOpenFile).toHaveBeenCalledExactlyOnceWith("/repo/src/c.ts", "unstaged");
      await press("src/c.ts", { key: "a", ctrlKey: true });
      expect(selected()).toHaveLength(3);
      await press("src/c.ts", { key: "Enter" });
      expect(onOpenFile).toHaveBeenCalledWith("/repo/src/a.ts", "unstaged", true);
    },
  );
  it("stages a selected subset in one command with one reload and combined optimistic state", async () => {
    const files = [changedFile("a.ts"), changedFile("b.ts"), changedFile("c.ts")];
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files }));
    const finish: (() => void)[] = [];
    vi.mocked(gitStageFiles).mockImplementation(
      () => new Promise<void>((resolve) => finish.push(resolve)),
    );
    await renderPanel();
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    vi.mocked(notifyGitChanged).mockClear();
    await menuAction("a.ts", "Stage Changes");
    expect(gitStageFiles).toHaveBeenCalledExactlyOnceWith("/repo", ["a.ts", "b.ts"]);
    const staged = container.querySelector('[role="listbox"][aria-label="Staged Changes"]')!;
    expect(staged.querySelectorAll("[data-git-file]")).toHaveLength(2);
    expect(
      container.querySelector('[role="listbox"][aria-label="Changes"]')!.textContent,
    ).toContain("c.ts");
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: files.map((file) =>
          file.relative === "c.ts" ? file : { ...file, staged: true, unstaged: false },
        ),
      }),
    );
    await act(async () => finish[0]());
    expect(notifyGitChanged).toHaveBeenCalledExactlyOnceWith("/repo", "index");
    expect(gitStageFile).not.toHaveBeenCalled();
    expect(gitStageFiles).toHaveBeenCalledTimes(1);
  });
  it("unstages only selected staged files", async () => {
    const files = ["a.ts", "b.ts", "c.ts"].map((relative) =>
      changedFile(relative, { staged: true, unstaged: false }),
    );
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ files }));
    await renderPanel();
    await click("a.ts");
    await click("c.ts", { ctrlKey: true });
    await menuAction("c.ts", "Unstage Changes");
    expect(gitUnstageFiles).toHaveBeenCalledExactlyOnceWith("/repo", ["a.ts", "c.ts"]);
    expect(gitUnstageFile).not.toHaveBeenCalled();
  });
  it("restores the selection after a batch fails and permits a retry", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ files: [changedFile("a.ts"), changedFile("b.ts"), changedFile("c.ts")] }),
    );
    vi.mocked(gitStageFiles).mockRejectedValueOnce(new Error("index.lock exists"));
    await renderPanel();
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    await menuAction("a.ts", "Stage Changes");
    await act(async () => {});
    const changes = container.querySelector('[role="listbox"][aria-label="Changes"]')!;
    expect(changes.querySelectorAll("[data-git-file]")).toHaveLength(3);
    await click("a.ts");
    await click("b.ts", { ctrlKey: true });
    await menuAction("a.ts", "Stage Changes");
    expect(gitStageFiles).toHaveBeenCalledTimes(2);
    expect(gitStageFile).not.toHaveBeenCalled();
  });
  it("asks once before discarding a subset and respects cancellation", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ files: [changedFile("a.ts"), changedFile("b.ts"), changedFile("c.ts")] }),
    );
    await renderPanel();
    await click("a.ts");
    await click("c.ts", { ctrlKey: true });
    vi.mocked(ask).mockResolvedValueOnce(false);
    await menuAction("a.ts", "Discard Changes");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(gitDiscardFile).not.toHaveBeenCalled();
    expect(gitDiscardFiles).not.toHaveBeenCalled();
    await menuAction("c.ts", "Discard Changes");
    expect(ask).toHaveBeenCalledTimes(2);
    expect(gitDiscardFiles).toHaveBeenCalledExactlyOnceWith("/repo", ["a.ts", "c.ts"]);
    expect(gitDiscardFile).not.toHaveBeenCalled();
  });
});

it("keeps a collapsed repository summary but stops index polls until expanded", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.mocked(gitDiffIndex).mockResolvedValue(index());
  const render = (expanded: boolean) =>
    root.render(
      createElement(GitChangesPanel, {
        cwd: "/closed-poll-test",
        enabled: true,
        embedded: true,
        repository: { name: "closed", expanded, onToggle: vi.fn() },
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    );
  try {
    await act(async () => render(false));
    const initial = vi.mocked(gitDiffIndex).mock.calls.length;
    expect(initial).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GIT_POLL_MS * 3);
      window.dispatchEvent(new Event("focus"));
    });
    expect(vi.mocked(gitDiffIndex).mock.calls).toHaveLength(initial);
    await act(async () => render(true));
    expect(vi.mocked(gitDiffIndex).mock.calls.length).toBeGreaterThan(initial);
  } finally {
    vi.useRealTimers();
  }
});
it("keeps Amend reachable while the empty primary commit action is disabled, without committing on selection", async () => {
  const cwd = "/amend-empty-message";
  vi.mocked(gitDiffIndex).mockResolvedValue(index({ headPushed: false }));
  await renderPanel(cwd);
  const main = container.querySelector<HTMLButtonElement>(
    '[role="group"][aria-label="Commit"] > button',
  )!;
  expect(main.disabled).toBe(true);
  const options = container.querySelector<HTMLButtonElement>('[aria-label="Commit options"]')!;
  expect(options.disabled).toBe(false);
  await act(async () => options.click());
  const amend = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
  expect(amend.textContent).toContain("Amend Last Commit");
  expect(amend.disabled).toBe(false);
  await act(async () => amend.click());
  expect(container.querySelector('[role="group"][aria-label="Amend Commit"]')).not.toBeNull();
  expect(gitCommit).not.toHaveBeenCalled();
});

it.each(["Keep my new draft", "  "])(
  "preserves the commit draft %j typed while the amend lookup is pending",
  async (draft) => {
    let finish!: (message: string) => void;
    vi.mocked(gitHeadMessage).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ headPushed: false }));
    await renderPanel("/amend-pending-draft");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Commit options"]')!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!.click();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        draft,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea.value).toBe(draft);
    await act(async () => finish("Previous HEAD commit message"));
    expect(textarea.value).toBe(draft);
    expect(container.querySelector('[role="group"][aria-label="Amend Commit"]')).not.toBeNull();
    expect(gitCommit).not.toHaveBeenCalled();
  },
);
