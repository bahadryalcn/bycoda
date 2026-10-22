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
function read(): QuotaSample[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data
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
      .slice(-MAX_SAMPLES);
  } catch {
    return [];
  }
}
function publish(next: QuotaSample[]) {
  snapshot = next;
  for (const listener of listeners) listener();
}
export function recordRateLimitHistory(account: string, limits: ProviderRateLimits): void {
  if (limits.status !== "ok" || !Number.isFinite(limits.updatedAt) || limits.updatedAt <= 0) return;
  const samples = read();
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
    const previous = [...samples].reverse().find((s) => s.account === account && s.kind === kind);
    if (
      previous &&
      (limits.updatedAt <= previous.at ||
        (limits.updatedAt - previous.at < 300_000 &&
          previous.used === window.usedPercent &&
          previous.resetsAt === window.resetsAt))
    )
      continue;
    samples.push({
      account,
      at: limits.updatedAt,
      kind,
      used: window.usedPercent,
      minutes: window.windowMinutes,
      resetsAt: window.resetsAt,
    });
    changed = true;
  }
  if (!changed) return;
  const next = samples.sort((a, b) => a.at - b.at).slice(-MAX_SAMPLES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Still expose this window's real readings. */
  }
  publish(next);
}
const empty: QuotaSample[] = [];
function getSnapshot() {
  return (snapshot ??= read());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) publish(read());
  };
  if (listeners.size === 1) snapshot = read();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
export function useRateLimitHistory() {
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}
