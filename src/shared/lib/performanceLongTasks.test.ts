import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPerformanceTrace,
  configurePerformanceTracing,
  getPerformanceTrace,
} from "./performanceTrace";
import { startLongTaskRecording, stopLongTaskRecording } from "./performanceLongTasks";

type Callback = (list: { getEntries: () => unknown[] }) => void;

class FakePerformanceObserver {
  static supportedEntryTypes: string[] = ["longtask", "long-animation-frame"];
  static instances: FakePerformanceObserver[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(public callback: Callback) {
    FakePerformanceObserver.instances.push(this);
  }
  observe(options: unknown) {
    this.observed.push(options);
  }
  disconnect() {
    this.disconnected = true;
  }
}

describe("long task recording", () => {
  beforeEach(() => {
    FakePerformanceObserver.supportedEntryTypes = ["longtask", "long-animation-frame"];
    FakePerformanceObserver.instances = [];
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    clearPerformanceTrace();
    configurePerformanceTracing({ enabled: true });
  });

  afterEach(() => {
    stopLongTaskRecording();
    configurePerformanceTracing({ enabled: false });
    clearPerformanceTrace();
    vi.unstubAllGlobals();
  });

  it("records only start time and duration, never names, URLs or attribution", () => {
    startLongTaskRecording();
    const [longTasks] = FakePerformanceObserver.instances;
    longTasks.callback({
      getEntries: () => [
        {
          name: "self",
          startTime: 12.5,
          duration: 80,
          attribution: [{ containerSrc: "https://private.example/app.js" }],
        },
      ],
    });

    expect(getPerformanceTrace()).toEqual([
      { stage: "long-task", at: 12.5, duration: 80, metrics: {} },
    ]);
    expect(JSON.stringify(getPerformanceTrace())).not.toContain("private.example");
  });

  it("records long animation frames under their own stage", () => {
    startLongTaskRecording();
    const frames = FakePerformanceObserver.instances[1];
    frames.callback({
      getEntries: () => [{ startTime: 40, duration: 120, scripts: [{ sourceURL: "x.js" }] }],
    });
    expect(getPerformanceTrace()).toEqual([
      { stage: "long-animation-frame", at: 40, duration: 120, metrics: {} },
    ]);
  });

  it("observes only entry types the runtime supports", () => {
    FakePerformanceObserver.supportedEntryTypes = ["longtask"];
    startLongTaskRecording();
    expect(FakePerformanceObserver.instances).toHaveLength(1);
    expect(FakePerformanceObserver.instances[0].observed).toEqual([
      { type: "longtask", buffered: false },
    ]);
  });

  it("does nothing when PerformanceObserver is unavailable", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    expect(() => startLongTaskRecording()).not.toThrow();
    expect(FakePerformanceObserver.instances).toHaveLength(0);
  });

  it("disconnects on stop and ignores entries when tracing is off", () => {
    startLongTaskRecording();
    const [longTasks] = FakePerformanceObserver.instances;
    stopLongTaskRecording();
    expect(longTasks.disconnected).toBe(true);

    configurePerformanceTracing({ enabled: false });
    startLongTaskRecording();
    FakePerformanceObserver.instances[2]?.callback({
      getEntries: () => [{ startTime: 1, duration: 60 }],
    });
    expect(getPerformanceTrace()).toEqual([]);
  });

  it("drops non-finite durations", () => {
    startLongTaskRecording();
    FakePerformanceObserver.instances[0].callback({
      getEntries: () => [{ startTime: Number.NaN, duration: 50 }],
    });
    expect(getPerformanceTrace()).toEqual([]);
  });
});
