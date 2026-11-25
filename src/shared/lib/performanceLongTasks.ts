import {
  recordPerformanceInterval,
  type PerformanceMetrics,
  type PerformanceStage,
} from "./performanceTrace";

/**
 * Records long main-thread work as numeric durations only. Entry names, script URLs,
 * attribution containers and script identifiers are never collected.
 */
const OBSERVED: readonly { entryType: string; stage: PerformanceStage }[] = [
  { entryType: "longtask", stage: "long-task" },
  { entryType: "long-animation-frame", stage: "long-animation-frame" },
];

let observers: PerformanceObserver[] = [];

function frameMetrics(entry: PerformanceEntry): PerformanceMetrics {
  const frame = entry as PerformanceEntry & {
    blockingDuration?: number;
    styleAndLayoutStart?: number;
    scripts?: { duration: number }[];
  };
  const metrics: PerformanceMetrics = {};
  if (frame.blockingDuration !== undefined) metrics.blockingMs = frame.blockingDuration;
  if (frame.styleAndLayoutStart && frame.styleAndLayoutStart >= frame.startTime)
    metrics.styleAndLayoutMs = Math.max(
      0,
      frame.startTime + frame.duration - frame.styleAndLayoutStart,
    );
  if (frame.scripts?.every((script) => Number.isFinite(script.duration)))
    metrics.scriptMs = frame.scripts.reduce((total, script) => total + script.duration, 0);
  return metrics;
}

export function startLongTaskRecording(): void {
  if (observers.length > 0 || typeof PerformanceObserver === "undefined") return;
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  for (const { entryType, stage } of OBSERVED) {
    if (!supported.includes(entryType)) continue;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          recordPerformanceInterval(
            stage,
            entry.startTime,
            entry.duration,
            stage === "long-animation-frame" ? frameMetrics(entry) : undefined,
          );
      });
      observer.observe({ type: entryType, buffered: false });
      observers.push(observer);
    } catch {
      // Unsupported observer options in this WebView: diagnostics stay off for this type.
    }
  }
}

export function stopLongTaskRecording(): void {
  for (const observer of observers) observer.disconnect();
  observers = [];
}
