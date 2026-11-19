import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_FOUND_TTL_MS,
  BRIDGE_LOOKUP_TIMEOUT_MS,
  BRIDGE_NEGATIVE_TTL_MS,
  createBridgeLookup,
} from "./bridgeLookup";

type Bridge = { command: string; generation: number; hub?: boolean };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Host bridge lookup", () => {
  it("answers null at the cap on a slow startup and serves the late answer to the next send", async () => {
    const answer = deferred<Bridge | null>();
    const fetch = vi.fn(() => answer.promise);
    const lookup = createBridgeLookup<Bridge>(fetch);

    const first = lookup("session");
    await vi.advanceTimersByTimeAsync(BRIDGE_LOOKUP_TIMEOUT_MS);
    expect(await first).toBeNull();

    // The slow lookup is still running; a second lookup shares it instead of asking again.
    const second = lookup("session");
    await vi.advanceTimersByTimeAsync(100);
    answer.resolve({ command: "node", generation: 1 });
    expect(await second).toEqual({ command: "node", generation: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);

    // Filled after the first send gave up, so the following send has the bridge at once.
    expect(await lookup("session")).toEqual({ command: "node", generation: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not treat a slow answer as a definite miss", async () => {
    const answer = deferred<Bridge | null>();
    const fetch = vi.fn(() => answer.promise);
    const lookup = createBridgeLookup<Bridge>(fetch);

    const first = lookup("session");
    await vi.advanceTimersByTimeAsync(BRIDGE_LOOKUP_TIMEOUT_MS);
    expect(await first).toBeNull();
    answer.resolve({ command: "node", generation: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(await lookup("session")).toEqual({ command: "node", generation: 1 });
  });

  it("asks a Host that was still starting again after a short pause", async () => {
    const fetch = vi
      .fn<(id: string) => Promise<Bridge | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ command: "node", generation: 1 });
    const lookup = createBridgeLookup<Bridge>(fetch);

    expect(await lookup("session")).toBeNull();
    expect(await lookup("session")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BRIDGE_NEGATIVE_TTL_MS + 1);
    expect(await lookup("session")).toEqual({ command: "node", generation: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats a rejected lookup like an empty answer and recovers on the next ask", async () => {
    const fetch = vi
      .fn<(id: string) => Promise<Bridge | null>>()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ command: "node", generation: 1 });
    const lookup = createBridgeLookup<Bridge>(fetch);

    expect(await lookup("session")).toBeNull();
    await vi.advanceTimersByTimeAsync(BRIDGE_NEGATIVE_TTL_MS + 1);
    expect(await lookup("session")).toEqual({ command: "node", generation: 1 });
  });

  it("never serves an answer from before a Host restart once its TTL passed", async () => {
    const fetch = vi
      .fn<(id: string) => Promise<Bridge | null>>()
      .mockResolvedValueOnce({ command: "old-host", generation: 1 })
      .mockResolvedValueOnce({ command: "new-host", generation: 2 });
    const lookup = createBridgeLookup<Bridge>(fetch);

    expect((await lookup("session"))?.command).toBe("old-host");
    expect((await lookup("session"))?.command).toBe("old-host");
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BRIDGE_FOUND_TTL_MS + 1);
    expect((await lookup("session"))?.command).toBe("new-host");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not revive an older answer when the refresh after a restart fails", async () => {
    const fetch = vi
      .fn<(id: string) => Promise<Bridge | null>>()
      .mockResolvedValueOnce({ command: "old-host", generation: 1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ command: "new-host", generation: 2 });
    const lookup = createBridgeLookup<Bridge>(fetch);

    expect((await lookup("session"))?.command).toBe("old-host");
    await vi.advanceTimersByTimeAsync(BRIDGE_FOUND_TTL_MS + 1);
    // Host is down mid-restart: no bridge, and certainly not the old one.
    expect(await lookup("session")).toBeNull();
    expect(await lookup("session")).toBeNull();
    await vi.advanceTimersByTimeAsync(BRIDGE_NEGATIVE_TTL_MS + 1);
    expect((await lookup("session"))?.command).toBe("new-host");
  });

  it("does not revive a provisional answer when the refresh after a restart fails", async () => {
    const fetch = vi
      .fn<(id: string) => Promise<Bridge | null>>()
      .mockResolvedValueOnce({ command: "old-host", generation: 1, hub: false })
      .mockRejectedValueOnce(new Error("Host restarting"));
    const lookup = createBridgeLookup<Bridge>(fetch, undefined, undefined, (bridge) =>
      Boolean(bridge.hub),
    );

    expect((await lookup("session"))?.command).toBe("old-host");
    await vi.advanceTimersByTimeAsync(BRIDGE_NEGATIVE_TTL_MS + 1);
    expect(await lookup("session")).toBeNull();
    expect(await lookup("session")).toBeNull();
  });

  it("drops an answer that was already older than its TTL when a slow Host delivered it", async () => {
    const slow = deferred<Bridge | null>();
    const fetch = vi
      .fn<(id: string) => Promise<Bridge | null>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ command: "new-host", generation: 2 });
    const lookup = createBridgeLookup<Bridge>(fetch);

    const first = lookup("session");
    await vi.advanceTimersByTimeAsync(BRIDGE_FOUND_TTL_MS + 1);
    expect(await first).toBeNull();
    slow.resolve({ command: "old-host", generation: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect((await lookup("session"))?.command).toBe("new-host");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps every session's answer, failure and timing separate", async () => {
    const fetch = vi.fn(async (id: string): Promise<Bridge | null> => {
      if (id === "down") throw new Error("Offline");
      return { command: id, generation: 1 };
    });
    const lookup = createBridgeLookup<Bridge>(fetch);

    expect((await lookup("one"))?.command).toBe("one");
    expect(await lookup("down")).toBeNull();
    expect((await lookup("two"))?.command).toBe("two");
    expect((await lookup("one"))?.command).toBe("one");
    expect(fetch.mock.calls.map(([id]) => id)).toEqual(["one", "down", "two"]);

    await vi.advanceTimersByTimeAsync(BRIDGE_NEGATIVE_TTL_MS + 1);
    expect(await lookup("down")).toBeNull();
    expect(fetch.mock.calls.filter(([id]) => id === "down")).toHaveLength(2);
    // "one" is still inside its own TTL and was not refetched by the other sessions' traffic.
    expect(fetch.mock.calls.filter(([id]) => id === "one")).toHaveLength(1);
  });

  it("shares one Host question between concurrent lookups of a session", async () => {
    const answer = deferred<Bridge | null>();
    const fetch = vi.fn(() => answer.promise);
    const lookup = createBridgeLookup<Bridge>(fetch);

    const both = Promise.all([lookup("session"), lookup("session")]);
    answer.resolve({ command: "node", generation: 1 });
    expect(await both).toEqual([
      { command: "node", generation: 1 },
      { command: "node", generation: 1 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
