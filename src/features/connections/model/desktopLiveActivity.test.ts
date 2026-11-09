// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../sessions/model/session";
import {
  dismissRemoteActivityNotice,
  getRemoteActivityNotices,
} from "../../sessions/model/remoteActivityNotice";
import type { RemoteInboxOperation } from "../../inbox/model/remoteInbox";
import {
  applyDesktopLiveCommand,
  runDesktopLiveTick,
  type DesktopLiveBeat,
  type DesktopLiveHandlers,
  type DesktopLiveResult,
} from "./desktopLive";

const session = (over: Partial<Session> & { id: string }): Session =>
  ({ blocks: [], busy: false, cwd: "/project", ...over }) as unknown as Session;

const handlers = (): DesktopLiveHandlers => ({ stop: vi.fn(), approve: vi.fn(), answer: vi.fn() });
const notices = () => getRemoteActivityNotices().map((n) => ({ ...n }));

afterEach(() => {
  for (const notice of [...getRemoteActivityNotices()]) dismissRemoteActivityNotice(notice);
});

const tick = (
  result: DesktopLiveResult,
  over: Partial<Parameters<typeof runDesktopLiveTick>[0]> = {},
) =>
  runDesktopLiveTick({
    request: async () => result,
    sessions: () => [],
    handlers: handlers(),
    unacked: new Set(),
    handled: new Set(),
    ...over,
  });

describe("remote command notices", () => {
  it("records an applied stop with the asking device", () => {
    const applied = applyDesktopLiveCommand(
      { id: "1", sessionId: "s", type: "cancel", requestedBy: "Phone" },
      [session({ id: "s", busy: true })],
      handlers(),
    );
    expect(applied).toBe(true);
    expect(notices()).toEqual([
      { scope: { cwd: "/project" }, kind: "stopped", done: 1, failed: 0, devices: ["Phone"] },
    ]);
  });

  it("records an applied answer", () => {
    applyDesktopLiveCommand(
      {
        id: "2",
        sessionId: "s",
        type: "answer",
        requestId: 7,
        reply: {} as never,
        requestedBy: "Tablet",
      },
      [session({ id: "s", pendingQuestion: { requestId: 7, questions: [] } as never })],
      handlers(),
    );
    expect(notices()[0]).toMatchObject({ kind: "answered", devices: ["Tablet"] });
  });

  it("records nothing for a stale or unknown command", () => {
    const h = handlers();
    expect(
      applyDesktopLiveCommand(
        { id: "3", sessionId: "s", type: "cancel", requestedBy: "Phone" },
        [session({ id: "s", busy: false })],
        h,
      ),
    ).toBe(false);
    applyDesktopLiveCommand({ id: "4", sessionId: "gone", type: "cancel" }, [], h);
    applyDesktopLiveCommand(
      { id: "5", sessionId: "s", type: "approve", requestId: 1, decision: "allow" },
      [session({ id: "s" })],
      h,
    );
    expect(notices()).toEqual([]);
  });
});

describe("run lease take-back", () => {
  it("records takenOver only for a conversation that was running", async () => {
    const stop = vi.fn();
    await tick(
      { runLeases: { a: null, b: null } },
      {
        sessions: () => [session({ id: "a", busy: true }), session({ id: "b", cwd: "/other" })],
        handlers: { ...handlers(), stop },
        runLeases: { held: () => [], answered: () => ["a", "b"] },
      },
    );
    expect(stop).toHaveBeenCalledTimes(2);
    expect(notices()).toEqual([
      { scope: { cwd: "/project" }, kind: "takenOver", done: 1, failed: 0, devices: [] },
    ]);
  });
});

describe("remote inbox jobs", () => {
  const write = { action: "jira-board-transition" } as unknown as RemoteInboxOperation;
  const read = { action: "providers" } as unknown as RemoteInboxOperation;
  const run = async (operation: RemoteInboxOperation, jira: () => Promise<unknown>) => {
    const results = new Map();
    await tick(
      { inbox: { jobs: [{ id: "j", operation, requestedBy: "Laptop" }] } },
      {
        inbox: { invoke: async () => ({}), list: vi.fn(), jira, results, running: new Set() },
      },
    );
    await vi.waitFor(() => expect(results.size).toBe(1));
  };

  it("records a finished write", async () => {
    await run(write, async () => ({}));
    expect(notices()).toEqual([
      { scope: "inbox", kind: "inbox", done: 1, failed: 0, devices: ["Laptop"] },
    ]);
  });

  it("records a failed write", async () => {
    await run(write, async () => {
      throw new Error("nope");
    });
    expect(notices()[0]).toMatchObject({ scope: "inbox", done: 0, failed: 1 });
  });

  it("does not record a read", async () => {
    await run(read, async () => ({}));
    expect(notices()).toEqual([]);
  });
});

describe("activity feed", () => {
  const events = [
    { kind: "archived" as const, cwd: "/project", requestedBy: "Phone" },
    { kind: "settingsChanged" as const, cwd: "/project" },
  ];

  it("shows events after the first cursor and echoes the seq", async () => {
    const beat: DesktopLiveBeat = {};
    const payloads: unknown[] = [];
    const request = async (payload: unknown) => {
      payloads.push(payload);
      return { activity: { seq: payloads.length === 1 ? 4 : 6, events } };
    };
    await tick({}, { beat, request });
    expect(beat.activitySeq).toBe(4);
    beat.idleAt = undefined;
    expect(notices()).toEqual([]); // the first answer only sets the cursor
    await tick({}, { beat, request });
    expect(beat.activitySeq).toBe(6);
    expect((payloads[1] as { activitySeq?: number }).activitySeq).toBe(4);
    expect(notices().map((n) => n.kind)).toEqual(["archived", "settingsChanged"]);
    expect(notices()[0].devices).toEqual(["Phone"]);
  });

  it("does not replay events on reset", async () => {
    const beat: DesktopLiveBeat = { activitySeq: 3 };
    await tick({ activity: { seq: 1, events, reset: true } }, { beat });
    expect(beat.activitySeq).toBe(1);
    expect(notices()).toEqual([]);
  });

  it("ignores malformed events and caps device names", async () => {
    const beat: DesktopLiveBeat = { activitySeq: 1 };
    await tick(
      {
        activity: {
          seq: 2,
          events: [
            { kind: "bogus", cwd: "/p" },
            { kind: "archived", cwd: 5 },
            null,
            { kind: "archived", cwd: "/p", requestedBy: "x".repeat(500) },
          ],
        } as never,
      },
      { beat },
    );
    expect(notices()).toHaveLength(1);
    expect(notices()[0].devices[0]).toHaveLength(80);
  });

  it("refreshes the worktree list for worktreeChanged", async () => {
    const seen: unknown[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent).detail);
    const beat: DesktopLiveBeat = { activitySeq: 1 };
    window.addEventListener("bycoda-git-changed", listener);
    await tick(
      { activity: { seq: 2, events: [{ kind: "worktreeChanged", cwd: "/project" }] } },
      { beat },
    );
    window.removeEventListener("bycoda-git-changed", listener);
    expect(notices()[0]).toMatchObject({ kind: "worktreeChanged" });
    expect(seen).toEqual([{ cwd: "/project", scope: "refs" }]);
  });
});
