import { afterEach, expect, it, vi } from "vitest";
import { remoteRequest } from "./connections";
import {
  resetRemoteMachineChannelsForTests,
  subscribeRemoteMachineChannel,
} from "./remoteMachineChannel";

vi.mock("./connections", () => ({ remoteRequest: vi.fn() }));

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
