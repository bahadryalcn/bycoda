import { createStore } from "../../../shared/lib/store";
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
/**
 * Storage layout. `KEY` is the original single JSON array (legacy samples stay readable and are
 * never rewritten per reading). Each window appends new readings to its own small segment key,
 * so a reading writes at most `SEGMENT_LIMIT` samples and two windows never overwrite each other.
 * A window folds its segment (and any foreign segments it has seen) back into `KEY` only once
 * the segment fills, which is the one full parse/stringify and happens once per
 * `SEGMENT_LIMIT` new samples instead of once per reading.
 */
const KEY = "bycoda.quotaHistory.v1";
const SEGMENT_PREFIX = `${KEY}.segment.`;
const RETENTION = 90 * 86_400_000;
const MAX_SAMPLES = 16000;
const SEGMENT_LIMIT = 500;
/** Segments left by closed windows are folded away when a window starts with more than this. */
const ORPHAN_SEGMENT_LIMIT = 8;
const KINDS = ["session", "weekly", "monthly"] as const;
const ownKey = `${SEGMENT_PREFIX}${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const listeners = createStore();
let snapshot: QuotaSample[] | undefined;
/** Raw values last merged into `snapshot`; an unchanged raw is never parsed again. */
let baseRaw: string | null | undefined;
const segmentRaws = new Map<string, string>();
/** This window's samples that are not yet folded into the base array. */
let own: QuotaSample[] = [];
let compactAt = SEGMENT_LIMIT;
/** Memory holds readings that storage rejected; they survive reloads until a write succeeds. */
let hasUnwrittenSamples = false;
const latest = new Map<string, QuotaSample>();
const sampleKey = (sample: Pick<QuotaSample, "account" | "kind">) =>
  JSON.stringify([sample.account, sample.kind]);
function indexLatest(samples: readonly QuotaSample[]) {
  latest.clear();
  for (const sample of samples) latest.set(sampleKey(sample), sample);
}
function parseSamples(raw: string | null, cutoff: number): QuotaSample[] {
  if (raw === null) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
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
    );
  } catch {
    // An unreadable value contributes nothing; observed in-memory samples are kept separately.
    return [];
  }
}
function readStorage() {
  const base = localStorage.getItem(KEY);
  const segments = new Map<string, string>();
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(SEGMENT_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (raw !== null) segments.set(key, raw);
  }
  return { base, segments };
}
/** Insert in `at` order; false when the same account/kind/time reading is already present. */
function insertSample(samples: QuotaSample[], sample: QuotaSample): boolean {
  let low = 0,
    high = samples.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle].at < sample.at) low = middle + 1;
    else high = middle;
  }
  let end = low;
  for (; end < samples.length && samples[end].at === sample.at; end++)
    if (samples[end].account === sample.account && samples[end].kind === sample.kind) return false;
  samples.splice(end, 0, sample);
  return true;
}
function trim(samples: QuotaSample[]) {
  if (samples.length <= MAX_SAMPLES) return;
  for (const dropped of samples.splice(0, samples.length - MAX_SAMPLES)) {
    const key = sampleKey(dropped);
    if (latest.get(key) === dropped) latest.delete(key);
  }
}
function loadAll(): QuotaSample[] {
  let storage: ReturnType<typeof readStorage>;
  try {
    storage = readStorage();
  } catch {
    return snapshot ?? [];
  }
  const { base, segments } = storage;
  if (
    snapshot &&
    base === baseRaw &&
    segments.size === segmentRaws.size &&
    [...segments].every(([key, raw]) => segmentRaws.get(key) === raw)
  )
    return snapshot;
  const cutoff = Date.now() - RETENTION;
  const merged: QuotaSample[] = [];
  const add = (samples: readonly QuotaSample[]) => {
    for (const sample of samples) merged.push(sample);
  };
  add(parseSamples(base, cutoff));
  for (const raw of segments.values()) add(parseSamples(raw, cutoff));
  if (hasUnwrittenSamples && snapshot) add(snapshot.filter((sample) => sample.at > cutoff));
  merged.sort((a, b) => a.at - b.at);
  const next: QuotaSample[] = [];
  for (const sample of merged) insertSample(next, sample);
  trim(next);
  if (!hasUnwrittenSamples && !segments.has(ownKey)) own = [];
  baseRaw = base;
  segmentRaws.clear();
  for (const [key, raw] of segments) segmentRaws.set(key, raw);
  indexLatest(next);
  return (snapshot = next);
}
/** Fold every segment this window has merged into the base array (one full write). */
function compact(): boolean {
  const current = loadAll();
  const folded = new Map(segmentRaws);
  try {
    const raw = JSON.stringify(current);
    localStorage.setItem(KEY, raw);
    baseRaw = raw;
  } catch {
    // Keep the segments; retry only after another full segment of readings.
    compactAt = own.length + SEGMENT_LIMIT;
    return false;
  }
  hasUnwrittenSamples = false;
  try {
    // A foreign segment is removed only if it still holds exactly what was folded.
    for (const [key, seen] of folded)
      if (key === ownKey || localStorage.getItem(key) === seen) localStorage.removeItem(key);
  } catch {
    // Leftover segments only repeat samples the next load deduplicates.
  }
  segmentRaws.clear();
  own = [];
  compactAt = SEGMENT_LIMIT;
  return true;
}
function publish(next: QuotaSample[]) {
  snapshot = next;
  listeners.notify();
}
export function recordRateLimitHistory(account: string, limits: ProviderRateLimits): void {
  if (limits.status !== "ok" || !Number.isFinite(limits.updatedAt) || limits.updatedAt <= 0) return;
  const retained = loadAll();
  const cutoff = Date.now() - RETENTION;
  const samples =
    retained[0]?.at <= cutoff ? retained.filter((sample) => sample.at > cutoff) : retained.slice();
  if (samples.length !== retained.length) indexLatest(samples);
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
    if (!insertSample(samples, sample)) continue;
    latest.set(sampleKey(sample), sample);
    added.push(sample);
  }
  if (!added.length) return;
  trim(samples);
  snapshot = samples;
  own.push(...added);
  try {
    const raw = JSON.stringify(own);
    localStorage.setItem(ownKey, raw);
    segmentRaws.set(ownKey, raw);
    hasUnwrittenSamples = false;
  } catch {
    /* Still expose this window's real readings; the next reading retries the segment. */
    hasUnwrittenSamples = true;
  }
  if (own.length >= compactAt) compact();
  // Compaction re-reads storage and may have merged a concurrent writer's samples.
  publish(snapshot ?? samples);
}
const empty: QuotaSample[] = [];
function getSnapshot() {
  return (snapshot ??= loadAll());
}
function subscribe(listener: () => void) {
  const unsubscribe = listeners.subscribe(listener);
  if (listeners.size === 1) {
    snapshot = loadAll();
    window.addEventListener("storage", onStorage);
    if (segmentRaws.size > ORPHAN_SEGMENT_LIMIT) compact();
  }
  return () => {
    unsubscribe();
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}
/** Merge another window's small segment without reparsing the base array. */
function mergeSegment(key: string, value: string | null): QuotaSample[] | undefined {
  if (value === null) {
    // Folded into the base by its owner (whose base write arrives as its own event) or discarded.
    segmentRaws.delete(key);
    return undefined;
  }
  if (!snapshot) return loadAll();
  segmentRaws.set(key, value);
  const next = snapshot.slice();
  let changed = false;
  for (const sample of parseSamples(value, Date.now() - RETENTION)) {
    if (!insertSample(next, sample)) continue;
    const previous = latest.get(sampleKey(sample));
    if (!previous || sample.at >= previous.at) latest.set(sampleKey(sample), sample);
    changed = true;
  }
  if (!changed) return undefined;
  trim(next);
  return next;
}
function onStorage(event: StorageEvent) {
  const { key } = event;
  if (key !== null && key !== KEY && !key.startsWith(SEGMENT_PREFIX)) return;
  if (key !== null && key !== KEY) {
    if (key === ownKey) return;
    const next = mergeSegment(key, event.newValue);
    if (next) publish(next);
    return;
  }
  if (key === null || event.newValue === null) {
    try {
      if (localStorage.getItem(KEY) === null && !readStorage().segments.size) {
        baseRaw = undefined;
        segmentRaws.clear();
        snapshot = undefined;
        own = [];
        hasUnwrittenSamples = false;
        indexLatest([]);
      }
    } catch {
      // An unreadable store does not prove a clear or discard observed samples.
    }
  }
  publish(loadAll());
}
export function useRateLimitHistory() {
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}
