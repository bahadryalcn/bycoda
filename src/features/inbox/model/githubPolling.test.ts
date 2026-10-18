import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearInboxCache,
  inboxListFetchedAt,
  inboxListIsFresh,
  listInboxItems,
  listGithubWorkItems,
  peekInboxList,
} from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const query = { assignedToMe: false, state: "open", search: "" } as const;
const projects = [{ path: "/app" }];
beforeEach(() => {
  clearInboxCache();
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_github_repositories") return ["acme/app"];
    if (command === "git_github_work_items") return [];
    return { connected: false };
  });
});
afterEach(() => vi.useRealTimers());
const lists = () =>
  vi.mocked(invoke).mock.calls.filter(([command]) => command === "git_github_work_items");

it("does not read GitHub when another provider tab supplies an empty kind selection", async () => {
  await listInboxItems(projects, { ...query, githubKinds: [] });
  expect(lists()).toHaveLength(0);
  expect(invoke).not.toHaveBeenCalledWith("git_github_repositories", expect.anything());
});

it("fetches only PRs and reuses that list when the background requests both kinds", async () => {
  await listInboxItems(projects, { ...query, githubKinds: ["pr"] });
  expect(lists()).toHaveLength(1);
  expect(lists()[0]?.[1]).toMatchObject({ kind: "pr" });
  await listInboxItems(projects, query);
  expect(lists()).toHaveLength(2);
  expect(lists()[1]?.[1]).toMatchObject({ kind: "issue" });
  await listInboxItems(projects, { ...query, githubKinds: ["pr"] });
  expect(lists()).toHaveLength(2);
});

it("shares overlapping reads, respects freshness and allows explicit refresh", async () => {
  await Promise.all([listInboxItems(projects, query), listInboxItems(projects, query)]);
  expect(lists()).toHaveLength(2);
  const fetchedAt = inboxListFetchedAt(projects, query);
  vi.advanceTimersByTime(299_999);
  await listInboxItems(projects, query);
  expect(lists()).toHaveLength(2);
  expect(inboxListIsFresh(projects, query)).toBe(true);
  expect(inboxListFetchedAt(projects, query)).toBe(fetchedAt);
  vi.advanceTimersByTime(1);
  expect(inboxListIsFresh(projects, query)).toBe(false);
  await listInboxItems(projects, query);
  expect(lists()).toHaveLength(4);
  await listInboxItems(projects, query, { force: true });
  expect(lists()).toHaveLength(6);
});

it("separates searches in the cache", async () => {
  await listGithubWorkItems("/app", "acme/app", { ...query, kind: "pr", search: "first" });
  await listGithubWorkItems("/app", "acme/app", { ...query, kind: "pr", search: "second" });
  expect(lists()).toHaveLength(2);
});

it("uses fifteen-minute freshness in the background without hiding stale data on entry", async () => {
  await listInboxItems(projects, query);
  const fetchedAt = inboxListFetchedAt(projects, query);
  vi.advanceTimersByTime(6 * 60_000);
  await listInboxItems(projects, query, { maxAgeMs: 15 * 60_000 });
  expect(lists()).toHaveLength(2);
  expect(inboxListFetchedAt(projects, query)).toBe(fetchedAt);
  // Entering the Inbox uses its shorter five-minute freshness policy.
  await listInboxItems(projects, query);
  expect(lists()).toHaveLength(4);
  vi.advanceTimersByTime(15 * 60_000 - 1);
  await listInboxItems(projects, query, { maxAgeMs: 15 * 60_000 });
  expect(lists()).toHaveLength(4);
  vi.advanceTimersByTime(1);
  await listInboxItems(projects, query, { maxAgeMs: 15 * 60_000 });
  expect(lists()).toHaveLength(6);
});

it("keeps saved items visible when GitHub refresh fails", async () => {
  const item = {
    kind: "pr",
    number: 1,
    title: "Saved",
    repo: "acme/app",
    updatedAt: "2026-10-07T00:00:00Z",
  };
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_github_repositories") return ["acme/app"];
    if (command === "git_github_work_items") return [item];
    return { connected: false };
  });
  const saved = await listInboxItems(projects, { ...query, githubKinds: ["pr"] });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_github_work_items") throw new Error("offline");
    return { connected: false };
  });
  const next = await listInboxItems(projects, { ...query, githubKinds: ["pr"] }, { force: true });
  expect(next.items).toEqual(saved.items);
  expect(next.errors.github).toContain("offline");
  expect(peekInboxList(projects, { ...query, githubKinds: ["pr"] })).toEqual(next);
});
