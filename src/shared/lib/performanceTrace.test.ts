import { describe, expect, it } from "vitest";
import {
  beginSessionPerformanceTrace,
  endSessionPerformanceTrace,
  sessionPerformanceTrace,
} from "./performanceTrace";
import {
  clearPerformanceTrace,
  configurePerformanceTracing,
  createPerformanceTraceId,
  getPerformanceTrace,
  recordPerformanceEvent,
  startPerformanceSpan,
} from "./performanceTrace";
describe("performance traces", () => {
  it("keeps remote decode units distinct from wire bytes", () => {
    clearPerformanceTrace();
    configurePerformanceTracing({ enabled: true });
    const end = startPerformanceSpan("remote-decode", { units: 12, payload: "private" } as never);
    end();
    expect(getPerformanceTrace()[0]?.metrics).toEqual({ units: 12 });
    configurePerformanceTracing({ enabled: false });
    clearPerformanceTrace();
  });
  it("keeps session correlation private, bounded and resettable", () => {
    configurePerformanceTracing({ enabled: false });
    expect(beginSessionPerformanceTrace("secret-key")).toBeUndefined();
    configurePerformanceTracing({ enabled: true });
    clearPerformanceTrace();
    const first = beginSessionPerformanceTrace("secret-key");
    recordPerformanceEvent("dispatch", {}, first);
    expect(JSON.stringify(getPerformanceTrace())).not.toContain("secret-key");
    const replacement = beginSessionPerformanceTrace("secret-key");
    endSessionPerformanceTrace("secret-key", first);
    expect(sessionPerformanceTrace("secret-key")).toBe(replacement);
    for (let index = 0; index < 128; index++) beginSessionPerformanceTrace(`session-${index}`);
    expect(sessionPerformanceTrace("secret-key")).toBeUndefined();
    clearPerformanceTrace();
    expect(sessionPerformanceTrace("session-127")).toBeUndefined();
    beginSessionPerformanceTrace("other");
    configurePerformanceTracing({ enabled: false });
    configurePerformanceTracing({ enabled: true });
    expect(sessionPerformanceTrace("other")).toBeUndefined();
    configurePerformanceTracing({ enabled: false });
  });
  it("is opt-in, bounded and exports copies with numeric metadata only", () => {
    clearPerformanceTrace();
    configurePerformanceTracing({ enabled: false });
    recordPerformanceEvent("dispatch");
    expect(getPerformanceTrace()).toEqual([]);
    configurePerformanceTracing({ enabled: true, capacity: 2 });
    const traceId = createPerformanceTraceId();
    recordPerformanceEvent(
      "dispatch",
      { bytes: 3, path: "secret", items: Infinity } as never,
      traceId,
    );
    const end = startPerformanceSpan("host-ack", undefined, traceId);
    end();
    end();
    const trace = getPerformanceTrace();
    expect(trace).toHaveLength(2);
    expect(trace[0].metrics).toEqual({ bytes: 3 });
    expect(trace[1].traceId).toBe(traceId);
    trace[0].metrics.bytes = 99;
    expect(getPerformanceTrace()[0].metrics.bytes).toBe(3);
    recordPerformanceEvent("first-paint", {}, "private-session-id");
    expect(getPerformanceTrace()).toHaveLength(2);
    expect(getPerformanceTrace()[1].traceId).toBeUndefined();
    configurePerformanceTracing({ enabled: false });
    clearPerformanceTrace();
  });
});
