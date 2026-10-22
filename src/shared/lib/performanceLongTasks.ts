import { recordPerformanceInterval, type PerformanceStage } from "./performanceTrace";

/**
 * Records long main-thread work as durations only. Entry names, script URLs,
 * attribution containers and frame scripts are deliberately never read.
 */
const OBSERVED: readonly { entryType: string; stage: PerformanceStage }[] = [
  { entryType: "longtask", stage: "long-task" },
  { entryType: "long-animation-frame", stage: "long-animation-frame" },
];

let observers: PerformanceObserver[] = [];

export function startLongTaskRecording(): void {
  if (observers.length > 0 || typeof PerformanceObserver === "undefined") return;
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  for (const { entryType, stage } of OBSERVED) {
    if (!supported.includes(entryType)) continue;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          recordPerformanceInterval(stage, entry.startTime, entry.duration);
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
