import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { elapsedSince, monotonicNow } from "../../src/shared/lib/time/timestamps";
import { DESKTOP_TAKE_WAIT_MS } from "../../src/shared/model/host-contracts/native-services";
import { perfMetrics } from "./perf-metrics";

/** `RemoteChanges.read` and `RevisionWaits.wait` end a poll after this long, whatever wait was asked. */
const HELD_POLL_CAP_MS = 10_000;
const heldPollMs = (params: Record<string, unknown>): number => {
  const wait = Number(params.waitMs);
  return wait > 0 ? Math.min(HELD_POLL_CAP_MS, wait) : 0;
};
/** An idle desktop take is held for the wait it asked for, up to the relay's bound. */
const heldTakeMs = (params: Record<string, unknown>): number =>
  Math.min(DESKTOP_TAKE_WAIT_MS, Math.max(0, Number(params.waitMs) || 0));
const HELD_POLLS: Record<string, (params: Record<string, unknown>) => number> = {
  "machine.changes": heldPollMs,
  "sessions.sync": heldPollMs,
  "conversation.desktop.take": heldTakeMs,
  "native.services.conversation.desktop.take": heldTakeMs,
};

/** The wait the Host will really hold this call for, after its own cap. */
export function heldPollWaitMs(method: string, params: Record<string, unknown>): number {
  return Object.hasOwn(HELD_POLLS, method) ? HELD_POLLS[method]!(params) : 0;
}

type DbWait = {
  scopes: number;
  totalMs: number;
  maxMs: number;
  pending: number;
  pendingSince?: number;
};

/** The store's own per-owner stage counters; numbers only. */
export type DbHoldTimings = {
  guardMs: number;
  workerMs: number;
  roundTripMs: number;
  commitMs: number;
  requests: number;
};
type DbHold = DbHoldTimings & { heldMs: number; open: Map<DbHoldTimings, number> };

/** A fixed vocabulary: never an error message, code from a client, or request content. */
export type RequestOutcome =
  | "sent"
  | "not-sent"
  | "completed"
  | "deadline"
  | "cancelled"
  | "disconnected"
  | "unauthorized"
  | "overloaded"
  | "too-large"
  | "rejected"
  | "failed";

/**
 * Stage times of one request. Holds a process-local id and numbers only: never the method's
 * params, the client's request id, a credential, SQL text or a path.
 */
export type RequestTrace = {
  id: string;
  transport: "http" | "ws";
  receivedAt: number;
  handlerStartedAt?: number;
  handlerEndedAt?: number;
  /** When the transport accepted the final response frame; not when the client received it. */
  responseEndedAt?: number;
  outcome?: RequestOutcome;
  writer: DbWait;
  read: DbWait;
  hold: DbHold;
};

const traces = new AsyncLocalStorage<RequestTrace>();
let traceSequence = 0;
const emptyWait = (): DbWait => ({ scopes: 0, totalMs: 0, maxMs: 0, pending: 0 });
const emptyHold = (): DbHold => ({
  heldMs: 0,
  guardMs: 0,
  workerMs: 0,
  roundTripMs: 0,
  commitMs: 0,
  requests: 0,
  open: new Map(),
});

export function startRequestTrace(
  transport: RequestTrace["transport"],
  receivedAt = monotonicNow(),
): RequestTrace {
  return {
    id: `r${(++traceSequence).toString(36)}`,
    transport,
    receivedAt,
    writer: emptyWait(),
    read: emptyWait(),
    hold: emptyHold(),
  };
}

export const runWithRequestTrace = <T>(trace: RequestTrace, work: () => T): T =>
  traces.run(trace, work);
export const currentRequestTrace = (): RequestTrace | undefined => traces.getStore();

/**
 * Opens a database wait on the current request and returns its idempotent end, or nothing
 * outside a request. A wait still open when the request reports shows as `...WaitingMs`, so
 * a request that gave up in the queue is not reported as having waited zero.
 */
export function traceDbWait(kind: "writer" | "read"): (() => void) | undefined {
  const trace = traces.getStore();
  if (!trace) return undefined;
  const wait = trace[kind];
  const startedAt = monotonicNow();
  wait.scopes++;
  if (wait.pending++ === 0) wait.pendingSince = startedAt;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    const ms = elapsedSince(startedAt);
    wait.totalMs += ms;
    wait.maxMs = Math.max(wait.maxMs, ms);
    if (--wait.pending === 0) wait.pendingSince = undefined;
  };
}

/**
 * Adds one writer ownership to its request using the store's existing counters. Returns its
 * idempotent end; an ownership still open at report time counts with its live values.
 */
export function traceWriterHold(trace: RequestTrace, timings: DbHoldTimings): () => void {
  const { hold } = trace;
  const startedAt = monotonicNow();
  hold.open.set(timings, startedAt);
  return () => {
    if (!hold.open.delete(timings)) return;
    hold.heldMs += elapsedSince(startedAt);
    hold.guardMs += timings.guardMs;
    hold.workerMs += timings.workerMs;
    hold.roundTripMs += timings.roundTripMs;
    hold.commitMs += timings.commitMs;
    hold.requests += timings.requests;
  };
}

const SAMPLE_EVERY_MS = 1_000;
/** About two minutes of history, the longest ordinary RPC deadline. */
const SAMPLES_KEPT = 128;
/** A shorter window says more about timer jitter than about the load. */
const MIN_RUNTIME_WINDOW_MS = 250;
type CpuTimes = { user: number; system: number };
type RuntimeSample = {
  at: number;
  loop: ReturnType<typeof performance.eventLoopUtilization>;
  process: CpuTimes;
  thread?: CpuTimes;
};

// A runtime without a per-thread reading, or one that refuses it, only loses this field.
const threadCpu = (): CpuTimes | undefined => {
  try {
    return (process as { threadCpuUsage?: () => CpuTimes }).threadCpuUsage?.();
  } catch {
    return undefined;
  }
};
// Runs on a bare timer and inside request cleanup: telemetry must never throw into either.
const readRuntime = (): RuntimeSample | undefined => {
  try {
    return {
      at: monotonicNow(),
      loop: performance.eventLoopUtilization(),
      process: process.cpuUsage(),
      thread: threadCpu(),
    };
  } catch {
    return undefined;
  }
};

let samples: RuntimeSample[] = [];
let nextSample = 0;
let samplerUsers = 0;
let samplerTimer: ReturnType<typeof setInterval> | undefined;

/** Requests never read these counters: only a request that turned out slow compares samples. */
export function startRuntimeSampler(): void {
  if (samplerUsers++ > 0) return;
  const first = readRuntime();
  samples = first ? [first] : [];
  nextSample = samples.length;
  samplerTimer = setInterval(() => {
    const sample = readRuntime();
    if (!sample) return;
    samples[nextSample % SAMPLES_KEPT] = sample;
    nextSample++;
  }, SAMPLE_EVERY_MS);
  samplerTimer.unref();
}

export function stopRuntimeSampler(): void {
  if (samplerUsers === 0 || --samplerUsers > 0) return;
  clearInterval(samplerTimer);
  samplerTimer = undefined;
  samples = [];
  nextSample = 0;
}

/** The newest sample at or before `at`, else the oldest one kept. */
function sampleBefore(at: number): RuntimeSample | undefined {
  let oldest: RuntimeSample | undefined;
  let best: RuntimeSample | undefined;
  for (const sample of samples) {
    if (!oldest || sample.at < oldest.at) oldest = sample;
    if (sample.at <= at && (!best || sample.at > best.at)) best = sample;
  }
  return best ?? oldest;
}

const cpuPercent = (from: CpuTimes, to: CpuTimes, windowMs: number) =>
  Math.round(((to.user - from.user + to.system - from.system) / 1_000 / windowMs) * 100);

/**
 * Runtime load over the sampled window around a request. `processCpuPct` covers every thread
 * and can pass 100; only `mainCpuPct` and `loopUtilizationPct` describe the main thread.
 */
function runtimeFields(receivedAt: number) {
  const from = sampleBefore(receivedAt);
  if (!from) return {};
  const to = readRuntime();
  if (!to) return {};
  const windowMs = to.at - from.at;
  if (windowMs < MIN_RUNTIME_WINDOW_MS) return {};
  try {
    return {
      runtimeWindowMs: Math.round(windowMs),
      loopUtilizationPct: Math.round(
        performance.eventLoopUtilization(to.loop, from.loop).utilization * 100,
      ),
      ...(from.thread && to.thread
        ? { mainCpuPct: cpuPercent(from.thread, to.thread, windowMs) }
        : {}),
      processCpuPct: cpuPercent(from.process, to.process, windowMs),
    };
  } catch {
    return {};
  }
}

/** Writer ownership of this request; a share of `totalMs` only when its scopes do not overlap. */
function holdFields(hold: DbHold, at: number) {
  const open = [...hold.open];
  if (!open.length && !hold.requests && !hold.heldMs) return {};
  const sum = (key: keyof DbHoldTimings) =>
    Math.round(open.reduce((total, [timings]) => total + timings[key], hold[key]));
  const holdingMs = open.reduce((longest, [, startedAt]) => {
    return Math.max(longest, elapsedSince(startedAt, at));
  }, 0);
  return {
    writerHeldMs: Math.round(
      open.reduce((total, [, startedAt]) => total + elapsedSince(startedAt, at), hold.heldMs),
    ),
    ...(open.length ? { writerHoldingMs: Math.round(holdingMs) } : {}),
    writerGuardMs: sum("guardMs"),
    writerWorkerMs: sum("workerMs"),
    writerRoundTripMs: sum("roundTripMs"),
    writerCommitMs: sum("commitMs"),
    writerRequests: sum("requests"),
  };
}

function waitFields(name: "writer" | "read", wait: DbWait, at: number) {
  if (!wait.scopes) return {};
  return {
    [`${name}Scopes`]: wait.scopes,
    // Overlapping scopes of one request each add their wait, so this can pass the total.
    [`${name}WaitMs`]: Math.round(wait.totalMs),
    [`${name}WaitMaxMs`]: Math.round(wait.maxMs),
    ...(wait.pendingSince !== undefined
      ? { [`${name}WaitingMs`]: Math.round(elapsedSince(wait.pendingSince, at)) }
      : {}),
  };
}

/** Log fields of a request that crossed its threshold. Call only then: it reads the runtime. */
export function slowRequestFields(
  trace: RequestTrace,
  options: { thresholdMs: number; heldWaitMs: number; at?: number },
): Record<string, string | number> {
  const at = options.at ?? monotonicNow();
  const started = trace.handlerStartedAt;
  const ended = trace.handlerEndedAt;
  const loop = perfMetrics.recentLoopWindow();
  return {
    traceId: trace.id,
    transport: trace.transport,
    ...(trace.outcome ? { outcome: trace.outcome } : {}),
    totalMs: Math.round(elapsedSince(trace.receivedAt, at)),
    admissionMs: Math.round(elapsedSince(trace.receivedAt, started ?? at)),
    ...(started !== undefined ? { handlerMs: Math.round(elapsedSince(started, ended ?? at)) } : {}),
    ...(started !== undefined && ended === undefined ? { handlerRunning: "yes" } : {}),
    ...(ended !== undefined && trace.responseEndedAt !== undefined
      ? { responseMs: Math.round(elapsedSince(ended, trace.responseEndedAt)) }
      : {}),
    ...waitFields("writer", trace.writer, at),
    ...holdFields(trace.hold, at),
    ...waitFields("read", trace.read, at),
    heldWaitMs: options.heldWaitMs,
    thresholdMs: options.thresholdMs,
    // Process-wide and not aligned to this request: compare the age with `totalMs`.
    ...(loop
      ? { loopMaxGlobalMs: Math.round(loop.maxMs), loopWindowAgeMs: Math.round(loop.ageMs) }
      : {}),
    ...runtimeFields(trace.receivedAt),
  };
}
