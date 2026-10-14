import { afterEach, expect, it, vi } from "vitest";

const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  listen.mockReset();
  vi.resetModules();
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
