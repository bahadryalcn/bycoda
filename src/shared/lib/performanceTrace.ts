/** Local opt-in diagnostics. Never accepts content, paths or application IDs. */
import { useSyncExternalStore } from "react";
export type PerformanceStage =
  | "window-move"
  | "startup"
  | "checkpoint"
  | "project-location"
  | "send-prepare"
  | "dispatch"
  | "host-ack"
  | "provider-first-event"
  | "renderer-receive"
  | "first-paint"
  | "last-paint"
  | "session-load"
  | "session-save"
  | "remote-sync"
  | "attachment-upload"
  | "attachment-preview"
  | "markdown-render"
  | "composer-resize"
  | "turn-grouping"
  | "remote-control"
  | "remote-list"
  | "remote-tail"
  | "remote-history"
  | "remote-decode"
  | "remote-apply"
  | "long-task"
  | "long-animation-frame";
export type PerformanceMetrics = Partial<
  Record<
    | "bytes"
    | "units"
    | "blocks"
    | "sessions"
    | "items"
    | "revision"
    | "backlog"
    | "cacheHit"
    | "phase"
    | "correlationId"
    | "checkpointWaitMs"
    | "gitMs"
    | "diskMs"
    | "scriptMs"
    | "styleAndLayoutMs"
    | "blockingMs"
    | "elapsedMs"
    | "stageMs",
    number
  >
>;
export type PerformanceTraceRecord = {
  stage: PerformanceStage;
  at: number;
  duration?: number;
  traceId?: string;
  metrics: PerformanceMetrics;
};
const metricKeys = new Set([
  "bytes",
  "units",
  "blocks",
  "sessions",
  "items",
  "revision",
  "backlog",
  "cacheHit",
  "phase",
  "correlationId",
  "checkpointWaitMs",
  "gitMs",
  "diskMs",
  "scriptMs",
  "styleAndLayoutMs",
  "blockingMs",
  "elapsedMs",
  "stageMs",
]);
const stages = new Set<string>([
  "window-move",
  "startup",
  "checkpoint",
  "project-location",
  "send-prepare",
  "dispatch",
  "host-ack",
  "provider-first-event",
  "renderer-receive",
  "first-paint",
  "last-paint",
  "session-load",
  "session-save",
  "remote-sync",
  "attachment-upload",
  "attachment-preview",
  "markdown-render",
  "composer-resize",
  "turn-grouping",
  "remote-control",
  "remote-list",
  "remote-tail",
  "remote-history",
  "remote-decode",
  "remote-apply",
  "long-task",
  "long-animation-frame",
]);
let enabled = false;
let capacity = 2048;
let records: PerformanceTraceRecord[] = [];
const slowFrames: PerformanceTraceRecord[] = [];
let sequence = 0;
const sessionTraces = new Map<string, string>();
const SESSION_TRACE_LIMIT = 128;
const traceListeners = new Set<() => void>();
function sessionTracesChanged(): void {
  for (const listener of traceListeners) listener();
}
function subscribeSessionPerformanceTraces(listener: () => void): () => void {
  traceListeners.add(listener);
  return () => {
    traceListeners.delete(listener);
  };
}
/** Raw session keys stay local and are never included in exported records. */
export function beginSessionPerformanceTrace(sessionId: string): string | undefined {
  if (!enabled) return undefined;
  const traceId = createPerformanceTraceId();
  sessionTraces.delete(sessionId);
  sessionTraces.set(sessionId, traceId);
  while (sessionTraces.size > SESSION_TRACE_LIMIT)
    sessionTraces.delete(sessionTraces.keys().next().value!);
  sessionTracesChanged();
  return traceId;
}
export function sessionPerformanceTrace(sessionId: string): string | undefined {
  return enabled ? sessionTraces.get(sessionId) : undefined;
}
/** Reactive `sessionPerformanceTrace`: re-renders the caller when its session's trace starts or ends. */
export function useSessionPerformanceTrace(sessionId: string): string | undefined {
  return useSyncExternalStore(
    subscribeSessionPerformanceTraces,
    () => sessionPerformanceTrace(sessionId),
    () => undefined,
  );
}
export function endSessionPerformanceTrace(sessionId: string, traceId?: string): void {
  if (traceId === undefined || sessionTraces.get(sessionId) === traceId) {
    sessionTraces.delete(sessionId);
    sessionTracesChanged();
  }
}
export function isPerformanceTracingEnabled(): boolean {
  return enabled;
}
export function setPerformanceVisualEffects(options: { shimmer?: boolean; blur?: boolean }): void {
  if (typeof document === "undefined") return;
  if (options.shimmer !== undefined)
    document.documentElement.toggleAttribute("data-performance-no-shimmer", !options.shimmer);
  if (options.blur !== undefined)
    document.documentElement.toggleAttribute("data-performance-no-blur", !options.blur);
}
export function createPerformanceTraceId(): string {
  return `trace-${++sequence}`;
}
export function configurePerformanceTracing(options: {
  enabled: boolean;
  capacity?: number;
}): void {
  enabled = options.enabled;
  if (!enabled) sessionTraces.clear();
  sessionTracesChanged();
  capacity = Math.max(1, Math.min(10000, Math.floor(options.capacity ?? 2048) || 2048));
  records = records.slice(-capacity);
}
export function clearPerformanceTrace(): void {
  records = [];
  slowFrames.length = 0;
  sessionTraces.clear();
  sessionTracesChanged();
}
export function getPerformanceTrace(): PerformanceTraceRecord[] {
  const retained = slowFrames
    .filter((frame) => !records.includes(frame))
    .sort((a, b) => a.at - b.at);
  return [...retained, ...records].map((record) => ({ ...record, metrics: { ...record.metrics } }));
}
function append(
  stage: PerformanceStage,
  at: number,
  metrics: PerformanceMetrics = {},
  traceId?: string,
  duration?: number,
): void {
  if (!stages.has(stage)) return;
  const safe: PerformanceMetrics = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (metricKeys.has(key) && typeof value === "number" && Number.isFinite(value))
      safe[key as keyof PerformanceMetrics] = value;
  }
  // Only IDs generated by this collector may be exported.
  records.push({
    stage,
    at,
    metrics: safe,
    ...(duration === undefined ? {} : { duration }),
    ...(traceId && /^trace-\d+$/.test(traceId) ? { traceId } : {}),
  });
  if (stage === "long-animation-frame") {
    slowFrames.push(records[records.length - 1]);
    slowFrames.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    if (slowFrames.length > 16) slowFrames.pop();
  }
  if (records.length > capacity) records.splice(0, records.length - capacity);
}
export function recordPerformanceEvent(
  stage: PerformanceStage,
  metrics?: PerformanceMetrics,
  traceId?: string,
): void {
  if (enabled) append(stage, performance.now(), metrics, traceId);
}
/** Records an observed interval (for example a long task) with its duration only. */
export function recordPerformanceInterval(
  stage: PerformanceStage,
  startedAt: number,
  duration: number,
  metrics?: PerformanceMetrics,
): void {
  if (enabled && Number.isFinite(startedAt) && Number.isFinite(duration))
    append(stage, startedAt, metrics, undefined, Math.max(0, duration));
}

const noop = () => {};
export function startPerformanceSpan(
  stage: PerformanceStage,
  metrics?: PerformanceMetrics,
  traceId?: string,
): (finalMetrics?: PerformanceMetrics) => void {
  if (!enabled) return noop;
  const at = performance.now();
  let ended = false;
  return (finalMetrics) => {
    if (ended || !enabled) return;
    ended = true;
    append(
      stage,
      at,
      { ...metrics, ...finalMetrics },
      traceId,
      Math.max(0, performance.now() - at),
    );
  };
}
