// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const pty = vi.hoisted(() => ({
  spawnPty: vi.fn(async (..._args: unknown[]) => {}),
  readyPtyBridge: vi.fn(async () => {}),
  killPty: vi.fn(async (_id: string) => {}),
  resizePty: vi.fn(async () => {}),
  writePty: vi.fn(async () => {}),
  subscribePty: vi.fn((..._args: unknown[]) => () => {}),
  setPtyVisible: vi.fn(async () => {}),
}));
const native = vi.hoisted(() => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../../platform/tauri/pty", () => pty);

import { createTerminalPtyRuntime } from "./terminalPtyRuntime";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0));
};

function runtime(id: string) {
  const unsubscribe = vi.fn();
  pty.subscribePty.mockReturnValueOnce(unsubscribe);
  const handlers = {
    lifecycle: vi.fn(),
    onExit: vi.fn(),
    onSpawned: vi.fn(),
    onStartFailed: vi.fn(),
    onInputFailure: vi.fn(),
  };
  const instance = createTerminalPtyRuntime({
    id,
    privateTerminal: true,
    launch: { kind: "local", cwd: "/work", profile: () => "profile" },
    dimensions: () => ({ cols: 80, rows: 24 }),
    writeOutput: () => {},
    isVisible: () => true,
    canStart: { current: undefined },
    authorizeStart: { current: undefined },
    ...handlers,
  });
  return { instance, unsubscribe, ...handlers };
}

beforeEach(() => {
  vi.clearAllMocks();
  pty.killPty.mockReset().mockResolvedValue(undefined);
  pty.subscribePty.mockReset().mockReturnValue(() => {});
});

afterEach(async () => {
  await flush();
});

it("retries failed native retirement instead of retaining its rejected attempt", async () => {
  const { instance, lifecycle, unsubscribe } = runtime("retirement-retry");
  instance.start();
  await flush();
  pty.killPty.mockRejectedValueOnce(new Error("kill unavailable"));
  await expect(instance.retire()).rejects.toThrow("kill unavailable");
  expect(lifecycle).not.toHaveBeenCalledWith("closed");
  await expect(instance.retire()).resolves.toBeUndefined();
  expect(pty.killPty).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(lifecycle).toHaveBeenLastCalledWith("closed");
});

it("a replacement retries the old failed retirement and waits for its acknowledgment", async () => {
  const first = runtime("retirement-replacement");
  first.instance.start();
  await flush();
  pty.killPty.mockRejectedValueOnce(new Error("kill unavailable"));
  await expect(first.instance.retire()).rejects.toThrow("kill unavailable");
  const kill = deferred();
  pty.killPty.mockReturnValueOnce(kill.promise);
  const second = runtime("retirement-replacement");
  second.instance.start();
  await flush();
  expect(pty.killPty).toHaveBeenCalledTimes(2);
  expect(pty.spawnPty).toHaveBeenCalledTimes(1);
  expect(second.instance.spawned).toBe(false);
  kill.resolve();
  await flush();
  expect(pty.spawnPty).toHaveBeenCalledTimes(2);
  expect(second.instance.spawned).toBe(true);
  await second.instance.retire();
});

it("a replacement that never spawned cannot erase the failed owner's retirement fence", async () => {
  const first = runtime("retirement-fence");
  first.instance.start();
  await flush();
  pty.killPty.mockRejectedValueOnce(new Error("kill unavailable"));
  await expect(first.instance.retire()).rejects.toThrow("kill unavailable");
  pty.killPty.mockRejectedValueOnce(new Error("still unavailable"));
  const second = runtime("retirement-fence");
  second.instance.start();
  await flush();
  expect(second.onStartFailed).toHaveBeenCalled();
  await second.instance.retire();
  const kill = deferred();
  pty.killPty.mockReturnValueOnce(kill.promise);
  const third = runtime("retirement-fence");
  third.instance.start();
  await flush();
  expect(pty.spawnPty).toHaveBeenCalledTimes(1);
  expect(pty.killPty).toHaveBeenCalledTimes(3);
  kill.resolve();
  await flush();
  expect(third.instance.spawned).toBe(true);
  await third.instance.retire();
});

it("retire during a pending start waits for the start, then kills exactly that PTY once", async () => {
  const spawn = deferred();
  pty.spawnPty.mockReturnValueOnce(spawn.promise);
  const { instance, unsubscribe, lifecycle } = runtime("retire-pending");

  instance.start();
  await flush();
  expect(pty.spawnPty).toHaveBeenCalledOnce();

  let settled = false;
  const retired = instance.retire().then(() => {
    settled = true;
  });
  await flush();
  expect(pty.killPty).not.toHaveBeenCalled();
  expect(settled).toBe(false);

  spawn.resolve();
  await retired;
  expect(pty.killPty).toHaveBeenCalledOnce();
  expect(pty.killPty).toHaveBeenCalledWith("retire-pending");
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(lifecycle).toHaveBeenLastCalledWith("closed");
  expect(instance.spawned).toBe(false);
});

it("retire before anything was spawned does not kill a PTY it never started", async () => {
  const ready = deferred();
  pty.readyPtyBridge.mockReturnValueOnce(ready.promise);
  const { instance } = runtime("retire-before-spawn");

  instance.start();
  await flush();
  const retired = instance.retire();
  ready.resolve();
  await retired;

  expect(pty.spawnPty).not.toHaveBeenCalled();
  expect(pty.killPty).not.toHaveBeenCalled();
});

it("detach releases the view but never kills the process", async () => {
  const { instance, unsubscribe, lifecycle } = runtime("detach-only");

  instance.start();
  await flush();
  expect(instance.spawned).toBe(true);

  instance.detach();
  await flush();
  expect(instance.detached).toBe(true);
  expect(instance.live).toBe(false);
  expect(pty.killPty).not.toHaveBeenCalled();
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(lifecycle).not.toHaveBeenCalledWith("closed");
});

it("calling retire twice kills once and returns the same teardown", async () => {
  const { instance } = runtime("retire-twice");

  instance.start();
  await flush();

  const first = instance.retire();
  const second = instance.retire();
  expect(second).toBe(first);
  await Promise.all([first, second]);
  await instance.retire();

  expect(pty.killPty).toHaveBeenCalledOnce();
  expect(pty.killPty).toHaveBeenCalledWith("retire-twice");
});

it("a second runtime for the same id waits for the first one's stop fence before starting", async () => {
  const kill = deferred();
  const order: string[] = [];
  pty.killPty.mockImplementationOnce(async () => {
    order.push("kill:start");
    await kill.promise;
    order.push("kill:end");
  });
  pty.spawnPty.mockImplementation(async () => {
    order.push("spawn");
  });

  const first = runtime("shared-id");
  first.instance.start();
  await flush();
  expect(pty.spawnPty).toHaveBeenCalledOnce();
  order.length = 0;

  const retired = first.instance.retire();
  const second = runtime("shared-id");
  second.instance.start();
  await flush();

  // The kill is in flight; the replacement has neither subscribed nor spawned.
  expect(order).toEqual(["kill:start"]);
  expect(pty.spawnPty).toHaveBeenCalledOnce();
  expect(pty.subscribePty).toHaveBeenCalledOnce();
  expect(second.onSpawned).not.toHaveBeenCalled();

  kill.resolve();
  await retired;
  await flush();

  expect(order).toEqual(["kill:start", "kill:end", "spawn"]);
  expect(pty.spawnPty).toHaveBeenCalledTimes(2);
  expect(pty.killPty).toHaveBeenCalledOnce();
  expect(second.onSpawned).toHaveBeenCalledOnce();
  expect(second.instance.spawned).toBe(true);

  pty.spawnPty.mockImplementation(async () => {});
  await second.instance.retire();
  expect(pty.killPty).toHaveBeenCalledTimes(2);
});

it("does not hold back a runtime with a different id", async () => {
  const kill = deferred();
  pty.killPty.mockImplementationOnce(() => kill.promise);

  const first = runtime("fence-a");
  first.instance.start();
  await flush();
  const retired = first.instance.retire();

  const other = runtime("fence-b");
  other.instance.start();
  await flush();
  expect(other.onSpawned).toHaveBeenCalledOnce();

  kill.resolve();
  await retired;
  await other.instance.retire();
});
