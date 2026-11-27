import { performance as nodePerformance } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import {
  currentRequestTrace,
  heldPollWaitMs,
  runWithRequestTrace,
  slowRequestFields,
  startRequestTrace,
  startRuntimeSampler,
  stopRuntimeSampler,
  traceDbWait,
  traceWriterHold,
} from "./request-trace";
import { PerfMetrics } from "./perf-metrics";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const clockAt = (start = 1_000) => {
  let now = start;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return (ms: number) => (now += ms);
};

it("uses the Host's capped wait instead of the requested long-poll wait", () => {
  expect(heldPollWaitMs("sessions.sync", { waitMs: 30_000 })).toBe(10_000);
  expect(heldPollWaitMs("machine.changes", { waitMs: 4_000 })).toBe(4_000);
  expect(heldPollWaitMs("machine.changes", { waitMs: "soon" })).toBe(0);
  expect(heldPollWaitMs("native.services.conversation.desktop.take", { waitMs: 12_000 })).toBe(
    12_000,
  );
  expect(heldPollWaitMs("projects.list", { waitMs: 30_000 })).toBe(0);
  expect(heldPollWaitMs("constructor", { waitMs: 30_000 })).toBe(0);
});

it("separates admission, handler, response and database wait of one request", () => {
  const advance = clockAt();
  const trace = startRequestTrace("ws");
  advance(40);
  trace.handlerStartedAt = performance.now();
  runWithRequestTrace(trace, () => {
    const writer = traceDbWait("writer");
    advance(300);
    writer?.();
    writer?.();
    const read = traceDbWait("read");
    advance(20);
    read?.();
  });
  advance(5);
  trace.handlerEndedAt = performance.now();
  advance(7);
  trace.responseEndedAt = performance.now();
  trace.outcome = "sent";
  // Cleanup after the frame was accepted is not response time.
  advance(100);
  expect(slowRequestFields(trace, { thresholdMs: 5_000, heldWaitMs: 0 })).toMatchObject({
    traceId: trace.id,
    transport: "ws",
    outcome: "sent",
    totalMs: 472,
    admissionMs: 40,
    handlerMs: 325,
    responseMs: 7,
    writerScopes: 1,
    writerWaitMs: 300,
    writerWaitMaxMs: 300,
    readScopes: 1,
    readWaitMs: 20,
    heldWaitMs: 0,
    thresholdMs: 5_000,
  });
});

it("reports a wait still open and a handler that never reached dispatch", () => {
  const advance = clockAt();
  const trace = startRequestTrace("http");
  runWithRequestTrace(trace, () => void traceDbWait("writer"));
  advance(6_000);
  const fields = slowRequestFields(trace, { thresholdMs: 2_000, heldWaitMs: 0 });
  expect(fields).toMatchObject({ admissionMs: 6_000, writerWaitMs: 0, writerWaitingMs: 6_000 });
  expect(fields).not.toHaveProperty("handlerMs");
  expect(fields).not.toHaveProperty("responseMs");
});

it("aggregates writer ownership, including one still open at report time", () => {
  const advance = clockAt();
  const trace = startRequestTrace("http");
  const closed = { guardMs: 1, workerMs: 20, roundTripMs: 30, commitMs: 5, requests: 3 };
  const end = traceWriterHold(trace, closed);
  advance(100);
  end();
  end();
  const open = { guardMs: 2, workerMs: 40, roundTripMs: 50, commitMs: 0, requests: 2 };
  traceWriterHold(trace, open);
  advance(60);
  expect(slowRequestFields(trace, { thresholdMs: 2_000, heldWaitMs: 0 })).toMatchObject({
    writerHeldMs: 160,
    writerHoldingMs: 60,
    writerGuardMs: 3,
    writerWorkerMs: 60,
    writerRoundTripMs: 80,
    writerCommitMs: 5,
    writerRequests: 5,
  });
});

it("marks a handler still running and gives it no response time", () => {
  const advance = clockAt();
  const trace = startRequestTrace("ws");
  trace.handlerStartedAt = performance.now();
  trace.outcome = "deadline";
  advance(5_100);
  const fields = slowRequestFields(trace, { thresholdMs: 5_000, heldWaitMs: 0 });
  expect(fields).toMatchObject({ outcome: "deadline", handlerMs: 5_100, handlerRunning: "yes" });
  expect(fields).not.toHaveProperty("responseMs");
});

it("labels the loop maximum as global and leaves the shared window to its reader", async () => {
  const metrics = new PerfMetrics();
  metrics.start();
  try {
    const until = performance.now() + 80;
    while (performance.now() < until);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const window = metrics.recentLoopWindow();
    expect(window?.maxMs).toBeGreaterThan(0);
    const real = performance.now();
    const now = vi.spyOn(performance, "now").mockReturnValue(real + 11_000);
    expect(metrics.recentLoopWindow()?.ageMs).toBeGreaterThanOrEqual(11_000);
    // Past the window a resetting read would clear it; this one must not.
    expect(metrics.recentLoopWindow()?.maxMs).toBe(window?.maxMs);
    now.mockRestore();
    expect(metrics.recentLoopMaxMs()).toBe(window?.maxMs);
  } finally {
    metrics.close();
  }
  const fields = slowRequestFields(startRequestTrace("ws"), { thresholdMs: 1, heldWaitMs: 0 });
  expect(fields).not.toHaveProperty("loopMaxRecentMs");
});

it("survives a runtime whose CPU readings throw", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const target = process as unknown as { threadCpuUsage?: () => unknown };
  const original = target.threadCpuUsage;
  target.threadCpuUsage = () => {
    throw new Error("thread CPU unavailable");
  };
  try {
    startRuntimeSampler();
    expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
    const cpu = vi.spyOn(process, "cpuUsage").mockImplementation(() => {
      throw new Error("process CPU unavailable");
    });
    expect(() => vi.advanceTimersByTime(2_000)).not.toThrow();
    const trace = startRequestTrace("ws", performance.now() - 1_000);
    expect(() => slowRequestFields(trace, { thresholdMs: 1, heldWaitMs: 0 })).not.toThrow();
    cpu.mockRestore();
    expect(slowRequestFields(trace, { thresholdMs: 1, heldWaitMs: 0 })).not.toHaveProperty(
      "mainCpuPct",
    );
  } finally {
    stopRuntimeSampler();
    target.threadCpuUsage = original;
  }
});

it("keeps concurrent requests' stages apart across awaits", async () => {
  const first = startRequestTrace("ws");
  const second = startRequestTrace("ws");
  const run = (trace: typeof first) =>
    runWithRequestTrace(trace, async () => {
      const end = traceDbWait("writer");
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentRequestTrace()).toBe(trace);
      end?.();
    });
  await Promise.all([run(first), run(second), run(first)]);
  expect(first.writer.scopes).toBe(2);
  expect(second.writer.scopes).toBe(1);
  expect(first.id).not.toBe(second.id);
  expect(traceDbWait("writer")).toBeUndefined();
});

it("reads runtime counters only on the sampler tick and on a slow report", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const loop = vi.spyOn(nodePerformance, "eventLoopUtilization");
  startRuntimeSampler();
  try {
    const initial = loop.mock.calls.length;
    for (let index = 0; index < 1_000; index++) {
      const trace = startRequestTrace("ws");
      runWithRequestTrace(trace, () => traceDbWait("writer")?.());
    }
    expect(loop.mock.calls.length).toBe(initial);
    vi.advanceTimersByTime(3_000);
    expect(loop.mock.calls.length).toBe(initial + 3);
  } finally {
    stopRuntimeSampler();
  }
  const stopped = loop.mock.calls.length;
  vi.advanceTimersByTime(3_000);
  expect(loop.mock.calls.length).toBe(stopped);
});

it("reports main-thread and process load over the sampled window", async () => {
  const trace = startRequestTrace("http");
  startRuntimeSampler();
  try {
    const until = performance.now() + 300;
    while (performance.now() < until);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const fields = slowRequestFields(trace, { thresholdMs: 2_000, heldWaitMs: 0 });
    expect(fields.runtimeWindowMs).toBeGreaterThanOrEqual(250);
    expect(fields.loopUtilizationPct).toBeGreaterThan(50);
    expect(fields.processCpuPct).toBeGreaterThan(0);
    if (typeof process.threadCpuUsage === "function") expect(fields.mainCpuPct).toBeGreaterThan(0);
  } finally {
    stopRuntimeSampler();
  }
});

it("never carries request content into its fields", () => {
  const trace = startRequestTrace("ws");
  const encoded = JSON.stringify(
    runWithRequestTrace(trace, () =>
      slowRequestFields(trace, {
        thresholdMs: heldPollWaitMs("sessions.sync", { waitMs: 1, token: "private-token" }),
        heldWaitMs: 1,
      }),
    ),
  );
  expect(encoded).not.toContain("private-token");
  expect(Object.keys(JSON.parse(encoded))).not.toContain("params");
});
