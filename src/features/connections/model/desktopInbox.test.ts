import { describe, expect, it, vi } from "vitest";
import {
  executeDesktopInboxOperation,
  runDesktopLiveTick,
  type DesktopInboxRunner,
} from "./desktopLive";
import type { Session } from "../../sessions/model/session";
import { readRemoteInboxList, REMOTE_INBOX_LIST_FRESH_MS } from "./desktopInboxOperation";

describe("native desktop inbox heartbeat runner", () => {
  it("dispatches Jira images only through the native approval permit", async () => {
    const invoke = vi.fn().mockResolvedValue({ outcome: "submitted" });
    const permit = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const deadline = Date.now() + 30_000;
    const result = await executeDesktopInboxOperation(
      {
        action: "jira-comment-images",
        item: {
          provider: "jira",
          kind: "jira",
          number: 7,
          repo: "",
          projectPath: "/project",
          identifier: "ENG-7",
        },
        cwd: "/project",
        imageRoot: "/worktree",
        body: "Verified",
        images: [{ path: "screen.png", sha256: "a".repeat(64) }],
        permit,
      },
      { invoke, list: vi.fn() },
      deadline,
    );
    expect(result).toEqual({ outcome: "submitted" });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("jira_agent_comment_with_images", {
      permit,
      deadline,
    });
  });
  it("reuses existing provider commands and returns only connection state", async () => {
    const invoke = vi.fn().mockResolvedValue({ connected: true, token: "never-forward" });
    const result = await executeDesktopInboxOperation(
      { action: "providers" },
      { invoke, list: vi.fn() },
    );
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "git_github_status",
      "gitlab_status",
      "azure_devops_status",
      "linear_status",
      "jira_status",
    ]);
    expect(JSON.stringify(result)).not.toContain("never-forward");
  });
  it("limits discovery to the requested providers", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [{ provider: "jira" }, { provider: "linear" }],
      errors: { jira: "slow", linear: "down" },
    });
    const result = await executeDesktopInboxOperation(
      {
        action: "list",
        projects: [{ path: "/project" }],
        query: { assignedToMe: false, state: "open", search: "", providers: ["jira"] },
      },
      { invoke: vi.fn(), list },
    );
    expect(list).toHaveBeenCalledWith(
      [{ path: "/project" }],
      {
        assignedToMe: false,
        state: "open",
        search: "",
        onlyProviders: ["jira"],
        githubKinds: [],
      },
      undefined,
    );
    expect(result).toEqual({ items: [{ provider: "jira" }], errors: { jira: "slow" } });
  });
  it("keeps the filter dimensions the phone's Inbox filters use on each listed item", async () => {
    const jira = {
      provider: "jira",
      teamId: "10001",
      teamName: "Platform",
      assignees: [{ login: "Ada", accountId: "acc-1" }],
    };
    const linear = { provider: "linear", teamId: "t1", projectId: "p1", projectName: "Launch" };
    const list = vi.fn().mockResolvedValue({ items: [jira, linear], errors: {} });
    const result = await executeDesktopInboxOperation(
      {
        action: "list",
        projects: [{ path: "/project" }],
        query: { assignedToMe: false, state: "all", search: "" },
      },
      { invoke: vi.fn(), list },
    );
    expect(result).toEqual({ items: [jira, linear], errors: {} });
  });
  it("passes only the owner's explicit refresh on, never as a provider query field", async () => {
    const list = vi.fn().mockResolvedValue({ items: [], errors: {} });
    await executeDesktopInboxOperation(
      {
        action: "list",
        projects: [{ path: "/project" }],
        query: { assignedToMe: true, state: "all", search: "x", refresh: true },
      },
      { invoke: vi.fn(), list },
    );
    expect(list).toHaveBeenCalledWith(
      [{ path: "/project" }],
      { assignedToMe: true, state: "all", search: "x" },
      { refresh: true },
    );
  });
  it("answers a phone list from a recent cache and reads providers on refresh or a miss", async () => {
    const read = vi.fn().mockResolvedValue("fresh");
    const cache = (fresh: boolean, cached: string | null) => ({
      fresh: vi.fn(() => fresh),
      peek: vi.fn(() => cached),
      read,
    });
    const hit = cache(true, "cached");
    expect(await readRemoteInboxList(hit, "q")).toBe("cached");
    expect(hit.fresh).toHaveBeenCalledWith("q", REMOTE_INBOX_LIST_FRESH_MS);
    expect(read).not.toHaveBeenCalled();
    expect(await readRemoteInboxList(cache(true, "cached"), "q", { refresh: true })).toBe("fresh");
    expect(await readRemoteInboxList(cache(false, "old"), "q")).toBe("fresh");
    expect(await readRemoteInboxList(cache(true, null), "q")).toBe("fresh");
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("continues session controls while provider work is slow, and executes a claimed job once", async () => {
    let finish!: () => void;
    const native = new Promise<unknown>((resolve) => {
      finish = () => resolve({ body: "Details", author: "Owner" });
    });
    const inbox: DesktopInboxRunner = {
      invoke: vi.fn(() => native),
      list: vi.fn(),
      running: new Set(),
      results: new Map(),
    };
    const stop = vi.fn();
    const job = {
      id: "job-1",
      operation: {
        action: "details" as const,
        cwd: "/project",
        item: {
          provider: "github" as const,
          kind: "issue" as const,
          number: 1,
          repo: "owner/repo",
          projectPath: "/project",
        },
      },
    };
    const request = vi.fn().mockResolvedValue({
      commands: [{ id: "stop-1", sessionId: "session-1", type: "cancel" }],
      inbox: { jobs: [job], acked: [] },
    });
    const deps = {
      request,
      sessions: () => [{ id: "session-1", busy: true, blocks: [] } as unknown as Session],
      handlers: { stop, approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
      inbox,
      beat: {},
    };
    await runDesktopLiveTick(deps);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(inbox.running.has("job-1")).toBe(true);
    await runDesktopLiveTick(deps);
    expect(inbox.invoke).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    finish();
    await native;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inbox.results.get("job-1")).toMatchObject({ result: { body: "Details" } });
  });
  it("invalidates notes on first known revision and changed revisions", async () => {
    const onNotesChanged = vi.fn();
    const inbox: DesktopInboxRunner = {
      invoke: vi.fn(),
      list: vi.fn(),
      running: new Set(),
      results: new Map(),
      onNotesChanged,
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ notesRevision: 100 })
      .mockResolvedValueOnce({ notesRevision: 100 })
      .mockResolvedValueOnce({ notesRevision: 101 });
    let time = 0;
    const deps = {
      request,
      sessions: () => [],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
      inbox,
      beat: {},
      now: () => time,
    };
    await runDesktopLiveTick(deps);
    time += 6_000;
    await runDesktopLiveTick(deps);
    time += 6_000;
    await runDesktopLiveTick(deps);
    expect(onNotesChanged).toHaveBeenCalledTimes(2);
  });
});
