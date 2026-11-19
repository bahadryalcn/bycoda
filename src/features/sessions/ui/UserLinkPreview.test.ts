// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("../../connections/model/workspaceUrls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../connections/model/workspaceUrls")>()),
  openWorkspaceUrl: vi.fn(async () => undefined),
}));

vi.mock("../model/linkPreview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model/linkPreview")>()),
  fetchLinkPreviewMetadata: vi.fn(async () => ({ title: null, faviconDataUrl: null })),
}));

vi.mock("../../inbox/model/githubTasks", () => ({
  formatRelativeTime: () => "2 hours ago",
  githubWorkItem: vi.fn(async () => ({
    kind: "pr",
    number: 73,
    title: "Make work item links easier to scan",
    url: "https://github.com/acme/widgets/pull/73",
    state: "open",
    createdAt: "2026-09-18T10:00:00Z",
    updatedAt: "2026-09-19T10:00:00Z",
    labels: [{ name: "enhancement", color: "8b5cf6" }],
    assignees: [{ login: "grace", avatarUrl: "" }],
    draft: false,
    repo: "acme/widgets",
  })),
  githubWorkItemDetails: vi.fn(async () => ({
    body: "Adds **compact chips** and a useful hover preview.",
    author: "ada",
    authorAvatarUrl: "",
    baseRefName: "main",
    headRefName: "link-chips",
    reviewDecision: "",
  })),
  peekGithubWorkItem: vi.fn(() => null),
  peekGithubWorkItemDetails: vi.fn(() => null),
}));

import { openUrl } from "@tauri-apps/plugin-opener";
import { openWorkspaceUrl } from "../../connections/public/workspaceUrls";
import {
  githubWorkItem,
  githubWorkItemDetails,
  peekGithubWorkItem,
  peekGithubWorkItemDetails,
} from "../../inbox/model/githubTasks";
import { fetchLinkPreviewMetadata, type UserLink } from "../model/linkPreview";
import { UserLinkPreview } from "./UserLinkPreview";
import { UserTextPreview } from "./UserTextPreview";

const link: UserLink = {
  url: "https://github.com/acme/widgets/pull/73",
  host: "github.com",
  displayUrl: "github.com/acme/widgets/pull/73",
  githubWorkItem: { kind: "pr", repo: "acme/widgets", number: 73 },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("links in sent messages", () => {
  const cwd = "remote://windows-host/G:/workspace";
  const url = "http://localhost:3000/report?view=pdf#page";

  it("opens a compact development link on its conversation Host", async () => {
    await act(async () =>
      root.render(
        createElement(UserLinkPreview, {
          link: { url, host: "localhost", displayUrl: "localhost/report" },
          cwd,
          compact: true,
        }),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLAnchorElement>("[data-user-link-preview]")!.click(),
    );

    expect(openWorkspaceUrl).toHaveBeenCalledWith(cwd, url);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("opens a linked document from a sent message on its owning Host", async () => {
    const onOpenFile = vi.fn();
    await act(async () =>
      root.render(
        createElement(UserTextPreview, {
          parts: [{ text: "[Report](./report.pdf)", kind: "text", compact: false }],
          cwd,
          onOpenFile,
          messageId: "message",
          markdown: true,
          renderActions: () => null,
        }),
      ),
    );
    await act(async () => container.querySelector<HTMLAnchorElement>("a[href]")!.click());

    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile.mock.calls[0][0]).toBe(`${cwd}/report.pdf`);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("surfaces a failed Host open without opening a local address", async () => {
    const failure = "No running development server in this project matches the link.";
    vi.mocked(openWorkspaceUrl).mockRejectedValueOnce(new Error(failure));
    await act(async () =>
      root.render(
        createElement(UserLinkPreview, {
          link: { url, host: "localhost", displayUrl: "localhost/report" },
          cwd,
        }),
      ),
    );
    await act(async () =>
      container.querySelector<HTMLAnchorElement>("[data-user-link-preview]")!.click(),
    );

    expect(document.body.textContent).toContain(failure);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps the Host scope for Markdown links (full content: %s)",
    async (compact) => {
      await act(async () =>
        root.render(
          createElement(UserTextPreview, {
            parts: [{ text: `[Report](${url})`, kind: "text", compact }],
            cwd,
            messageId: "message",
            markdown: true,
            renderActions: () => null,
          }),
        ),
      );
      if (compact) {
        await act(async () =>
          container.querySelector<HTMLButtonElement>('[aria-label="Show full long text"]')!.click(),
        );
      }
      const surface = compact ? document.querySelector('[role="dialog"]')! : container;
      await act(async () => surface.querySelector<HTMLAnchorElement>(`a[href="${url}"]`)!.click());

      expect(openWorkspaceUrl).toHaveBeenCalledWith(cwd, url);
      expect(openUrl).not.toHaveBeenCalled();
    },
  );
});

describe("external link page metadata", () => {
  const pageLink: UserLink = {
    url: "https://example.com/article",
    host: "example.com",
    displayUrl: "example.com/article",
  };
  const chip = () => container.querySelector<HTMLAnchorElement>("[data-user-link-preview]")!;

  it("does not contact the linked page when the message only mounts", async () => {
    vi.useFakeTimers();
    await act(async () => root.render(createElement(UserLinkPreview, { link: pageLink })));
    await act(async () => vi.advanceTimersByTime(5000));

    expect(fetchLinkPreviewMetadata).not.toHaveBeenCalled();
    expect(chip().textContent).toBe("example.com");
  });

  it("loads the title once after the pointer rests on the chip", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchLinkPreviewMetadata).mockResolvedValueOnce({
      title: "Example article",
      faviconDataUrl: null,
    });
    await act(async () => root.render(createElement(UserLinkPreview, { link: pageLink })));

    act(() => chip().dispatchEvent(new Event("pointerover", { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(299));
    expect(fetchLinkPreviewMetadata).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(fetchLinkPreviewMetadata).toHaveBeenCalledExactlyOnceWith(pageLink.url);
    expect(chip().textContent).toBe("Example article");
  });

  it("does not load when the pointer passes over without resting", async () => {
    vi.useFakeTimers();
    await act(async () => root.render(createElement(UserLinkPreview, { link: pageLink })));

    act(() => chip().dispatchEvent(new Event("pointerover", { bubbles: true })));
    act(() => chip().dispatchEvent(new Event("pointerout", { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(1000));

    expect(fetchLinkPreviewMetadata).not.toHaveBeenCalled();
  });

  it("loads on keyboard focus and still opens the link normally", async () => {
    await act(async () => root.render(createElement(UserLinkPreview, { link: pageLink })));

    await act(async () => chip().focus());
    expect(fetchLinkPreviewMetadata).toHaveBeenCalledExactlyOnceWith(pageLink.url);
    expect(chip().getAttribute("href")).toBe(pageLink.url);

    await act(async () => chip().click());
    expect(openUrl).toHaveBeenCalledWith(pageLink.url);
  });

  it("never fetches a development address", async () => {
    vi.useFakeTimers();
    const local: UserLink = {
      url: "http://localhost:3000/report",
      host: "localhost",
      displayUrl: "localhost/report",
    };
    await act(async () => root.render(createElement(UserLinkPreview, { link: local })));

    act(() => chip().dispatchEvent(new Event("pointerover", { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => chip().focus());

    expect(fetchLinkPreviewMetadata).not.toHaveBeenCalled();
  });
});

describe("GitHub work item link preview", () => {
  it("uses the current project scope for cached GitHub previews", async () => {
    act(() => root.render(createElement(UserLinkPreview, { link, cwd: "/project-b" })));
    expect(peekGithubWorkItem).toHaveBeenCalledWith("acme/widgets", "pr", 73, "/project-b");
    expect(peekGithubWorkItemDetails).toHaveBeenCalledWith("acme/widgets", "pr", 73, "/project-b");
    const chip = container.querySelector<HTMLAnchorElement>('[data-github-work-item-chip="pr"]')!;
    await act(async () => chip.focus());
    expect(githubWorkItem).toHaveBeenCalledWith("/project-b", "acme/widgets", "pr", 73);
    expect(githubWorkItemDetails).toHaveBeenCalledWith("/project-b", "acme/widgets", "pr", 73);
  });
  it("loads a rich keyboard-accessible popover when the chip receives focus", async () => {
    act(() => root.render(createElement(UserLinkPreview, { link, cwd: "/workspace/widgets" })));

    const chip = container.querySelector<HTMLAnchorElement>('[data-github-work-item-chip="pr"]')!;
    expect(chip.textContent).toBe("Pull request #73");
    expect(chip.getAttribute("aria-label")).toBe("Open pull request #73 in acme/widgets");

    await act(async () => {
      chip.focus();
      await Promise.resolve();
      await Promise.resolve();
    });

    const popover = document.querySelector<HTMLElement>("[data-hover-card]")!;
    expect(popover.textContent).toContain("Make work item links easier to scan");
    expect(popover.textContent).toContain("Adds compact chips and a useful hover preview.");
    expect(popover.textContent).toContain("ada");
    expect(popover.textContent).toContain("main ← link-chips");
    expect(popover.textContent).toContain("enhancement");
    expect(popover.textContent).toContain("Updated 2 hours ago");
    expect(githubWorkItem).toHaveBeenCalledWith("/workspace/widgets", "acme/widgets", "pr", 73);
    expect(githubWorkItemDetails).toHaveBeenCalledWith(
      "/workspace/widgets",
      "acme/widgets",
      "pr",
      73,
    );
  });

  it("opens after a short hover delay", async () => {
    vi.useFakeTimers();
    act(() => root.render(createElement(UserLinkPreview, { link })));
    const chip = container.querySelector<HTMLAnchorElement>('[data-github-work-item-chip="pr"]')!;

    act(() => chip.dispatchEvent(new Event("pointerover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(299));
    expect(document.querySelector("[data-hover-card]")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector("[data-hover-card]")).not.toBeNull();
  });

  it("labels an issue chip with its translated kind word in the accessible name", () => {
    const issueLink: UserLink = {
      url: "https://github.com/acme/widgets/issues/9",
      host: "github.com",
      displayUrl: "github.com/acme/widgets/issues/9",
      githubWorkItem: { kind: "issue", repo: "acme/widgets", number: 9 },
    };
    act(() => root.render(createElement(UserLinkPreview, { link: issueLink })));
    const chip = container.querySelector<HTMLAnchorElement>('[data-github-work-item-chip="issue"]')!;

    expect(chip.textContent).toBe("Issue #9");
    expect(chip.getAttribute("aria-label")).toBe("Open issue #9 in acme/widgets");
  });

  it("keeps the chip clickable and opens the original URL", () => {
    act(() => root.render(createElement(UserLinkPreview, { link })));
    const chip = container.querySelector<HTMLAnchorElement>('[data-github-work-item-chip="pr"]')!;

    act(() => chip.click());

    expect(openUrl).toHaveBeenCalledWith(link.url);
  });

  it("uses a compact treatment centered with inline message text", () => {
    act(() => root.render(createElement(UserLinkPreview, { link, compact: true })));
    const chip = container.querySelector<HTMLAnchorElement>('[data-github-work-item-chip="pr"]')!;

    expect(chip.getAttribute("data-compact")).toBe("true");
    expect(chip.querySelector("span")?.getAttribute("data-size")).toBe("caption");
    expect(chip.className).toContain("align-middle");
    expect(chip.getAttribute("data-link-appearance")).toBe("chip");
    expect(chip.className).toContain("gap-1");
    expect(chip.querySelector("span")?.className).toContain("h-4.5");
  });
});
