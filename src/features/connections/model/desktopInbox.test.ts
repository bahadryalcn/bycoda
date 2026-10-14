import { describe, expect, it, vi } from "vitest";
import {
  executeDesktopInboxOperation,
  runDesktopLiveTick,
  type DesktopInboxRunner,
} from "./desktopLive";
import type { Session } from "../../sessions/model/session";

describe("native desktop inbox heartbeat runner", () => {
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
