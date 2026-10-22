import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPerformanceTrace,
  configurePerformanceTracing,
  getPerformanceTrace,
} from "../../shared/lib/performanceTrace";
import {
  beginWindowMoveTiming,
  cancelWindowMoveTiming,
  readWindowMoveTimings,
} from "./windowMoveTiming";

beforeEach(() => {
  clearPerformanceTrace();
  configurePerformanceTracing({ enabled: true, capacity: 100 });
});
afterEach(() => {
  configurePerformanceTracing({ enabled: false });
  vi.restoreAllMocks();
});

describe("window movement diagnostics", () => {
  it("attributes a five-minute deferral separately from native startup without logging content", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const trace = beginWindowMoveTiming(["private-session-path"]);
    trace.stage("queued");
    now = 300_000;
    expect(beginWindowMoveTiming(["private-session-path"])).toBe(trace);
    trace.stage("preparing");
    now += 10;
    trace.stage("native-start");
    now += 200;
    trace.stage("native-ready");
    trace.finish("transferred");
    const entries = readWindowMoveTimings().slice(-6);
    expect(entries.find((entry) => entry.stage === "preparing")?.stageMs).toBe(300_000);
    expect(entries.find((entry) => entry.stage === "native-ready")?.stageMs).toBe(200);
    expect(JSON.stringify(getPerformanceTrace())).not.toContain("private-session-path");
  });

  it("ends cancelled requests and bounds diagnostic history", () => {
    const prior = beginWindowMoveTiming(["cancelled"]);
    cancelWindowMoveTiming(["cancelled"]);
    prior.stage("native-ready");
    expect(readWindowMoveTimings().at(-1)?.stage).toBe("cancelled");
    const retry = beginWindowMoveTiming(["cancelled"]);
    expect(retry).not.toBe(prior);
    retry.finish("failed");
    for (let index = 0; index < 110; index++)
      beginWindowMoveTiming([String(index)]).finish("relocated");
    expect(readWindowMoveTimings()).toHaveLength(100);
    const snapshot = readWindowMoveTimings();
    snapshot[0].stageMs = -1;
    expect(readWindowMoveTimings()[0].stageMs).not.toBe(-1);
  });

  it("does not collect movement diagnostics unless shared tracing is enabled", () => {
    configurePerformanceTracing({ enabled: false });
    const trace = beginWindowMoveTiming(["private"]);
    trace.stage("preparing");
    trace.finish("transferred");
    expect(readWindowMoveTimings()).toEqual([]);
  });
});
