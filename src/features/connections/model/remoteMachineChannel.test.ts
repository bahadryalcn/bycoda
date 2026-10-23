// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { notifyRemoteRecovered } from "./remoteHealth";
import { bindMachineEnvironment } from "./remoteLifecycle";
import { remoteRequest } from "./connections";
import {
  resetRemoteMachineChannelsForTests,
  subscribeRemoteMachineChannel,
} from "./remoteMachineChannel";

vi.mock("./connections", () => ({ remoteRequest: vi.fn() }));

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
