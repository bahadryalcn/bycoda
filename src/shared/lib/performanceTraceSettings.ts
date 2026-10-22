import { configurePerformanceTracing } from "./performanceTrace";
import { startLongTaskRecording, stopLongTaskRecording } from "./performanceLongTasks";
import { storedFlag } from "./storedSetting";

/**
 * Persisted opt-in for local performance diagnostics. Read synchronously so
 * the startup span can be recorded. Uses the same storage helper as the
 * settings flags in features/settings/model/storageFlags.ts.
 */
export const PERFORMANCE_TRACE_KEY = "bycoda.performanceTrace";
export const PERFORMANCE_TRACE_DEFAULT = false;

const flag = storedFlag(PERFORMANCE_TRACE_KEY, null);

export function loadPerformanceTraceEnabled(): boolean {
  return flag.load() ?? PERFORMANCE_TRACE_DEFAULT;
}

export function applyPerformanceTraceEnabled(enabled: boolean): void {
  configurePerformanceTracing({ enabled });
  if (enabled) startLongTaskRecording();
  else stopLongTaskRecording();
}

/** Call once before the startup span so the first boot is captured when enabled. */
export function initPerformanceTracing(): void {
  applyPerformanceTraceEnabled(loadPerformanceTraceEnabled());
}

export function savePerformanceTraceEnabled(enabled: boolean): void {
  flag.save(enabled);
  applyPerformanceTraceEnabled(enabled);
}
