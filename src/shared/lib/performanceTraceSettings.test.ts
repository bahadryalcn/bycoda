import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPerformanceTrace,
  getPerformanceTrace,
  isPerformanceTracingEnabled,
  recordPerformanceEvent,
} from "./performanceTrace";
import {
  PERFORMANCE_TRACE_KEY,
  applyPerformanceTraceEnabled,
  initPerformanceTracing,
  loadPerformanceTraceEnabled,
  savePerformanceTraceEnabled,
} from "./performanceTraceSettings";

class FakePerformanceObserver {
  static supportedEntryTypes = ["longtask"];
  static instances: FakePerformanceObserver[] = [];
  disconnected = false;
  constructor(public callback: (list: { getEntries: () => unknown[] }) => void) {
    FakePerformanceObserver.instances.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  };
}

describe("performance trace settings", () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    FakePerformanceObserver.instances = [];
    applyPerformanceTraceEnabled(false);
    clearPerformanceTrace();
  });

  afterEach(() => {
    applyPerformanceTraceEnabled(false);
    clearPerformanceTrace();
    vi.unstubAllGlobals();
  });

  it("defaults to off when nothing is stored", () => {
    expect(loadPerformanceTraceEnabled()).toBe(false);
  });

  it("reads a stored enabled flag synchronously", () => {
    storage.setItem(PERFORMANCE_TRACE_KEY, "1");
    expect(loadPerformanceTraceEnabled()).toBe(true);
  });

  it("falls back to the default when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadPerformanceTraceEnabled()).toBe(false);
  });

  it("initializes tracing and the long-task observer from the stored flag", () => {
    storage.setItem(PERFORMANCE_TRACE_KEY, "1");
    initPerformanceTracing();
    expect(isPerformanceTracingEnabled()).toBe(true);
    expect(FakePerformanceObserver.instances).toHaveLength(1);

    recordPerformanceEvent("startup", { elapsedMs: 5 });
    expect(getPerformanceTrace().map((record) => record.stage)).toEqual(["startup"]);
  });

  it("keeps tracing off and creates no observer when the flag is unset", () => {
    initPerformanceTracing();
    expect(isPerformanceTracingEnabled()).toBe(false);
    expect(FakePerformanceObserver.instances).toHaveLength(0);
  });

  it("persists the choice and starts or stops recording together", () => {
    savePerformanceTraceEnabled(true);
    expect(storage.getItem(PERFORMANCE_TRACE_KEY)).toBe("1");
    expect(isPerformanceTracingEnabled()).toBe(true);
    expect(FakePerformanceObserver.instances).toHaveLength(1);

    savePerformanceTraceEnabled(false);
    expect(storage.getItem(PERFORMANCE_TRACE_KEY)).toBe("0");
    expect(isPerformanceTracingEnabled()).toBe(false);
    expect(FakePerformanceObserver.instances[0].disconnected).toBe(true);
  });
});
