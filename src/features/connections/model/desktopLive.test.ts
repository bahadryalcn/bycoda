import { describe, expect, it, vi } from "vitest";
import type { Block, Session } from "../../sessions/model/session";
import {
  applyDesktopLiveCommand,
  executeDesktopInboxOperation,
  buildDesktopLiveSessions,
  runDesktopLiveTick,
  supportsDesktopLive,
  type DesktopLiveCommand,
} from "./desktopLive";

it("dispatches review context and inline review batches through the finite native bridge", async () => {
  const runner = { invoke: vi.fn().mockResolvedValue("url"), list: vi.fn() };
  const item = {
    provider: "github" as const,
    kind: "pr" as const,
    repo: "owner/repo",
    number: 7,
    projectPath: "/project",
  };
  await executeDesktopInboxOperation({ action: "review-context", cwd: "/project", item }, runner);
  expect(runner.invoke).toHaveBeenLastCalledWith("git_github_pr_review_context", {
    cwd: "/project",
    repo: "owner/repo",
    number: 7,
  });
  const review = {
    commitId: "a".repeat(40),
    event: "COMMENT" as const,
    body: "Şuraya bakalım.",
    comments: [{ path: "a.ts", line: 3, side: "RIGHT" as const, body: "Kontrol eksik." }],
  };
  await executeDesktopInboxOperation(
    { action: "review", cwd: "/project", item, ...review },
    runner,
  );
  expect(runner.invoke).toHaveBeenLastCalledWith("git_github_pr_review", {
    cwd: "/project",
    repo: "owner/repo",
    number: 7,
    review,
  });
});

const approvalBlock = (requestId: number, decided?: "allow"): Block =>
  ({
    id: `b${requestId}`,
    role: "tool",
    approval: { requestId, decided },
  }) as unknown as Block;

const session = (over: Partial<Session> & { id: string }): Session =>
  ({ blocks: [], busy: false, ...over }) as unknown as Session;

const question = {
  requestId: 7,
  questions: [],
} as unknown as Session["pendingQuestion"];

describe("buildDesktopLiveSessions", () => {
  it("selects busy sessions and ones needing input, skipping idle", () => {
    const out = buildDesktopLiveSessions([
      session({ id: "idle" }),
      session({ id: "busy", busy: true }),
      session({
        id: "appr",
        blocks: [approvalBlock(3), approvalBlock(4, "allow")],
      }),
      session({ id: "q", pendingQuestion: question }),
      session({ id: "gone", busy: true, worktreeRemoved: true } as never),
    ]);
    expect(out.map((s) => s.id)).toEqual(["busy", "appr", "q"]);
    expect(out[0]).toEqual({ id: "busy", busy: true });
    expect(out[1].busy).toBe(false);
    expect(out[1].pending?.map((b) => b.approval?.requestId)).toEqual([3]);
    expect(out[2].patch).toEqual({ pendingQuestion: question });
  });

  it("strips non-JSON values", () => {
    const block = {
      ...approvalBlock(1),
      fn: () => 1,
      nope: undefined,
    } as unknown as Block;
    const [entry] = buildDesktopLiveSessions([session({ id: "a", blocks: [block] })]);
    expect(entry.pending?.[0]).not.toHaveProperty("fn");
    expect(entry.pending?.[0]).not.toHaveProperty("nope");
  });
});

describe("applyDesktopLiveCommand", () => {
  const handlers = () => ({ stop: vi.fn(), approve: vi.fn(), answer: vi.fn() });
  const sessions = [
    session({
      id: "s",
      busy: true,
      blocks: [approvalBlock(3)],
      pendingQuestion: question,
    }),
    session({ id: "idle" }),
  ];

  it("maps cancel, approve and answer to the local handlers", () => {
    const h = handlers();
    expect(applyDesktopLiveCommand({ id: "1", sessionId: "s", type: "cancel" }, sessions, h)).toBe(
      true,
    );
    expect(h.stop).toHaveBeenCalledWith("s");
    expect(
      applyDesktopLiveCommand(
        {
          id: "2",
          sessionId: "s",
          type: "approve",
          requestId: 3,
          decision: "deny",
        },
        sessions,
        h,
      ),
    ).toBe(true);
    expect(h.approve).toHaveBeenCalledWith("s", 3, "deny");
    const reply = { kind: "skipped" } as const;
    applyDesktopLiveCommand(
      { id: "3", sessionId: "s", type: "answer", requestId: 7, reply },
      sessions,
      h,
    );
    expect(h.answer).toHaveBeenCalledWith("s", 7, reply);
  });

  it("drops stale commands", () => {
    const h = handlers();
    expect(
      applyDesktopLiveCommand({ id: "1", sessionId: "idle", type: "cancel" }, sessions, h),
    ).toBe(false);
    expect(
      applyDesktopLiveCommand({ id: "2", sessionId: "none", type: "cancel" }, sessions, h),
    ).toBe(false);
    expect(
      applyDesktopLiveCommand(
        {
          id: "3",
          sessionId: "s",
          type: "approve",
          requestId: 99,
          decision: "allow",
        },
        sessions,
        h,
      ),
    ).toBe(false);
    expect(
      applyDesktopLiveCommand(
        {
          id: "4",
          sessionId: "s",
          type: "answer",
          requestId: 8,
          reply: { kind: "skipped" },
        },
        sessions,
        h,
      ),
    ).toBe(false);
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.approve).not.toHaveBeenCalled();
    expect(h.answer).not.toHaveBeenCalled();
  });
});

describe("runDesktopLiveTick", () => {
  it("publishes session folder and manual-order changes during an otherwise idle heartbeat", async () => {
    let folderName = "Initial";
    const deps = {
      now: () => 100, beat: {}, request: vi.fn().mockResolvedValue({ commands: [] }), sessions: () => [],
      projectDirectory: () => ({ version: 1 as const, groups: [], excludedPaths: [], excludedGroupIds: [], projects: [{
        cwd: "/project", name: "Project", sessionLayout: { folders: [{ id: "f", name: folderName, sessionIds: ["s"], collapsed: false }], order: { loose: [folderName] } },
      }] }),
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() }, unacked: new Set<string>(), handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    expect(deps.request).toHaveBeenCalledTimes(1);
    folderName = "Renamed";
    await runDesktopLiveTick(deps);
    expect(deps.request).toHaveBeenCalledTimes(2);
    expect(deps.request.mock.lastCall?.[0].projectDirectory.projects[0].sessionLayout).toMatchObject({
      folders: [{ name: "Renamed" }], order: { loose: ["Renamed"] },
    });
  });
  it("publishes a changed directory privacy snapshot without waiting for the idle heartbeat", async () => {
    let now = 0;
    let excludedPaths: string[] = [];
    const deps = {
      now: () => now,
      beat: {},
      request: vi.fn().mockResolvedValue({ commands: [] }),
      sessions: () => [],
      projectDirectory: () => ({
        version: 1 as const,
        projects: [],
        groups: [],
        excludedPaths,
        excludedGroupIds: [],
      }),
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    now = 100;
    await runDesktopLiveTick(deps);
    expect(deps.request).toHaveBeenCalledTimes(1);
    excludedPaths = ["/private"];
    await runDesktopLiveTick(deps);
    expect(deps.request).toHaveBeenCalledTimes(2);
    expect(deps.request.mock.lastCall?.[0].projectDirectory.excludedPaths).toEqual(["/private"]);
  });
  it("retries a command whose local handler throws without acknowledging it", async () => {
    const command: DesktopLiveCommand = {
      id: "retry",
      sessionId: "s",
      type: "cancel",
    };
    const stop = vi.fn().mockImplementationOnce(() => {
      throw new Error("not ready");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = {
      request: vi.fn().mockResolvedValue({ commands: [command] }),
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop, approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
      clientId: "window",
    };
    try {
      await runDesktopLiveTick(deps);
      expect(deps.unacked.size).toBe(0);
      expect(deps.handled.size).toBe(0);
      await runDesktopLiveTick(deps);
      expect([...deps.unacked]).toEqual(["retry"]);
      expect(deps.request.mock.calls[0][0].clientId).toBe("window");
    } finally {
      log.mockRestore();
    }
  });
  it("executes once, acks on the next call, and dedupes re-sent commands", async () => {
    const stop = vi.fn();
    const cmd: DesktopLiveCommand = {
      id: "c1",
      sessionId: "s",
      type: "cancel",
    };
    const stale: DesktopLiveCommand = {
      id: "c2",
      sessionId: "gone",
      type: "cancel",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ commands: [cmd, stale] })
      .mockResolvedValueOnce({ commands: [cmd] })
      .mockResolvedValueOnce({ commands: [] });
    const deps = {
      request,
      sessions: () => [session({ id: "s", busy: true })],
      handlers: { stop, approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[0][0].acked).toBeUndefined();
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[1][0].acked).toEqual(["c1"]);
    await runDesktopLiveTick(deps);
    expect(request.mock.calls[2][0].acked).toEqual(["c1"]);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps acks when the request fails", async () => {
    const unacked = new Set(["x"]);
    const request = vi.fn().mockRejectedValue(new Error("down"));
    await expect(
      runDesktopLiveTick({
        request,
        sessions: () => [],
        handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
        unacked,
        handled: new Set(),
      }),
    ).rejects.toThrow();
    expect([...unacked]).toEqual(["x"]);
  });
});

describe("desktop deletion jobs", () => {
  it("deletes unopened history once and confirms only after the handler finishes", async () => {
    let finish!: () => void;
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const job = { id: "delete-1", sessionId: "history", cwd: "/project" };
    const request = vi.fn().mockResolvedValue({ deletions: { jobs: [job], acked: [] } });
    const deletions = {
      results: new Map<string, { id: string; error?: string }>(),
      running: new Set<string>(),
    };
    const deps = {
      request,
      sessions: () => [],
      deletions,
      handlers: {
        stop: vi.fn(),
        approve: vi.fn(),
        answer: vi.fn(),
        delete: remove,
      },
      unacked: new Set<string>(),
      handled: new Set<string>(),
    };
    await runDesktopLiveTick(deps);
    expect(remove).toHaveBeenCalledWith("history", "/project");
    expect(deletions.results.size).toBe(0);
    await runDesktopLiveTick(deps);
    expect(remove).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(deletions.results.get(job.id)).toEqual({ id: job.id }));
    request.mockRejectedValueOnce(new Error("offline"));
    await expect(runDesktopLiveTick(deps)).rejects.toThrow("offline");
    expect(deletions.results.size).toBe(1);
    request.mockResolvedValue({ deletions: { jobs: [], acked: [job.id] } });
    await runDesktopLiveTick(deps);
    expect(request.mock.calls.at(-1)?.[0].deletions.replies).toEqual([{ id: job.id }]);
    expect(deletions.results.size).toBe(0);
  });

  it("reports desktop refusal without claiming a successful deletion", async () => {
    const deletions = {
      results: new Map<string, { id: string; error?: string }>(),
      running: new Set<string>(),
    };
    await runDesktopLiveTick({
      request: async () => ({
        deletions: {
          jobs: [{ id: "d", sessionId: "s", cwd: "/project" }],
          acked: [],
        },
      }),
      sessions: () => [],
      deletions,
      handlers: {
        stop: vi.fn(),
        approve: vi.fn(),
        answer: vi.fn(),
        delete: async () => {
          throw new Error("Stop this session before deleting it");
        },
      },
      unacked: new Set(),
      handled: new Set(),
    });
    await vi.waitFor(() => expect(deletions.results.get("d")?.error).toMatch(/Stop this session/));
  });
});

describe("supportsDesktopLive", () => {
  it("checks the capability", () => {
    expect(supportsDesktopLive(["sessions.desktopLive"])).toBe(true);
    expect(supportsDesktopLive(["sessions.desktop"])).toBe(false);
    expect(supportsDesktopLive(undefined)).toBe(false);
  });
});

describe("desktop live memoization and idle cadence", () => {
  it("rescans only sessions whose object changed", () => {
    let reads = 0;
    const counted = (id: string) => {
      const s = session({ id });
      Object.defineProperty(s, "blocks", {
        get() {
          reads++;
          return [];
        },
      });
      return s;
    };
    const a = counted("a");
    const b = counted("b");
    buildDesktopLiveSessions([a, b]);
    expect(reads).toBe(2);
    const c = counted("c");
    buildDesktopLiveSessions([a, b, c]);
    expect(reads).toBe(3);
  });

  it("sends an empty heartbeat once, then waits for the idle interval", async () => {
    const request = vi.fn().mockResolvedValue({});
    let now = 1_000;
    const deps = {
      request,
      sessions: () => [session({ id: "idle" })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked: new Set<string>(),
      handled: new Set<string>(),
      beat: {},
      now: () => now,
    };
    await runDesktopLiveTick(deps);
    now += 1_500;
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(1);
    now += 3_600; // past DESKTOP_LIVE_IDLE_MS since the first beat
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("goes back to every tick as soon as a session is busy or an ack is pending", async () => {
    const request = vi.fn().mockResolvedValue({});
    let busy = false;
    const unacked = new Set<string>();
    const deps = {
      request,
      sessions: () => [session({ id: "s", busy })],
      handlers: { stop: vi.fn(), approve: vi.fn(), answer: vi.fn() },
      unacked,
      handled: new Set<string>(),
      beat: {},
      now: () => 1_000,
    };
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(1);
    busy = true;
    await runDesktopLiveTick(deps);
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(3);
    busy = false;
    unacked.add("c1");
    await runDesktopLiveTick(deps);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[3][0].acked).toEqual(["c1"]);
  });
});
