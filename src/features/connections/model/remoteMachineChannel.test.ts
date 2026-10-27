// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { notifyRemoteRecovered } from "./remoteHealth";
import { bindMachineEnvironment } from "./remoteLifecycle";
import { cachedRemoteCapabilities, remoteRequest } from "./connections";
import {
  acquireRemoteHostRuntime,
  resetRemoteMachineChannelsForTests,
  subscribeRemoteMachineChannel,
} from "./remoteMachineChannel";
import { createTauriHostConnection } from "../../../platform/tauri/hostConnection";
import type {
  ManagedHostConnectionPort,
  ManagedHostEvent,
} from "../../../shared/lib/host-runtime/ports";

vi.mock("./connections", () => ({
  remoteRequest: vi.fn(),
  cachedRemoteCapabilities: vi.fn(() => undefined),
  mayStartTunnel: vi.fn(() => true),
}));
vi.mock("../../../platform/tauri/hostConnection", () => ({ createTauriHostConnection: vi.fn() }));

it("does not let a late short refresh replace a newer delivered response", async () => {
  vi.useFakeTimers();
  const replies: ((value: unknown) => void)[] = [];
  vi.mocked(remoteRequest).mockImplementation(
    () => new Promise((resolve) => replies.push(resolve)),
  );
  const stopFirst = subscribeRemoteMachineChannel(
    "ordered",
    { sessions: [{ sessionId: "a", revision: 1 }] },
    vi.fn(),
  );
  await vi.advanceTimersByTimeAsync(0);
  const listener = vi.fn();
  const stopNext = subscribeRemoteMachineChannel(
    "ordered",
    { sessions: [{ sessionId: "b", revision: 1 }] },
    listener,
  );
  const reply = {
    instanceId: "boot",
    sessions: [],
    projects: [],
    reset: false,
    checkedSessions: ["a", "b"],
    checkedProjects: [],
  };
  replies[0](reply);
  await vi.advanceTimersByTimeAsync(0);
  expect(replies).toHaveLength(3);
  replies[2]({ ...reply, sequenceTag: "newer" });
  await vi.advanceTimersByTimeAsync(0);
  replies[1]({ ...reply, sequenceTag: "older" });
  await vi.advanceTimersByTimeAsync(0);
  expect(listener).toHaveBeenCalledOnce();
  expect(listener.mock.lastCall?.[0]).toMatchObject({ sequenceTag: "newer" });
  stopFirst();
  stopNext();
});

it("delivers changed demand without waiting for an unrelated held poll", async () => {
  vi.useFakeTimers();
  let release!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const reply = {
    instanceId: "boot",
    reset: false,
    sessions: [],
    projects: [],
    checkedSessions: ["new"],
    checkedProjects: [],
  };
  vi.mocked(remoteRequest).mockImplementation((_machine, _method, params) =>
    params?.waitMs === 0 ? (Promise.resolve(reply) as never) : (held as never),
  );
  const stopFirst = subscribeRemoteMachineChannel(
    "changed-demand",
    { sessions: [{ sessionId: "old", revision: 1 }] },
    vi.fn(),
  );
  await vi.advanceTimersByTimeAsync(0);
  const listener = vi.fn();
  const stopNext = subscribeRemoteMachineChannel(
    "changed-demand",
    { sessions: [{ sessionId: "new", revision: 2 }] },
    listener,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.mocked(remoteRequest).mock.calls[1]?.[2]).toMatchObject({
    waitMs: 0,
    sessions: [
      { sessionId: "old", revision: 1 },
      { sessionId: "new", revision: 2 },
    ],
  });
  expect(listener).toHaveBeenCalledOnce();
  // The old response is obsolete and must not replace the immediately refreshed state.
  release({ ...reply, checkedSessions: ["old"], reset: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(listener).toHaveBeenCalledOnce();
  stopFirst();
  stopNext();
});

it("only requests inline bodies for currently visible demand while keeping hidden revision subscriptions", async () => {
  vi.useFakeTimers();
  vi.mocked(remoteRequest).mockResolvedValue({
    instanceId: "boot",
    reset: false,
    sessions: [],
    projects: [],
  });
  let visible = true;
  const stopVisible = subscribeRemoteMachineChannel(
    "inline-visibility",
    () => ({ inlineSync: visible, sessions: [{ sessionId: "visible", revision: 4 }] }),
    vi.fn(),
  );
  const stopHidden = subscribeRemoteMachineChannel(
    "inline-visibility",
    { inlineSync: false, sessions: [{ sessionId: "hidden", revision: 9 }] },
    vi.fn(),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.mocked(remoteRequest).mock.lastCall?.[2]).toMatchObject({
    inlineSync: true,
    inlineSessionIds: ["visible"],
    sessions: [
      { sessionId: "visible", revision: 4 },
      { sessionId: "hidden", revision: 9 },
    ],
  });
  visible = false;
  await vi.advanceTimersByTimeAsync(1_000);
  const last = vi.mocked(remoteRequest).mock.lastCall?.[2];
  expect(last).not.toHaveProperty("inlineSync");
  expect(last).toMatchObject({
    sessions: [
      { sessionId: "visible", revision: 4 },
      { sessionId: "hidden", revision: 9 },
    ],
  });
  stopVisible();
  stopHidden();
});

it("does not verify a subscriber omitted from the current native scheduling round", async () => {
  vi.useFakeTimers();
  vi.mocked(remoteRequest).mockResolvedValue({
    instanceId: "boot",
    reset: false,
    sessions: [],
    projects: [],
    checkedSessions: ["active"],
    checkedProjects: [],
  });
  const active = vi.fn();
  const background = vi.fn();
  const stopActive = subscribeRemoteMachineChannel(
    "scope",
    { sessions: [{ sessionId: "active", revision: 1 }] },
    active,
  );
  const stopBackground = subscribeRemoteMachineChannel(
    "scope",
    { projects: [{ projectId: "background" }] },
    background,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(active).toHaveBeenCalledOnce();
  expect(background).not.toHaveBeenCalled();
  vi.mocked(remoteRequest).mockResolvedValue({
    instanceId: "boot",
    reset: true,
    sessions: [],
    projects: [],
    checkedSessions: ["active"],
    checkedProjects: [],
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(background).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reset: true }));
  stopActive();
  stopBackground();
});

it("remembers recently active projects after their visible session unsubscribes", async () => {
  vi.useFakeTimers();
  vi.mocked(remoteRequest).mockResolvedValue({
    instanceId: "boot",
    reset: false,
    sessions: [],
    projects: [],
  });
  const rail = subscribeRemoteMachineChannel("recent", { projects: [{ projectId: "p" }] }, vi.fn());
  const tab = subscribeRemoteMachineChannel(
    "recent",
    {
      sessions: [{ sessionId: "s", revision: 1 }],
      active: { projectId: "p", sessionId: "s", lastActiveAt: 20 },
    },
    vi.fn(),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(remoteRequest).toHaveBeenLastCalledWith(
    "recent",
    "machine.changes",
    expect.objectContaining({
      activeSessions: [{ sessionId: "s", lastActiveAt: 20 }],
      activeProjects: [{ projectId: "p", lastActiveAt: 20 }],
    }),
  );
  tab();
  await vi.advanceTimersByTimeAsync(100);
  expect(remoteRequest).toHaveBeenLastCalledWith(
    "recent",
    "machine.changes",
    expect.objectContaining({
      sessions: [],
      activeProjects: [{ projectId: "p", lastActiveAt: 20 }],
    }),
  );
  const last = vi.mocked(remoteRequest).mock.calls.at(-1)?.[2];
  expect(last).not.toHaveProperty("activeSessions");
  rail();
});

it("discards an in-flight pre-recovery poll and requests a snapshot without starting a second poll", async () => {
  vi.useFakeTimers();
  bindMachineEnvironment("snapshot", "snapshot-env");
  const finishes: ((value: unknown) => void)[] = [];
  vi.mocked(remoteRequest).mockImplementation(
    () => new Promise((resolve) => finishes.push(resolve)),
  );
  const listener = vi.fn();
  const stop = subscribeRemoteMachineChannel(
    "snapshot",
    {
      sessions: [{ sessionId: "s", revision: 10 }],
      projects: [{ projectId: "p", known: "old" }],
    },
    listener,
  );
  await vi.advanceTimersByTimeAsync(0);
  notifyRemoteRecovered("unrelated-env");
  notifyRemoteRecovered("snapshot-env");
  expect(remoteRequest).toHaveBeenCalledTimes(1);
  finishes[0]({ instanceId: "old", sessions: [], projects: [], reset: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(listener).not.toHaveBeenCalled();
  expect(remoteRequest).toHaveBeenLastCalledWith(
    "snapshot",
    "machine.changes",
    expect.objectContaining({
      sessions: [{ sessionId: "s", revision: 0 }],
      projects: [{ projectId: "p" }],
    }),
  );
  finishes[1]({ instanceId: "new", sessions: [], projects: [], reset: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ reset: true }));
  stop();
});

it.each(["recovered", "focus", "online", "visibilitychange"])(
  "wakes a failed control channel on %s without waiting for backoff",
  async (event) => {
    vi.useFakeTimers();
    vi.mocked(remoteRequest).mockReset();
    vi.mocked(remoteRequest)
      .mockRejectedValueOnce(new Error("host offline"))
      .mockImplementation(() => new Promise(() => {}));
    const listener = vi.fn();
    const stop = subscribeRemoteMachineChannel("wake", {}, listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).toHaveBeenCalledTimes(1);
    if (event === "recovered") notifyRemoteRecovered("env");
    else if (event === "visibilitychange") document.dispatchEvent(new Event(event));
    else window.dispatchEvent(new Event(event));
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).toHaveBeenCalledTimes(2);
    // A wake while polling must not start another long-poll.
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).toHaveBeenCalledTimes(2);
    stop();
    vi.mocked(remoteRequest).mockClear();
    notifyRemoteRecovered("env");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteRequest).not.toHaveBeenCalled();
  },
);

it("reports a shared poll failure to remaining consumers even if one error handler throws", async () => {
  vi.useFakeTimers();
  let reject!: (error: unknown) => void;
  vi.mocked(remoteRequest).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const firstError = vi.fn(() => {
    throw new Error("consumer error");
  });
  const secondError = vi.fn();
  const removedError = vi.fn();
  const firstStop = subscribeRemoteMachineChannel(
    "m",
    { projects: [{ projectId: "p" }] },
    vi.fn(),
    firstError,
  );
  const secondStop = subscribeRemoteMachineChannel(
    "m",
    { sessions: [{ sessionId: "s", revision: 1 }] },
    vi.fn(),
    secondError,
  );
  const removedStop = subscribeRemoteMachineChannel("m", {}, vi.fn(), removedError);
  await vi.advanceTimersByTimeAsync(0);
  removedStop();
  const failure = new Error("host timeout");
  reject(failure);
  await Promise.resolve();
  await Promise.resolve();
  expect(firstError).toHaveBeenCalledWith(failure);
  expect(secondError).toHaveBeenCalledWith(failure);
  expect(removedError).not.toHaveBeenCalled();
  expect(remoteRequest).toHaveBeenCalledTimes(1);
  firstStop();
  secondStop();
});

afterEach(() => {
  resetRemoteMachineChannelsForTests();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.mocked(cachedRemoteCapabilities).mockReturnValue(undefined);
});

it("shares one machine long poll and unregisters the final consumer", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  vi.mocked(remoteRequest).mockImplementation((_machine, _method, params) => {
    if ((params as { sessions?: unknown[] }).sessions?.length === 0)
      return Promise.resolve(undefined);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = subscribeRemoteMachineChannel(
    "m",
    { sessions: [{ sessionId: "a", revision: 4 }] },
    first,
  );
  const stopSecond = subscribeRemoteMachineChannel(
    "m",
    { projects: [{ projectId: "p", known: "e" }] },
    second,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(remoteRequest).toHaveBeenCalledTimes(1);
  expect(remoteRequest).toHaveBeenCalledWith(
    "m",
    "machine.changes",
    expect.objectContaining({
      sessions: [{ sessionId: "a", revision: 4 }],
      projects: [{ projectId: "p", known: "e" }],
    }),
  );
  finish({
    instanceId: "boot",
    reset: false,
    sessions: [{ sessionId: "a", revision: 5 }],
    projects: [],
  });
  await Promise.resolve();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  stopFirst();
  stopSecond();
  await Promise.resolve();
  expect(remoteRequest).toHaveBeenCalledWith(
    "m",
    "machine.changes",
    expect.objectContaining({
      sessions: [],
      projects: [],
      waitMs: 0,
      subscriptionId: expect.any(String),
    }),
  );
});

it("marks a host restart as reset even when the server omitted the reset hint", async () => {
  vi.useFakeTimers();
  let finishes: ((value: unknown) => void)[] = [];
  vi.mocked(remoteRequest).mockImplementation(
    () => new Promise((resolve) => finishes.push(resolve)),
  );
  const listener = vi.fn();
  const stop = subscribeRemoteMachineChannel("m", { projects: [{ projectId: "p" }] }, listener);
  await vi.advanceTimersByTimeAsync(0);
  finishes.shift()!({
    instanceId: "one",
    reset: false,
    sessions: [],
    projects: [],
  });
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(100);
  finishes.shift()!({
    instanceId: "two",
    reset: false,
    sessions: [],
    projects: [],
  });
  await Promise.resolve();
  expect(listener.mock.calls[1]?.[0].reset).toBe(true);
  stop();
});

it("carries inline opt-in and delivers the same delta to independent subscribers", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  vi.mocked(remoteRequest).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = vi.fn();
  const second = vi.fn();
  const stopA = subscribeRemoteMachineChannel(
    "m",
    { inlineSync: true, sessions: [{ sessionId: "s", revision: 1 }] },
    first,
  );
  const stopB = subscribeRemoteMachineChannel(
    "m",
    { sessions: [{ sessionId: "s", revision: 2 }] },
    second,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(remoteRequest).toHaveBeenCalledWith(
    "m",
    "machine.changes",
    expect.objectContaining({ inlineSync: true, sessions: [{ sessionId: "s", revision: 1 }] }),
  );
  const changes = {
    instanceId: "boot",
    reset: false,
    sessions: [{ sessionId: "s", revision: 2, sync: { kind: "delta", base: 1 } }],
    projects: [],
  };
  finish(changes);
  await Promise.resolve();
  expect(first).toHaveBeenCalledWith(changes);
  expect(second).toHaveBeenCalledWith(changes);
  stopA();
  stopB();
});

it("backs off while the host keeps answering nothing at once", async () => {
  vi.useFakeTimers();
  vi.mocked(remoteRequest).mockReset();
  vi.mocked(remoteRequest).mockResolvedValue({
    instanceId: "boot",
    reset: false,
    sessions: [],
    projects: [],
  });
  const stop = subscribeRemoteMachineChannel(
    "spin",
    { sessions: [{ sessionId: "s", revision: 1 }] },
    vi.fn(),
  );
  await vi.advanceTimersByTimeAsync(3_000);
  // 100 ms re-arms would poll ~30 times; the back-off caps it near one a second.
  expect(vi.mocked(remoteRequest).mock.calls.length).toBeLessThan(10);
  stop();
});

async function flushNative() {
  for (let index = 0; index < 25; index++) await Promise.resolve();
}
function nativeFixture(machineId: string) {
  const environmentId = `env-${machineId}`;
  bindMachineEnvironment(machineId, environmentId);
  vi.mocked(cachedRemoteCapabilities).mockReturnValue([
    "transport.ws.sessions.v2",
    "transport.ws.bulk.v2",
  ]);
  let listener: ((event: ManagedHostEvent) => void) | undefined;
  const stopListening = vi.fn();
  const port: ManagedHostConnectionPort = {
    listen: vi.fn(async (callback) => {
      listener = callback;
      return stopListening;
    }),
    attach: vi.fn(async () => {
      listener?.({ kind: "state", environmentId, generation: 1, phase: "ready" });
      return true;
    }),
    detach: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    bulk: vi.fn(async () => null),
    request: vi.fn(async (method, params) => ({
      generation: 1,
      result:
        method === "subscriptions.open"
          ? {
              subscriptionId: (params as { subscriptionId: string }).subscriptionId,
              streamId: `stream-${(params as { subscriptionId: string }).subscriptionId}`,
            }
          : { accepted: true },
    })),
  };
  vi.mocked(createTauriHostConnection).mockReturnValue(port);
  const calls = (method: string) =>
    vi.mocked(port.request).mock.calls.filter(([name]) => name === method);
  const emit = (
    kind: "session" | "project",
    id: string,
    data: unknown,
    sequence = 1,
    eventKind: "snapshot" | "delta" = "snapshot",
  ) => {
    const open = calls("subscriptions.open").findLast(([, params]) => {
      const target = (
        params as { target: { kind: string; sessionId?: string; projectId?: string } }
      ).target;
      return target.kind === kind && (target.sessionId ?? target.projectId) === id;
    });
    const subscriptionId = (open?.[1] as { subscriptionId: string })?.subscriptionId ?? "missing";
    const delta =
      eventKind === "delta" ? (data as { base: number; value: { revision: number } }) : undefined;
    listener?.({
      kind: "subscription",
      environmentId,
      generation: 1,
      event: {
        jsonrpc: "2.0",
        method: "subscription.event",
        params: {
          subscriptionId,
          streamId: `stream-${subscriptionId}`,
          cursor: { epoch: "epoch", sequence },
          kind: eventKind,
          ...(delta ? { baseRevision: delta.base, revision: delta.value.revision } : {}),
          data,
        },
      },
    } as ManagedHostEvent);
  };
  return { port, emit, calls, stopListening };
}

it("shares a capability-gated project stream and ACKs only after every listener commits", async () => {
  const { port, emit, calls, stopListening } = nativeFixture("ws-project");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = vi.fn();
  const second = vi.fn(() => held);
  const stopFirst = subscribeRemoteMachineChannel(
    "ws-project",
    { projects: [{ projectId: "p" }] },
    first,
  );
  const stopSecond = subscribeRemoteMachineChannel(
    "ws-project",
    { projects: [{ projectId: "p" }] },
    second,
  );
  await flushNative();
  expect(calls("subscriptions.open")).toHaveLength(1);
  expect(remoteRequest).not.toHaveBeenCalled();
  emit("project", "p", { etag: "etag", sessions: [] });
  await flushNative();
  expect(first).toHaveBeenCalledWith(
    expect.objectContaining({ projects: [{ projectId: "p", etag: "etag", sessions: [] }] }),
  );
  expect(second).toHaveBeenCalledOnce();
  expect(calls("subscriptions.ack")).toHaveLength(0);
  release();
  await flushNative();
  expect(calls("subscriptions.ack")).toHaveLength(1);
  stopFirst();
  await flushNative();
  expect(port.detach).not.toHaveBeenCalled();
  stopSecond();
  await flushNative();
  expect(port.detach).toHaveBeenCalledOnce();
  expect(stopListening).toHaveBeenCalledOnce();
  expect(remoteRequest).not.toHaveBeenCalled();
  emit("project", "p", { etag: "late", sessions: [] }, 2);
  await flushNative();
  expect(first).toHaveBeenCalledOnce();
});

it("adapts a full session snapshot to a replacement delta while preserving hidden revision hints", async () => {
  const { emit, calls } = nativeFixture("ws-session");
  const visible = vi.fn(() => ({ appliedRevision: 5 }));
  const hidden = vi.fn();
  const stopVisible = subscribeRemoteMachineChannel(
    "ws-session",
    { inlineSync: true, sessions: [{ sessionId: "s", revision: 4 }] },
    visible,
  );
  const stopHidden = subscribeRemoteMachineChannel(
    "ws-session",
    { inlineSync: false, sessions: [{ sessionId: "s", revision: 3 }] },
    hidden,
  );
  await flushNative();
  emit("session", "s", {
    projectId: "p",
    revision: 5,
    status: "running",
    updatedAt: 100,
    session: {
      id: "s",
      cwd: "/fixture",
      title: "Session",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [{ id: "b", role: "assistant", text: "new" }],
    },
  });
  await flushNative();
  expect(visible.mock.calls[0]?.[0]).toMatchObject({
    sessions: [
      {
        sessionId: "s",
        revision: 5,
        sync: expect.objectContaining({
          kind: "delta",
          base: 4,
          blockIds: ["b"],
          blocks: [{ id: "b", role: "assistant", text: "new" }],
        }),
      },
    ],
  });
  expect(hidden.mock.calls[0]?.[0]).toMatchObject({ sessions: [{ sessionId: "s", revision: 5 }] });
  expect(calls("subscriptions.ack")).toHaveLength(1);
  stopVisible();
  stopHidden();
});

it("keeps partial-history session hints and bounded tasks/git demand on HTTP compatibility", async () => {
  vi.useFakeTimers();
  const { calls } = nativeFixture("ws-mixed");
  vi.mocked(remoteRequest).mockImplementation(() => new Promise(() => {}));
  const stop = subscribeRemoteMachineChannel(
    "ws-mixed",
    {
      projects: [{ projectId: "p" }],
      sessions: [{ sessionId: "partial", revision: 7 }],
      inlineSync: false,
      tasksKnown: "tasks",
      git: Array.from({ length: 40 }, (_, index) => ({ cwd: `/fixture-${index}` })),
    },
    vi.fn(),
  );
  await vi.advanceTimersByTimeAsync(0);
  await flushNative();
  expect(calls("subscriptions.open")).toHaveLength(1);
  expect(vi.mocked(remoteRequest).mock.calls[0]?.[2]).toMatchObject({
    projects: [],
    sessions: [{ sessionId: "partial", revision: 7 }],
    tasksKnown: "tasks",
  });
  const compatibility = vi.mocked(remoteRequest).mock.calls[0]?.[2];
  if (!compatibility || typeof compatibility !== "object" || !("git" in compatibility))
    throw new Error("Missing compatibility Git demand");
  expect(compatibility.git).toHaveLength(32);
  stop();
});

it("bounds logical resnapshot recovery before HTTP fallback without a physical retry loop", async () => {
  vi.useFakeTimers();
  const { emit, calls } = nativeFixture("ws-failure");
  vi.mocked(remoteRequest).mockImplementation(() => new Promise(() => {}));
  const errors = vi.fn();
  const stop = subscribeRemoteMachineChannel(
    "ws-failure",
    { projects: [{ projectId: "p" }] },
    () => {
      throw new Error("Application rejected");
    },
    errors,
  );
  await flushNative();
  emit("project", "p", { etag: "e", sessions: [] });
  await flushNative();
  expect(errors).not.toHaveBeenCalled();
  emit("project", "p", { etag: "e", sessions: [] }, 2);
  await flushNative();
  emit("project", "p", { etag: "e", sessions: [] }, 3);
  await flushNative();
  expect(calls("subscriptions.open")).toHaveLength(3);
  expect(calls("subscriptions.ack")).toHaveLength(0);
  expect(errors).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(0);
  expect(remoteRequest).toHaveBeenCalledWith(
    "ws-failure",
    "machine.changes",
    expect.objectContaining({ projects: [{ projectId: "p" }] }),
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(createTauriHostConnection).toHaveBeenCalledOnce();
  stop();
});

it("shares route acquisition with unary callers and releases only the final native owner", async () => {
  const { port } = nativeFixture("ws-unary");
  const first = acquireRemoteHostRuntime("ws-unary")!;
  const second = acquireRemoteHostRuntime("ws-unary")!;
  expect(first.runtime).toBe(second.runtime);
  await first.runtime.start();
  first.release();
  await flushNative();
  expect(port.detach).not.toHaveBeenCalled();
  second.release();
  second.release();
  await flushNative();
  expect(port.detach).toHaveBeenCalledOnce();
});

function streamView(revision: number) {
  return {
    projectId: "p",
    revision,
    status: "running",
    updatedAt: 100,
    session: {
      id: "s",
      cwd: "/fixture",
      title: "Session",
      harness: "codex",
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [{ id: "a", role: "assistant", text: `revision-${revision}` }],
    },
  };
}
function streamDelta(base: number, revision: number) {
  const {
    session: { blocks, ...session },
    ...metadata
  } = streamView(revision);
  return {
    kind: "delta",
    base,
    value: { ...metadata, session },
    blockIds: blocks.map((block) => block.id),
    blocks,
  };
}

it("uses committed revision receipts for ordered canonical deltas while rendered demand catches up", async () => {
  const { emit, calls } = nativeFixture("ws-deltas");
  let observedRevision = 4;
  const listener = vi.fn((changes: import("./protocol").MachineChanges) => ({
    appliedRevision: changes.sessions[0].revision,
  }));
  const stop = subscribeRemoteMachineChannel(
    "ws-deltas",
    () => ({ inlineSync: true, sessions: [{ sessionId: "s", revision: observedRevision }] }),
    listener,
  );
  await flushNative();
  emit("session", "s", streamView(5));
  await flushNative();
  emit("session", "s", streamDelta(5, 6), 2, "delta");
  await flushNative();
  emit("session", "s", streamDelta(6, 7), 3, "delta");
  await flushNative();
  expect(listener).toHaveBeenCalledTimes(3);
  expect(listener.mock.calls[2]?.[0].sessions[0].sync).toEqual(streamDelta(6, 7));
  expect(calls("subscriptions.ack")).toHaveLength(3);
  // An independent read advanced beyond the stream's committed baseline.
  observedRevision = 9;
  emit("session", "s", streamDelta(7, 8), 4, "delta");
  await flushNative();
  expect(listener).toHaveBeenCalledTimes(3);
  expect(calls("subscriptions.ack")).toHaveLength(3);
  expect(calls("subscriptions.open")).toHaveLength(2);
  emit("session", "s", streamView(10), 5);
  await flushNative();
  expect(listener.mock.calls[3]?.[0].sessions[0].sync).toMatchObject({
    kind: "delta",
    base: 9,
    value: { revision: 10 },
  });
  expect(calls("subscriptions.ack")).toHaveLength(4);
  stop();
});

it("does not ACK a void transcript callback that only queued hydration", async () => {
  const { emit, calls } = nativeFixture("ws-uncommitted");
  const stop = subscribeRemoteMachineChannel(
    "ws-uncommitted",
    { inlineSync: true, sessions: [{ sessionId: "s", revision: 4 }] },
    vi.fn(),
  );
  await flushNative();
  emit("session", "s", streamView(5));
  await flushNative();
  expect(calls("subscriptions.ack")).toHaveLength(0);
  expect(calls("subscriptions.open")).toHaveLength(2);
  stop();
});

it("awaits a guarded hydration receipt before committing its stream cursor", async () => {
  const { emit, calls } = nativeFixture("ws-hydration");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = subscribeRemoteMachineChannel(
    "ws-hydration",
    { inlineSync: true, sessions: [{ sessionId: "s", revision: 4 }] },
    async (_changes, application) => {
      await held;
      return application?.isCurrent() ? { appliedRevision: 5 } : undefined;
    },
  );
  await flushNative();
  emit("session", "s", streamView(5));
  await flushNative();
  expect(calls("subscriptions.ack")).toHaveLength(0);
  release();
  await flushNative();
  expect(calls("subscriptions.ack")).toHaveLength(1);
  stop();
});
