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
const RETENTION = 90 * 86_400_000;
const MAX_SAMPLES = 16000;
const listeners = new Set<() => void>();
let snapshot: QuotaSample[] | undefined;
let cachedRaw: string | null | undefined;
let hasUnwrittenSamples = false;
const latest = new Map<string, QuotaSample>();
const sampleKey = (sample: Pick<QuotaSample, "account" | "kind">) =>
  JSON.stringify([sample.account, sample.kind]);
function indexLatest(samples: readonly QuotaSample[]) {
  latest.clear();
  for (const sample of samples) latest.set(sampleKey(sample), sample);
}
function read(): QuotaSample[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return snapshot ?? [];
  }
  try {
    if (raw === cachedRaw && snapshot) return snapshot;
    const data: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(data)) {
      cachedRaw = raw;
      if (hasUnwrittenSamples && snapshot) return snapshot;
      indexLatest([]);
      return (snapshot = []);
    }
    let next = data
      .filter(
        (s): s is QuotaSample =>
          s &&
          typeof s.account === "string" &&
          Number.isFinite(s.at) &&
          s.at > Date.now() - RETENTION &&
          ["session", "weekly", "monthly"].includes(s.kind) &&
          Number.isFinite(s.used) &&
          s.used >= 0 &&
          s.used <= 100 &&
          Number.isFinite(s.minutes) &&
          s.minutes > 0 &&
          (s.resetsAt === null || Number.isFinite(s.resetsAt)),
      )
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_SAMPLES);
    if (raw !== null && hasUnwrittenSamples && snapshot) {
      const identity = (sample: QuotaSample) =>
        JSON.stringify([sample.account, sample.kind, sample.at]);
      const merged = new Map(next.map((sample) => [identity(sample), sample]));
      for (const sample of snapshot)
        if (sample.at > Date.now() - RETENTION) merged.set(identity(sample), sample);
      next = [...merged.values()].sort((a, b) => a.at - b.at).slice(-MAX_SAMPLES);
    } else if (raw === null) hasUnwrittenSamples = false;
    cachedRaw = raw;
    indexLatest(next);
    return (snapshot = next);
  } catch {
    cachedRaw = raw;
    if (hasUnwrittenSamples && snapshot) return snapshot;
    indexLatest([]);
    return (snapshot = []);
  }
}
function publish(next: QuotaSample[]) {
  snapshot = next;
  for (const listener of listeners) listener();
}
export function recordRateLimitHistory(account: string, limits: ProviderRateLimits): void {
  if (limits.status !== "ok" || !Number.isFinite(limits.updatedAt) || limits.updatedAt <= 0) return;
  const retained = read();
  const cutoff = Date.now() - RETENTION;
  const samples =
    retained[0]?.at <= cutoff ? retained.filter((sample) => sample.at > cutoff) : retained.slice();
  if (samples.length !== retained.length) indexLatest(samples);
  let changed = false;
  for (const kind of ["session", "weekly", "monthly"] as const) {
    const window = limits[kind];
    if (
      !window ||
      !Number.isFinite(window.usedPercent) ||
      window.usedPercent < 0 ||
      window.usedPercent > 100
    )
      continue;
    const previous = latest.get(sampleKey({ account, kind }));
    if (
      previous &&
      (limits.updatedAt <= previous.at ||
        (limits.updatedAt - previous.at < 300_000 &&
          previous.used === window.usedPercent &&
          previous.resetsAt === window.resetsAt))
    )
      continue;
    const sample: QuotaSample = {
      account,
      at: limits.updatedAt,
      kind,
      used: window.usedPercent,
      minutes: window.windowMinutes,
      resetsAt: window.resetsAt,
    };
    let low = 0,
      high = samples.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (samples[middle].at <= sample.at) low = middle + 1;
      else high = middle;
    }
    samples.splice(low, 0, sample);
    latest.set(sampleKey(sample), sample);
    changed = true;
  }
  if (!changed) return;
  const next = samples.slice(-MAX_SAMPLES);
  if (next.length !== samples.length) indexLatest(next);
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(KEY, raw);
    cachedRaw = raw;
    hasUnwrittenSamples = false;
  } catch {
    /* Still expose this window's real readings. */
    hasUnwrittenSamples = true;
  }
  publish(next);
}
const empty: QuotaSample[] = [];
function getSnapshot() {
  return (snapshot ??= read());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    snapshot = read();
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}
function onStorage(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return;
  if (event.key === null || event.newValue === null) {
    try {
      if (localStorage.getItem(KEY) === null) {
        cachedRaw = undefined;
        snapshot = undefined;
        hasUnwrittenSamples = false;
        indexLatest([]);
      }
    } catch {
      // An unreadable store does not prove a clear or discard observed samples.
    }
  }
  publish(read());
}
export function useRateLimitHistory() {
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}
