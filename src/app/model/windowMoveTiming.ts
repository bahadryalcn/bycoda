import {
  createPerformanceTraceId,
  getPerformanceTrace,
  isPerformanceTracingEnabled,
  recordPerformanceEvent,
} from "../../shared/lib/performanceTrace";

type MoveStage =
  | "requested"
  | "queued"
  | "preparing"
  | "payload-ready"
  | "native-start"
  | "native-ready";
type MoveOutcome = "transferred" | "relocated" | "failed" | "cancelled";

export type WindowMoveTiming = {
  transferId: string;
  stage: MoveStage | MoveOutcome;
  elapsedMs: number;
  stageMs: number;
};

const LIMIT = 100;
const active = new Map<string, ReturnType<typeof createTrace>>();
const phases = [
  "requested",
  "queued",
  "preparing",
  "payload-ready",
  "native-start",
  "native-ready",
  "transferred",
  "relocated",
  "failed",
  "cancelled",
] as const;
const noopTrace = { stage: (_stage: MoveStage) => {}, finish: (_outcome: MoveOutcome) => {} };

function createTrace(key: string) {
  const transferId = createPerformanceTraceId();
  const started = performance.now();
  let previous = started;
  let ended = false;
  const record = (stage: WindowMoveTiming["stage"]) => {
    if (ended) return;
    const now = performance.now();
    const timing = {
      transferId,
      stage,
      elapsedMs: Math.round(now - started),
      stageMs: Math.round(now - previous),
    };
    previous = now;
    recordPerformanceEvent(
      "window-move",
      {
        phase: phases.indexOf(stage),
        elapsedMs: timing.elapsedMs,
        stageMs: timing.stageMs,
      },
      transferId,
    );
  };
  record("requested");
  return {
    stage: record,
    finish(outcome: MoveOutcome) {
      record(outcome);
      ended = true;
      if (active.get(key) === this) active.delete(key);
    },
  };
}

/** Reusing a queued request preserves its original wait duration. */
export function beginWindowMoveTiming(tabIds: readonly string[]) {
  if (!isPerformanceTracingEnabled()) {
    active.clear();
    return noopTrace;
  }
  const key = JSON.stringify([...tabIds].sort());
  const prior = active.get(key);
  if (prior) return prior;
  // Diagnostics cannot retain an unbounded number of abandoned requests.
  if (active.size >= LIMIT) active.delete(active.keys().next().value!);
  const trace = createTrace(key);
  active.set(key, trace);
  return trace;
}

export function cancelWindowMoveTiming(tabIds: readonly string[]) {
  active.get(JSON.stringify([...tabIds].sort()))?.finish("cancelled");
}

/** Bounded, content-free measurements for diagnostics and performance captures. */
export function readWindowMoveTimings(): readonly WindowMoveTiming[] {
  return getPerformanceTrace()
    .filter((record) => record.stage === "window-move")
    .map((record) => ({
      transferId: record.traceId!,
      stage: phases[record.metrics.phase!],
      elapsedMs: record.metrics.elapsedMs!,
      stageMs: record.metrics.stageMs!,
    }));
}
