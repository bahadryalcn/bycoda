import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import {
  clearInboxCache,
  githubPrAction,
  githubPrDiff,
  githubWorkItem,
  githubWorkItemDetails,
  githubWorkItemComment,
  peekGithubWorkItem,
  peekGithubWorkItemDetails,
  prefetchGithubWorkItem,
  type GithubWorkItem,
} from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  clearInboxCache();
  vi.mocked(invoke).mockReset();
});
const details = { body: "fresh", author: "maya" };

it("invalidates a successful comment despite unrelated item scope changes", async () => {
  vi.mocked(invoke).mockResolvedValue(details);
  await githubWorkItemDetails("/a", "org/repo", "issue", 1);
  let finish!: (value: string) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const comment = githubWorkItemComment("/a", "org/repo", "issue", 1, "hello");
  vi.mocked(invoke).mockResolvedValue(details);
  await githubWorkItemDetails("/first", "org/repo", "issue", 2);
  await githubWorkItemDetails("/second", "org/repo", "issue", 2);
  finish("comment-url");
  await comment;
  expect(peekGithubWorkItemDetails("org/repo", "issue", 1, "/a")).toBeNull();
});

it("retains unrelated inflight detail results when a different item changes scope", async () => {
  let finish!: (value: typeof details) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = githubWorkItemDetails("/a", "org/repo", "issue", 1);
  vi.mocked(invoke).mockResolvedValue(details);
  await githubWorkItemDetails("/first", "org/repo", "issue", 2);
  await githubWorkItemDetails("/second", "org/repo", "issue", 2);
  finish(details);
  await pending;
  expect(peekGithubWorkItemDetails("org/repo", "issue", 1, "/a")).toEqual(details);
});

it("does not publish a late action under another project's cache owner", async () => {
  const oldItem: GithubWorkItem = {
    kind: "pr",
    number: 1,
    title: "old",
    repo: "org/repo",
    url: "",
    state: "closed",
    updatedAt: "",
    labels: [],
    assignees: [],
    draft: false,
  };
  const newItem = { ...oldItem, title: "new", state: "open" };
  let finish!: (value: GithubWorkItem) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const action = githubPrAction("/old", "org/repo", 1, "close");
  vi.mocked(invoke).mockResolvedValue(newItem);
  await githubWorkItem("/new", "org/repo", "pr", 1);
  finish(oldItem);
  await action;
  expect(peekGithubWorkItem("org/repo", "pr", 1, "/new")).toEqual(newItem);
  await expect(githubWorkItem("/new", "org/repo", "pr", 1, { maxAgeMs: 30_000 })).resolves.toEqual(
    newItem,
  );
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("does not reuse a full-file diff after its project scope is evicted", async () => {
  const oldDiff = { additions: 1, deletions: 0, files: [], patch: "old", truncated: false };
  const newDiff = { ...oldDiff, patch: "new" };
  vi.mocked(invoke).mockResolvedValue(oldDiff);
  await githubPrDiff("/old", "org/repo", 1, { fullContext: true });
  vi.mocked(invoke).mockResolvedValue(details);
  for (let number = 2; number <= 129; number++)
    await githubWorkItemDetails("/other", "org/repo", "issue", number);
  vi.mocked(invoke).mockResolvedValue(newDiff);
  await expect(
    githubPrDiff("/new", "org/repo", 1, { fullContext: true, maxAgeMs: 30_000 }),
  ).resolves.toEqual(newDiff);
  expect(invoke).toHaveBeenLastCalledWith("git_github_pr_diff", {
    cwd: "/new",
    repo: "org/repo",
    number: 1,
    fullContext: true,
  });
});

it("does not share a full-file inflight diff after its project scope is evicted", async () => {
  const oldDiff = { additions: 1, deletions: 0, files: [], patch: "old", truncated: false };
  const newDiff = { ...oldDiff, patch: "new" };
  let finish!: (value: typeof oldDiff) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const oldRequest = githubPrDiff("/old", "org/repo", 1, { fullContext: true });
  vi.mocked(invoke).mockResolvedValue(details);
  for (let number = 2; number <= 129; number++)
    await githubWorkItemDetails("/other", "org/repo", "issue", number);
  vi.mocked(invoke).mockResolvedValue(newDiff);
  await expect(githubPrDiff("/new", "org/repo", 1, { fullContext: true })).resolves.toEqual(
    newDiff,
  );
  finish(oldDiff);
  await oldRequest;
  await expect(
    githubPrDiff("/new", "org/repo", 1, { fullContext: true, maxAgeMs: 30_000 }),
  ).resolves.toEqual(newDiff);
});

it("shares detail requests and reuses only fresh results", async () => {
  vi.mocked(invoke).mockResolvedValue(details);
  await Promise.all([
    githubWorkItemDetails("/repo", "org/repo", "pr", 1),
    githubWorkItemDetails("/repo", "org/repo", "pr", 1),
  ]);
  expect(invoke).toHaveBeenCalledTimes(1);
  await githubWorkItemDetails("/repo", "org/repo", "pr", 1, { maxAgeMs: 30_000 });
  expect(invoke).toHaveBeenCalledTimes(1);
  await githubWorkItemDetails("/repo", "org/repo", "pr", 1, { maxAgeMs: 0 });
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("does not reuse another project scope or late pre-clear responses", async () => {
  let finish!: (value: typeof details) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = githubWorkItemDetails("/old", "org/repo", "pr", 1);
  clearInboxCache();
  finish(details);
  await pending;
  expect(peekGithubWorkItemDetails("org/repo", "pr", 1)).toBeNull();
  vi.mocked(invoke).mockResolvedValue(details);
  await githubWorkItemDetails("/first", "org/repo", "pr", 1);
  expect(peekGithubWorkItemDetails("org/repo", "pr", 1, "/other")).toBeNull();
  await githubWorkItemDetails("/other", "org/repo", "pr", 1, { maxAgeMs: 30_000 });
  expect(invoke).toHaveBeenCalledTimes(3);
});

it("invalidates summaries after comments and retries rejected preloads", async () => {
  vi.mocked(invoke).mockResolvedValue(details);
  await githubWorkItemDetails("/repo", "org/repo", "issue", 1);
  await githubWorkItemComment("/repo", "org/repo", "issue", 1, "hello");
  expect(peekGithubWorkItemDetails("org/repo", "issue", 1)).toBeNull();
  vi.mocked(invoke).mockRejectedValue(new Error("offline"));
  prefetchGithubWorkItem("/repo", { repo: "org/repo", kind: "issue", number: 2 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.mocked(invoke).mockResolvedValue(details);
  await expect(githubWorkItemDetails("/repo", "org/repo", "issue", 2)).resolves.toEqual(details);
});

it("bounds cached details", async () => {
  vi.mocked(invoke).mockResolvedValue(details);
  for (let number = 1; number <= 129; number++)
    await githubWorkItemDetails("/repo", "org/repo", "issue", number);
  expect(peekGithubWorkItemDetails("org/repo", "issue", 1)).toBeNull();
  expect(peekGithubWorkItemDetails("org/repo", "issue", 129)).toEqual(details);
});
