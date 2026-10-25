import { afterEach, expect, it, vi } from "vitest";

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
    const { subscribePty } = await import("./pty");
    const first = subscribePty("first", vi.fn(), vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(partialCleanup).toHaveBeenCalledOnce();
    listen.mockResolvedValueOnce(completeCleanup[0]).mockResolvedValueOnce(completeCleanup[1]);
    const second = subscribePty("second", vi.fn(), vi.fn());
    await Promise.resolve();
    await Promise.resolve();
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
