import { useSyncExternalStore } from "react";
import type { ProviderRateLimits } from "./rateLimits";

export type QuotaSample = {
  account: string;
  at: number;
  kind: "session" | "weekly" | "monthly";
  used: number;
  minutes: number;
  resetsAt: number | null;
};
const KEY = "bycoda.quotaHistory.v1";
const KINDS = ["session", "weekly", "monthly"] as const;
const RETENTION = 90 * 86_400_000;
/**
 * Storage budget. One serialised sample is ~110-140 characters, so 2 500
 * samples are at most ~350 K characters (~0.7 MB as browsers account
 * localStorage, UTF-16), down from 16 000 (~3.5 MB) which on its own crossed
 * WebKit's ~5 MB per-origin limit together with the other keys. Instead of
 * cutting the 90-day retention, older samples are thinned (see `compact`):
 * the chart keeps full resolution for the last day, 30-minute resolution for
 * the last week and 2-hour resolution beyond that.
 */
export const RATE_LIMIT_HISTORY_MAX_SAMPLES = 2500;
const MAX_SAMPLES = RATE_LIMIT_HISTORY_MAX_SAMPLES;
const COMPACT_TIERS: ReadonlyArray<readonly [olderThanMs: number, bucketMs: number]> = [
  [7 * 86_400_000, 2 * 3_600_000],
  [86_400_000, 30 * 60_000],
];
/** A repeat reading of the same series within this window is not stored again. */
const REPEAT_WINDOW_MS = 300_000;
const listeners = new Set<() => void>();
const empty: QuotaSample[] = [];

// In-memory snapshot keyed on the raw stored string: publishing a reading only
// compares the string (cheap) and parses again when another window wrote the
// key. `last` holds the newest sample per account/kind so the repeat check
// never walks the array.
let cachedRaw: string | null | undefined;
let snapshot: QuotaSample[] | undefined;
const last = new Map<string, QuotaSample>();

const seriesKey = (account: string, kind: QuotaSample["kind"]) => `${account}\u0000${kind}`;

function parse(raw: string | null): QuotaSample[] {
  try {
    const data: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(data)) return [];
    const cutoff = Date.now() - RETENTION;
    return data
      .filter(
        (s): s is QuotaSample =>
          s &&
          typeof s.account === "string" &&
          Number.isFinite(s.at) &&
          s.at > cutoff &&
          KINDS.includes(s.kind) &&
          Number.isFinite(s.used) &&
          s.used >= 0 &&
          s.used <= 100 &&
          Number.isFinite(s.minutes) &&
          s.minutes > 0 &&
          (s.resetsAt === null || Number.isFinite(s.resetsAt)),
      )
      .slice(-MAX_SAMPLES);
  } catch {
    return [];
  }
}

function rebuildLast(samples: readonly QuotaSample[]) {
  last.clear();
  for (const sample of samples) {
    const key = seriesKey(sample.account, sample.kind);
    const previous = last.get(key);
    if (!previous || sample.at >= previous.at) last.set(key, sample);
  }
}

/** The current samples; parses storage only when its string changed. */
function current(): QuotaSample[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (snapshot && raw === cachedRaw) return snapshot;
  cachedRaw = raw;
  snapshot = parse(raw);
  rebuildLast(snapshot);
  return snapshot;
}

/**
 * Thins old samples so the cap holds without losing the retention window:
 * within each tier at most one sample per series per bucket is kept (the first
 * one). Samples from the last day are never thinned.
 */
function compact(samples: readonly QuotaSample[], now: number): QuotaSample[] {
  const kept: QuotaSample[] = [];
  const bucketStart = new Map<string, number>();
  for (const sample of samples) {
    const age = now - sample.at;
    const tier = COMPACT_TIERS.find(([olderThan]) => age >= olderThan);
    if (!tier) {
      kept.push(sample);
      continue;
    }
    const key = `${tier[1]}:${seriesKey(sample.account, sample.kind)}`;
    const start = bucketStart.get(key);
    if (start !== undefined && sample.at - start < tier[1]) continue;
    bucketStart.set(key, sample.at);
    kept.push(sample);
  }
  return kept;
}

function publish(next: QuotaSample[]) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function recordRateLimitHistory(account: string, limits: ProviderRateLimits): void {
  if (limits.status !== "ok" || !Number.isFinite(limits.updatedAt) || limits.updatedAt <= 0) return;
  const samples = current();
  const added: QuotaSample[] = [];
  for (const kind of KINDS) {
    const window = limits[kind];
    if (
      !window ||
      !Number.isFinite(window.usedPercent) ||
      window.usedPercent < 0 ||
      window.usedPercent > 100
    )
      continue;
    const previous = last.get(seriesKey(account, kind));
    if (
      previous &&
      (limits.updatedAt <= previous.at ||
        (limits.updatedAt - previous.at < REPEAT_WINDOW_MS &&
          previous.used === window.usedPercent &&
          previous.resetsAt === window.resetsAt))
    )
      continue;
    added.push({
      account,
      at: limits.updatedAt,
      kind,
      used: window.usedPercent,
      minutes: window.windowMinutes,
      resetsAt: window.resetsAt,
    });
  }
  if (added.length === 0) return;
  // Samples are appended in time order; a reading dated before the tail (clock
  // moved, another account's late reading) is the only case that needs a sort.
  const tail = samples.length ? samples[samples.length - 1]!.at : Number.NEGATIVE_INFINITY;
  let next = samples.concat(added);
  if (added.some((sample) => sample.at < tail)) next.sort((a, b) => a.at - b.at);
  if (next.length > MAX_SAMPLES) {
    next = compact(next, Date.now());
    if (next.length > MAX_SAMPLES) next = next.slice(-MAX_SAMPLES);
    rebuildLast(next);
  } else {
    for (const sample of added) last.set(seriesKey(sample.account, sample.kind), sample);
  }
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(KEY, raw);
    cachedRaw = raw;
  } catch {
    /* Still expose this window's real readings. */
  }
  publish(next);
}

function getSnapshot() {
  return snapshot ?? current();
}

// One `storage` listener for the module, held while anyone subscribes.
function onStorage(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return;
  snapshot = undefined;
  publish(current());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // Nobody watched the key meanwhile; pick up a write that arrived without an event.
    current();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function useRateLimitHistory() {
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}
