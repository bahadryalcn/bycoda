// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { GitHistoryGraph } from "./GitHistoryGraph";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { GitStashSection } from "./GitStashSection";
import { gitHistory, gitStashList } from "../../../platform/tauri/fs";
import { resetGitResourceCache } from "../hooks/useGitResource";
import { resetGitPanelState, withGitOperation } from "../model/gitPanelState";

vi.mock("../../../platform/tauri/fs", () => ({
  gitHistory: vi.fn(),
  gitStashList: vi.fn(),
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: vi.fn(() => () => {}),
}));
vi.mock("../../connections/model/remoteCapabilities", () => ({
  GIT_ACTIONS: "git.actions",
  useRemoteSupports: () => true,
}));
vi.mock("../../connections/model/remoteHealth", () => ({
  useRemoteLoadFailure: () => undefined,
  reportRemoteLoad: vi.fn(),
}));
vi.mock("./GitGraphList", () => ({
  GitGraphList: (props: {
    empty?: React.ReactNode;
    items: { commit: { subject: string } }[];
    hasMore: boolean;
    onLoadMore: () => void;
  }) =>
    createElement(
      "div",
      null,
      props.empty ?? props.items.map((item) => item.commit.subject).join(" "),
      props.hasMore ? createElement("button", { onClick: props.onLoadMore }, "Load more") : null,
    ),
}));
vi.mock("./GitGraphWorkspace", () => ({
  GitGraphWorkspace: ({ graph }: { graph: React.ReactNode }) => graph,
}));

let root: Root;
let container: HTMLDivElement;
const commit = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  subject: "Existing commit",
  parents: [],
  refs: [],
  head: true,
  author: "Test",
  timestamp: 1,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  resetRetainedState();
  vi.clearAllMocks();
  resetGitResourceCache();
  resetGitPanelState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(gitHistory).mockResolvedValue({ head: null, commits: [] });
  vi.mocked(gitStashList).mockResolvedValue([]);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function graph(cwd = "/repo") {
  await act(async () =>
    root.render(
      createElement(GitHistoryGraph, {
        cwd,
        enabled: true,
        expanded: true,
        onToggleExpanded: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
}
async function click(label: string) {
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find(
        (button) => button.getAttribute("aria-label") === label || button.textContent === label,
      )!
      .click(),
  );
}

it("retains history search and branch scope on remount without leaking them to another repository", async () => {
  await graph();
  await click("Show all branches");
  await click("Search commits");
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Existing",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  await graph();
  expect(container.querySelector("input")!.value).toBe("Existing");
  expect(
    container.querySelector('[aria-label="Show all branches"]')!.getAttribute("aria-pressed"),
  ).toBe("true");
  await graph("/other");
  expect(container.querySelector("input")).toBeNull();
  expect(
    container.querySelector('[aria-label="Show all branches"]')!.getAttribute("aria-pressed"),
  ).toBe("false");
  await graph();
  expect(container.querySelector("input")!.value).toBe("Existing");
});

it("shows loading before an empty graph and settles to the real empty state", async () => {
  const request = deferred<Awaited<ReturnType<typeof gitHistory>>>();
  vi.mocked(gitHistory).mockReturnValueOnce(request.promise);
  await graph();
  expect(container.textContent).toContain("Loading commit graph…");
  expect(container.textContent).not.toContain("No commits yet");
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  await act(async () => request.resolve({ head: null, commits: [] }));
  expect(container.textContent).toContain("No commits yet");
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
});

it("retains commits while refreshing and after a failed refresh, then retries", async () => {
  vi.mocked(gitHistory).mockResolvedValueOnce({
    head: commit.sha,
    commits: [commit],
  });
  await graph();
  const request = deferred<Awaited<ReturnType<typeof gitHistory>>>();
  vi.mocked(gitHistory).mockReturnValueOnce(request.promise);
  await click("Refresh commit graph");
  expect(container.textContent).not.toContain("Refreshing commit graph…");
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.querySelector(".animate-spin")).not.toBeNull();
  expect(container.textContent).toContain("Existing commit");
  await act(async () => request.reject(new Error("Permission denied")));
  expect(container.textContent).toContain("Couldn’t load commit graph");
  expect(container.textContent).toContain("Showing what was last loaded");
  expect(container.textContent).toContain("Existing commit");
  vi.mocked(gitHistory).mockResolvedValueOnce({
    head: commit.sha,
    commits: [commit],
  });
  await click("Retry");
  expect(container.textContent).not.toContain("Couldn’t load commit graph");
});

it("does not turn an initial failure into an empty history", async () => {
  vi.mocked(gitHistory).mockRejectedValueOnce(new Error("Git failed"));
  await graph();
  expect(container.textContent).toContain("Couldn’t load commit graph");
  expect(container.textContent).not.toContain("No commits yet");
});

it("ignores a late response from the previous project", async () => {
  const request = deferred<Awaited<ReturnType<typeof gitHistory>>>();
  vi.mocked(gitHistory).mockReturnValueOnce(request.promise);
  await graph("/first");
  await graph("/second");
  await act(async () => request.resolve({ head: commit.sha, commits: [commit] }));
  expect(container.textContent).not.toContain("Existing commit");
  expect(container.textContent).toContain("No commits yet");
});

it("shows progress while loading another page and retains existing commits", async () => {
  const page = Array.from({ length: 200 }, (_, index) => ({
    ...commit,
    sha: index.toString(16).padStart(40, "0"),
    subject: `Commit ${index}`,
  }));
  vi.mocked(gitHistory).mockResolvedValueOnce({
    head: commit.sha,
    commits: page,
  });
  await graph();
  const request = deferred<Awaited<ReturnType<typeof gitHistory>>>();
  vi.mocked(gitHistory).mockReturnValueOnce(request.promise);
  await click("Load more");
  expect(gitHistory).toHaveBeenLastCalledWith("/repo", 400, false);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.textContent).toContain("Commit 199");
  expect(
    [...container.querySelectorAll("button")].some((button) => button.textContent === "Load more"),
  ).toBe(false);
  await act(async () => request.resolve({ head: commit.sha, commits: page }));
  expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  expect(container.querySelector(".animate-spin")).toBeNull();
});

it("tam grafik açılınca tüm branch geçmişini yükler", async () => {
  const request = deferred<Awaited<ReturnType<typeof gitHistory>>>();
  vi.mocked(gitHistory).mockReturnValueOnce(request.promise);
  await graph();
  vi.mocked(gitHistory).mockReturnValueOnce(request.promise);
  await click("Open full graph");
  expect(gitHistory).toHaveBeenLastCalledWith("/repo", 200, true);
  expect(document.body.textContent?.match(/Loading commit graph/g)?.length).toBe(2);
  await act(async () => request.resolve({ head: commit.sha, commits: [commit] }));
  expect(document.body.textContent?.match(/Existing commit/g)?.length).toBe(2);
});

it("keeps the stash section visible on load failure and disables it during another Git operation", async () => {
  vi.mocked(gitStashList).mockRejectedValueOnce(new Error("Stash read failed"));
  await act(async () =>
    root.render(
      createElement(GitStashSection, {
        cwd: "/repo",
        enabled: true,
        hasChanges: true,
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain("Couldn’t load stashes");
  const request = deferred<void>();
  let operation!: Promise<void>;
  await act(async () => {
    operation = withGitOperation("/repo", "Staging…", () => request.promise);
  });
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Stash all changes"]')?.disabled,
  ).toBe(true);
  await act(async () => request.resolve());
  await operation;
  expect(
    container.querySelector<HTMLButtonElement>('[aria-label="Stash all changes"]')?.disabled,
  ).toBe(false);
});
