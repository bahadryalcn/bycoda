import { afterEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "window-a" }),
}));

const listen = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  listen.mockReset();
  invoke.mockReset();
  vi.resetModules();
});

it("returns native credits exactly once after the controlled parser completes and protects replacement subscribers", async () => {
  vi.useFakeTimers();
  const callbacks = new Map<string, (event: { payload: unknown }) => void>();
  listen.mockImplementation(async (name, callback) => {
    callbacks.set(name, callback);
    return vi.fn();
  });
  invoke.mockResolvedValue(undefined);
  const { subscribePty, readyPtyBridge } = await import("./pty");
  let consumed: (() => void) | undefined;
  const stop = subscribePty(
    "flow",
    (_data, done) => {
      consumed = done;
    },
    vi.fn(),
    true,
  );
  await readyPtyBridge();
  callbacks.get("pty-data")!({
    payload: { id: "flow", data: btoa("bytes"), flow: { generation: 7, sequence: 8 } },
  });
  expect(invoke).not.toHaveBeenCalled();
  consumed!();
  consumed!();
  // Acks are cumulative and batched: nothing is sent until the 32 ms window ends.
  expect(invoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(32);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_output_ack", {
    id: "flow",
    generation: 7,
    sequence: 8,
  });
  const replacement = subscribePty("flow", vi.fn(), vi.fn(), true);
  stop();
  expect(invoke).toHaveBeenCalledTimes(1);
  replacement();
  expect(invoke).toHaveBeenLastCalledWith("pty_output_flow", { id: "flow", enabled: false });
});

it("acknowledges the highest consumed sequence cumulatively and flushes at 16 chunks", async () => {
  vi.useFakeTimers();
  const callbacks = new Map<string, (event: { payload: unknown }) => void>();
  listen.mockImplementation(async (name, callback) => {
    callbacks.set(name, callback);
    return vi.fn();
  });
  invoke.mockResolvedValue(undefined);
  const { subscribePty, readyPtyBridge } = await import("./pty");
  const done: (() => void)[] = [];
  const stop = subscribePty("batch", (_data, finish) => void done.push(finish), vi.fn(), true);
  await readyPtyBridge();
  for (let sequence = 1; sequence <= 18; sequence++)
    callbacks.get("pty-data")!({
      payload: { id: "batch", data: btoa("x"), flow: { generation: 3, sequence } },
    });
  // The highest consumed sequence is acknowledged: the backend drains everything up to it, so
  // an earlier chunk whose callback never runs cannot hold back the later acknowledgements.
  done[1]();
  await vi.advanceTimersByTimeAsync(64);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_output_ack", {
    id: "batch",
    generation: 3,
    sequence: 2,
  });
  for (const finish of done.slice(2)) finish();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith("pty_output_ack", {
    id: "batch",
    generation: 3,
    sequence: 18,
  });
  stop();
});

it.each([0, 1])(
  "cleans partial listener setup and lets the next subscriber retry (failure=%s)",
  async (failed) => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const partialCleanup = vi.fn();
    const completeCleanup = [vi.fn(), vi.fn()];
    listen.mockImplementationOnce(() =>
      failed === 0 ? Promise.reject(new Error("offline")) : Promise.resolve(partialCleanup),
    );
    listen.mockImplementationOnce(() =>
      failed === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(partialCleanup),
    );
    const { subscribePty, readyPtyBridge } = await import("./pty");
    const first = subscribePty("first", vi.fn(), vi.fn());
    await expect(readyPtyBridge()).rejects.toThrow();
    expect(partialCleanup).toHaveBeenCalledOnce();
    listen.mockResolvedValueOnce(completeCleanup[0]).mockResolvedValueOnce(completeCleanup[1]);
    const second = subscribePty("second", vi.fn(), vi.fn());
    await readyPtyBridge();
    expect(listen).toHaveBeenCalledTimes(4);
    first();
    second();
    await vi.advanceTimersByTimeAsync(500);
    for (const cleanup of completeCleanup) expect(cleanup).toHaveBeenCalledOnce();
  },
);

it("waits for both listeners before spawning and receives immediate data and exit once", async () => {
  const registrations: (() => void)[] = [];
  const callbacks = new Map<string, (event: { payload: unknown }) => void>();
  listen.mockImplementation((name, callback) => {
    callbacks.set(name, callback);
    return new Promise<() => void>((resolve) => registrations.push(() => resolve(vi.fn())));
  });
  const { subscribePty, spawnPty } = await import("./pty");
  const data = vi.fn();
  const exit = vi.fn();
  const stop = subscribePty("early", data, exit);
  invoke.mockImplementation(async () => {
    callbacks.get("pty-data")!({ payload: { id: "early", data: btoa("hello") } });
    callbacks.get("pty-exit")!({ payload: { id: "early", code: 0 } });
  });
  const spawning = spawnPty("early", "/repo", 80, 24);
  await Promise.resolve();
  expect(invoke).not.toHaveBeenCalled();
  registrations[0]();
  await Promise.resolve();
  expect(invoke).not.toHaveBeenCalled();
  registrations[1]();
  await spawning;
  expect(invoke).toHaveBeenCalledOnce();
  expect(data).toHaveBeenCalledExactlyOnceWith(new TextEncoder().encode("hello"));
  expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  stop();
});

it("refuses an unobserved spawn after partial failure, retries and recreates after teardown", async () => {
  vi.useFakeTimers();
  const partial = vi.fn();
  listen.mockResolvedValueOnce(partial).mockRejectedValueOnce(new Error("registration failed"));
  const { subscribePty, spawnPty } = await import("./pty");
  const stop = subscribePty("retry", vi.fn(), vi.fn());
  await expect(spawnPty("retry", "/repo", 80, 24)).rejects.toThrow("event listeners");
  expect(invoke).not.toHaveBeenCalled();
  expect(partial).toHaveBeenCalledOnce();
  const cleanup = [vi.fn(), vi.fn()];
  listen.mockResolvedValueOnce(cleanup[0]).mockResolvedValueOnce(cleanup[1]);
  await spawnPty("retry", "/repo", 80, 24);
  expect(invoke).toHaveBeenCalledOnce();
  stop();
  await vi.advanceTimersByTimeAsync(500);
  cleanup.forEach((fn) => expect(fn).toHaveBeenCalledOnce());
  listen.mockResolvedValue(vi.fn());
  const next = subscribePty("next", vi.fn(), vi.fn());
  await spawnPty("next", "/repo", 80, 24);
  expect(listen).toHaveBeenCalledTimes(6);
  next();
  await vi.advanceTimersByTimeAsync(500);
});

it("registers both PTY events for the owning window and ignores foreign-target delivery", async () => {
  vi.useFakeTimers();
  const callbacks = new Map<
    string,
    { target: string; deliver: (event: { payload: unknown }) => void }
  >();
  listen.mockImplementation(async (name, deliver, options) => {
    callbacks.set(name, { target: options.target, deliver });
    return vi.fn();
  });
  invoke.mockResolvedValue(undefined);
  const { subscribePty, readyPtyBridge } = await import("./pty");
  const data = vi.fn();
  const stop = subscribePty("owned", data, vi.fn(), true);
  await readyPtyBridge();
  expect([...callbacks.values()].map((entry) => entry.target)).toEqual(["window-a", "window-a"]);
  const emit = (target: string) => {
    const listener = callbacks.get("pty-data")!;
    if (listener.target === target)
      listener.deliver({
        payload: { id: "owned", data: btoa("x"), flow: { generation: 1, sequence: 1 } },
      });
  };
  emit("window-b");
  expect(data).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalledWith("pty_output_ack", expect.anything());
  emit("window-a");
  expect(data).toHaveBeenCalledOnce();
  data.mock.calls[0][1]();
  await vi.advanceTimersByTimeAsync(32);
  expect(invoke).toHaveBeenCalledWith("pty_output_ack", {
    id: "owned",
    generation: 1,
    sequence: 1,
  });
  stop();
  await vi.advanceTimersByTimeAsync(500);
});

it("removes late registrations after teardown and suppresses their stale events", async () => {
  vi.useFakeTimers();
  invoke.mockResolvedValue(undefined);
  const callbacks: ((event: { payload: unknown }) => void)[] = [];
  const resolves: ((stop: () => void) => void)[] = [];
  const cleanup = [vi.fn(), vi.fn()];
  listen.mockImplementation((_name, callback) => {
    callbacks.push(callback);
    return new Promise((resolve) => resolves.push(resolve));
  });
  const { subscribePty } = await import("./pty");
  const data = vi.fn();
  const release = subscribePty("old", data, vi.fn(), true);
  release();
  await vi.advanceTimersByTimeAsync(500);
  resolves[0](cleanup[0]);
  resolves[1](cleanup[1]);
  await vi.runAllTimersAsync();
  cleanup.forEach((stop) => expect(stop).toHaveBeenCalledOnce());
  callbacks[0]({ payload: { id: "old", data: btoa("x"), flow: { generation: 2, sequence: 1 } } });
  expect(data).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalledWith("pty_output_ack", expect.anything());
});
