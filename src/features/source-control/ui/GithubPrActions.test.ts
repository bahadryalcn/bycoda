// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../inbox/model/githubTasks", async (original) => ({
  ...(await original<typeof import("../../inbox/model/githubTasks")>()),
  githubPrAction: vi.fn(),
}));

import { githubPrAction, type GithubWorkItem, type InboxItem } from "../../inbox/model/githubTasks";
import { GithubPrActions } from "../../inbox/ui/InboxView";

let container: HTMLDivElement;
let root: Root;
const reviewedHeadOid = "a".repeat(40);

function pr(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    kind: "pr",
    title: "Ship the new inbox",
    url: "https://github.com/acme/web/pull/42",
    state: "open",
    updatedAt: "2026-09-16T08:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
    number: 42,
    projectPath: "/tmp/web",
    provider: "github",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(githubPrAction).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.querySelectorAll("[data-popover-side]").forEach((element) => element.remove());
  vi.unstubAllGlobals();
});

describe("GitHub pull request actions", () => {
  it("selects a merge method, confirms it, and publishes the fresh state", async () => {
    const item = pr();
    const merged: GithubWorkItem = {
      kind: "pr",
      title: item.title,
      url: item.url,
      state: "merged",
      updatedAt: "2026-09-16T08:05:00Z",
      labels: [],
      assignees: [],
      draft: false,
      repo: item.repo,
      number: item.number,
    };
    vi.mocked(githubPrAction).mockResolvedValue(merged);
    const onChange = vi.fn();
    act(() =>
      root.render(
        createElement(GithubPrActions, {
          item,
          baseRef: "main",
          headRef: "feature/inbox",
          reviewedHeadOid,
          onChange,
        }),
      ),
    );

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Merge options"]')!.click());
    const squash = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (button) => button.textContent?.includes("Squash and merge"),
    )!;
    act(() => squash.click());

    const primary = container.querySelector<HTMLButtonElement>(
      '[role="group"][aria-label="Squash and merge"] > button',
    )!;
    expect(githubPrAction).not.toHaveBeenCalled();
    act(() => primary.click());
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Squash and merge?"]',
    )!;
    expect(dialog.textContent).toContain(
      "from “feature/inbox” will be combined into one commit on “main”",
    );
    expect(dialog.textContent).toContain(`Reviewed head: ${reviewedHeadOid}`);

    await act(async () => {
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Squash and merge")!
        .click();
      await Promise.resolve();
    });

    expect(githubPrAction).toHaveBeenCalledExactlyOnceWith(
      "/tmp/web",
      "acme/web",
      42,
      "squash",
      reviewedHeadOid,
    );
    expect(onChange).toHaveBeenCalledWith({
      ...item,
      ...merged,
      projectPath: "/tmp/web",
      provider: "github",
    });
  });

  it("shows a failed close action error and requires fresh confirmation before retry", async () => {
    vi.mocked(githubPrAction).mockRejectedValue(
      new Error("You do not have permission to close this pull request"),
    );
    act(() =>
      root.render(
        createElement(GithubPrActions, {
          item: pr(),
          baseRef: "main",
          headRef: "feature/inbox",
        }),
      ),
    );

    const openClose = () => {
      const more = container.querySelector<HTMLButtonElement>(
        'button[aria-label="More pull request actions"]',
      )!;
      act(() => more.click());
      const close = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (entry) => entry.textContent?.trim() === "Close pull request",
      )!;
      act(() => close.click());
    };
    openClose();
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Close this pull request?"]',
    )!;
    await act(async () => {
      [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Close pull request")!
        .click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "You do not have permission to close this pull request",
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(githubPrAction).toHaveBeenCalledExactlyOnceWith(
      "/tmp/web",
      "acme/web",
      42,
      "close",
      undefined,
    );
    openClose();
    expect(
      document.querySelector('[role="dialog"][aria-label="Close this pull request?"]'),
    ).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(githubPrAction).toHaveBeenCalledTimes(1);
  });

  it("requires a reviewed head before offering merge confirmation", () => {
    act(() =>
      root.render(
        createElement(GithubPrActions, { item: pr(), baseRef: "main", headRef: "feature/inbox" }),
      ),
    );
    const merge = container.querySelector<HTMLButtonElement>(
      '[role="group"][aria-label="Merge pull request"] > button',
    )!;
    act(() => merge.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Refresh and review the pull request before merging.",
    );
    expect(githubPrAction).not.toHaveBeenCalled();
  });
});
