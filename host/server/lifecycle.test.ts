import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as hostLog from "../diagnostics/logger";
import { BOOT_OPTIONAL_READY_MS } from "./boot-phases";
import { armShutdownDeadline, createLifecycleRuntime, shutdownExitCode } from "./lifecycle";

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

  it("stops the decision-model servers on shutdown and names a stalled stop", async () => {
    const stopped = vi.fn(async () => undefined);
    const runtime = await createLifecycleRuntime(
      dependenciesWith({ decisionModels: { close: stopped } }) as never,
      () => undefined,
    );
    await runtime.closeResources();
    expect(stopped).toHaveBeenCalledTimes(1);

    const stalled = await createLifecycleRuntime(
      dependenciesWith({
        decisionModels: { close: () => new Promise<void>(() => undefined) },
      }) as never,
      () => undefined,
    );
    const closing = stalled.closeResources();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closing.pendingDrains()).toEqual(["decisionModels"]);
  });

  it("settles with no pending drains when everything closes", async () => {
    const runtime = await createLifecycleRuntime(dependenciesWith({}) as never, () => undefined);
    const closing = runtime.closeResources();
    await closing;
    expect(closing.pendingDrains()).toEqual([]);
  });

  it("waits for Assistant room commands to close on shutdown (#1099)", async () => {
    let finish!: () => void;
    const commandsClosed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const close = vi.fn(() => commandsClosed);
    const runtime = await createLifecycleRuntime(
      dependenciesWith({ roomFiles: { folders: { close } } }) as never,
      () => undefined,
    );
    const closing = runtime.closeResources();
    try {
      await vi.waitFor(() => expect(closing.pendingDrains()).toEqual(["assistantCommands"]));
      expect(close).toHaveBeenCalledOnce();
    } finally {
      finish();
      await closing;
    }
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

describe("shutdownExitCode", () => {
  it("keeps a requested stop from being restarted by the service supervisor", () => {
    expect(shutdownExitCode("lifecycle", false)).toBe(0);
    // A supervisor restarts any non-zero exit; a failed drain must not undo the stop.
    expect(shutdownExitCode("lifecycle", true)).toBe(0);
  });

  it("exits non-zero after a database worker failure so the supervisor restarts the Host", () => {
    expect(shutdownExitCode("database-failed", false)).toBe(1);
  });

  it("reports a failed drain after a signal", () => {
    expect(shutdownExitCode("SIGTERM", true)).toBe(1);
    expect(shutdownExitCode("SIGINT", true)).toBe(1);
    expect(shutdownExitCode("SIGTERM", false)).toBe(0);
  });
});

describe("host boot recovery", () => {
  it("logs bounded background startup failure fields without the raw message (#424)", async () => {
    const warn = vi.fn();
    const logger = hostLog.createLogger("host.startup");
    const logging = vi.spyOn(hostLog, "createLogger").mockReturnValue({ ...logger, warn });
    const error = Object.assign(new Error("private startup path"), {
      code: "E".repeat(100),
      syscall: "open",
    });
    const server = new EventEmitter();
    const runtime = await createLifecycleRuntime(
      dependenciesWith({
        server,
        tunnels: {
          boot: async () => {
            throw error;
          },
          close: async () => undefined,
        },
      }) as never,
      () => undefined,
    );
    try {
      server.emit("listening");
      await runtime.startup;
      expect(warn).toHaveBeenCalledWith('Host background startup step "automatic-tunnel" failed.', {
        step: "automatic-tunnel",
        error: "Error",
        code: "E".repeat(64),
        syscall: "open",
        fingerprint: expect.stringMatching(/^[a-f\d]{12}$/),
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(error.message);
    } finally {
      logging.mockRestore();
      await runtime.closeResources();
    }
  });

  it("does not hold start-up behind a wedged optional service", async () => {
    vi.useFakeTimers();
    const wedged = new Promise<void>(() => undefined);
    const runtime = createLifecycleRuntime(
      dependenciesWith({
        social: { ready: wedged, dispose: () => undefined, stop: () => undefined },
        socialPeers: { ready: Promise.resolve() },
        providerInbox: { ready: wedged },
      }) as never,
      () => undefined,
    );
    let booted = false;
    void runtime.then(() => {
      booted = true;
    });
    await vi.advanceTimersByTimeAsync(BOOT_OPTIONAL_READY_MS - 1);
    expect(booted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(booted).toBe(true);
  });
});
