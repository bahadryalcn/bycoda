// @vitest-environment happy-dom
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDiagnosticsMode } from "./diagnosticsConsent";
import { createDiagnosticsScheduler } from "./diagnosticsScheduler";
import { CRASH, makeDeps } from "./testKit";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const flush = async () => {
  for (let i = 0; i < 80; i++) await vi.advanceTimersByTimeAsync(1);
};
let now = new Date("2026-11-09T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  now = new Date("2026-11-09T12:00:00Z");
  vi.stubGlobal("navigator", {}); // -- no Web Locks: the work runs directly and deterministically.
  // Real gzip streams finish outside fake time; the synchronous native fallback keeps sends deterministic.
  vi.stubGlobal("CompressionStream", undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Kit = ReturnType<typeof makeDeps>;
const gzipBase64 = async (text: string) => gzipSync(text).toString("base64");
const start = (kit: Kit) => {
  const native = { ...kit.deps.native, gzipBase64 };
  const scheduler = createDiagnosticsScheduler({ ...kit.deps, native, now: () => now });
  return { scheduler, stop: scheduler.start() };
};
const triggers = (kit: Kit, trigger: string) =>
  kit.sendDiagnosticReport.mock.calls.filter(
    (call) => (call[0].body as { trigger: string }).trigger === trigger,
  ).length;

describe("crash handling at start", () => {
  it("auto: sends the crash silently and clears the marker", async () => {
    setDiagnosticsMode("auto");
    const kit = makeDeps({ logs: { crash: CRASH } });
    const { scheduler, stop } = start(kit);
    await flush();
    expect(triggers(kit, "crash")).toBe(1);
    expect(kit.native.clearCrash).toHaveBeenCalled();
    expect(scheduler.getPending()).toBeNull();
    stop();
  });

  it("ask and undecided: exposes a pending crash, sends on answer", async () => {
    const kit = makeDeps({ logs: { crash: CRASH } });
    const { scheduler, stop } = start(kit);
    await flush();
    expect(scheduler.getPending()?.message).toContain("boom");
    expect(kit.sendDiagnosticReport).not.toHaveBeenCalled();
    expect(await scheduler.sendPending()).toBe("sent");
    expect(scheduler.getPending()).toBeNull();
    expect(kit.native.clearCrash).toHaveBeenCalled();
    stop();
  });

  it("ask: dismissing clears the marker without sending", async () => {
    const kit = makeDeps({ logs: { crash: CRASH } });
    const { scheduler, stop } = start(kit);
    await flush();
    await scheduler.dismissPending();
    expect(kit.native.clearCrash).toHaveBeenCalled();
    expect(kit.sendDiagnosticReport).not.toHaveBeenCalled();
    expect(scheduler.getPending()).toBeNull();
    stop();
  });

  it("off: discards the marker and sends nothing", async () => {
    setDiagnosticsMode("off");
    const kit = makeDeps({ logs: { crash: CRASH } });
    const { scheduler, stop } = start(kit);
    await flush();
    expect(kit.native.clearCrash).toHaveBeenCalled();
    expect(kit.sendDiagnosticReport).not.toHaveBeenCalled();
    expect(scheduler.getPending()).toBeNull();
    stop();
  });

  it("a render error newer than the reported one counts as a crash, once", async () => {
    localStorage.setItem(
      "bycoda.diagnostics.lastRenderError",
      JSON.stringify({
        message: "render failed",
        componentStack: "",
        at: "2026-11-09T11:00:00.000Z",
      }),
    );
    const kit = makeDeps();
    const first = start(kit);
    await flush();
    expect(first.scheduler.getPending()?.message).toBe("render failed");
    await first.scheduler.dismissPending();
    first.stop();
    const second = start(kit);
    await flush();
    expect(second.scheduler.getPending()).toBeNull();
    second.stop();
  });
});

describe("Host crash marker", () => {
  const HOST_CRASH = { ...CRASH, message: "host exploded", occurredAt: "2026-11-09T09:00:00.000Z" };

  it("is a pending crash on its own, summarized with a Host prefix, and clears the markers", async () => {
    const kit = makeDeps({ logs: { hostCrash: HOST_CRASH } });
    const { scheduler, stop } = start(kit);
    await flush();
    expect(scheduler.getPending()?.message).toBe("Host: host exploded");
    expect(await scheduler.sendPending()).toBe("sent");
    const body = kit.sendDiagnosticReport.mock.calls[0]![0].body as {
      trigger: string;
      summary: string;
    };
    expect(body.trigger).toBe("crash");
    expect(body.summary).toBe("Host: host exploded");
    expect(kit.native.clearCrash).toHaveBeenCalled();
    stop();
  });

  it("prefers the native crash message when both markers exist", async () => {
    const kit = makeDeps({ logs: { crash: CRASH, hostCrash: HOST_CRASH } });
    const { scheduler, stop } = start(kit);
    await flush();
    expect(scheduler.getPending()?.message).toContain("boom");
    stop();
  });

  it("auto mode sends it silently; off discards it", async () => {
    setDiagnosticsMode("auto");
    const auto = makeDeps({ logs: { hostCrash: HOST_CRASH } });
    start(auto).stop();
    await flush();
    expect(triggers(auto, "crash")).toBe(1);
    expect(auto.native.clearCrash).toHaveBeenCalled();

    setDiagnosticsMode("off");
    const off = makeDeps({ logs: { hostCrash: HOST_CRASH } });
    start(off).stop();
    await flush();
    expect(off.sendDiagnosticReport).not.toHaveBeenCalled();
    expect(off.native.clearCrash).toHaveBeenCalled();
  });

  it("dismissing clears it without sending", async () => {
    const kit = makeDeps({ logs: { hostCrash: HOST_CRASH } });
    const { scheduler, stop } = start(kit);
    await flush();
    await scheduler.dismissPending();
    expect(scheduler.getPending()).toBeNull();
    expect(kit.sendDiagnosticReport).not.toHaveBeenCalled();
    expect(kit.native.clearCrash).toHaveBeenCalled();
    stop();
  });
});

describe("periodic reports", () => {
  it("sends only in auto mode, then waits seven days", async () => {
    setDiagnosticsMode("ask");
    const asking = makeDeps();
    start(asking).stop();
    await flush();
    expect(triggers(asking, "periodic")).toBe(0);

    setDiagnosticsMode("auto");
    const kit = makeDeps();
    const { stop } = start(kit);
    await flush();
    expect(triggers(kit, "periodic")).toBe(1);
    now = new Date(now.getTime() + 6 * DAY);
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    await flush();
    expect(triggers(kit, "periodic")).toBe(1);
    now = new Date(now.getTime() + 2 * DAY);
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    await flush();
    expect(triggers(kit, "periodic")).toBe(2);
    stop();
  });

  it("a failed periodic send is retried at the next check", async () => {
    setDiagnosticsMode("auto");
    const kit = makeDeps();
    kit.sendDiagnosticReport.mockRejectedValueOnce(new Error("offline"));
    const { stop } = start(kit);
    await flush();
    expect(triggers(kit, "periodic")).toBe(1);
    await vi.advanceTimersByTimeAsync(3 * HOUR);
    await flush();
    expect(triggers(kit, "periodic")).toBe(2);
    stop();
  });

  it("does nothing outside the desktop shell", async () => {
    setDiagnosticsMode("auto");
    const kit = makeDeps();
    kit.native.available = false;
    start(kit).stop();
    await flush();
    expect(kit.sendDiagnosticReport).not.toHaveBeenCalled();
  });
});

describe("several windows", () => {
  it("a window that does not get the lock sends nothing", async () => {
    setDiagnosticsMode("auto");
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_name: string, _o: unknown, run: (l: null) => unknown) => run(null),
      },
    });
    const kit = makeDeps({ logs: { crash: CRASH } });
    start(kit).stop();
    await flush();
    expect(kit.sendDiagnosticReport).not.toHaveBeenCalled();
    expect(kit.native.clearCrash).not.toHaveBeenCalled();
  });
});
