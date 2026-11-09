import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { armShutdownDeadline, createLifecycleRuntime } from "./lifecycle";

vi.mock("../assistant/observations/assistant-observation-producers", () => ({
  installAssistantObservationProducers: async () => undefined,
}));

// Every dependency is an inert callable; individual drains are overridden.
const inert = (): any =>
  new Proxy(() => undefined, {
    get: (_target, key) => (key === "then" || typeof key === "symbol" ? undefined : inert()),
    apply: () => undefined,
  });

const dependenciesWith = (overrides: Record<string, unknown>) => {
  const base: Record<string, unknown> = {
    server: new EventEmitter(),
    closing: false,
    requests: [],
    ...overrides,
    engine: { store: { db: { outsideScope: (action: () => unknown) => action() } } },
  };
  return new Proxy(base, {
    get: (target, key: string) => (key in target ? target[key] : inert()),
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  });
};

afterEach(() => vi.useRealTimers());

describe("host shutdown drains", () => {
  it("reports a drain that never settles by name", async () => {
    const stalled = new Promise<void>(() => undefined);
    const runtime = await createLifecycleRuntime(
      dependenciesWith({
        websocket: { close: () => undefined },
        tunnels: { close: () => stalled },
      }) as never,
      () => undefined,
    );
    const closing = runtime.closeResources();
    const outcome = await Promise.race([
      closing.then(() => "closed"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
    ]);
    expect(outcome).toBe("pending");
    expect(closing.pendingDrains()).toEqual(["tunnels"]);
  });

  it("settles with no pending drains when everything closes", async () => {
    const runtime = await createLifecycleRuntime(dependenciesWith({}) as never, () => undefined);
    const closing = runtime.closeResources();
    await closing;
    expect(closing.pendingDrains()).toEqual([]);
  });
});

describe("armShutdownDeadline", () => {
  it("logs the pending steps and exits 1 when the drain never finishes", () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const log = vi.fn();
    armShutdownDeadline(() => ["server resources", "tunnels"], { ms: 45_000, exit, log });
    vi.advanceTimersByTime(44_999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(log).toHaveBeenCalledWith(
      "Host shutdown exceeded 45s; forcing exit. Pending: server resources, tunnels.",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does nothing once disarmed", () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const disarm = armShutdownDeadline(() => [], { ms: 10, exit, log: vi.fn() });
    disarm();
    vi.advanceTimersByTime(100);
    expect(exit).not.toHaveBeenCalled();
  });
});
