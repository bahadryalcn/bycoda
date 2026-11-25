import {
  emptyUsageFilters,
  type UsageFilters,
  type UsageMetric,
  type UsageResolution,
  type UsageWindow,
} from "./usageAnalytics";
import { pathKey } from "../../../shared/lib/paths";
import {
  usageReportWindows,
  type UsageReport,
  type UsageReportPeriod,
  type UsageReportRequest,
} from "./usageReport";
import type { UsageRangePreset } from "./usageWindows";

/**
 * A request to show the dashboard with exact settings: relative preset or a custom window,
 * the dashboard's own filters, metric and time granularity. A typed value, never free text.
 */
export type UsageViewIntent = {
  preset: UsageRangePreset | "custom";
  window: UsageWindow;
  filters: UsageFilters;
  metric: UsageMetric;
  resolution: UsageResolution;
};

function intentFor(
  period: UsageReportPeriod,
  window: UsageWindow,
  metric: UsageMetric,
  filters: UsageFilters,
): UsageViewIntent {
  return {
    preset: period === "last-30-days" ? "30d" : "custom",
    window,
    filters,
    metric,
    // The dashboard has no month step: months show as weeks, other periods as days.
    resolution: period === "monthly-history" ? "week" : "day",
  };
}

/** The dashboard settings that show exactly what a report summarized. */
export function usageIntentFor(report: UsageReport): UsageViewIntent {
  const filters = emptyUsageFilters();
  if (report.filters.provider) filters.provider = [report.filters.provider];
  if (report.filters.model) filters.model = [report.filters.model];
  if (report.filters.project) filters.project = [report.filters.project];
  return intentFor(
    report.period,
    { start: report.window.startMs, end: report.window.endMs },
    report.metric,
    filters,
  );
}

/**
 * The same settings without a report, when the usage read is unavailable. Provider and model
 * names cannot be resolved to dashboard keys without data, so only the window, metric and
 * project apply; `skipped` names what the dashboard will not be filtered by.
 */
export function usageIntentForRequest(
  request: UsageReportRequest,
  now: number,
): { intent: UsageViewIntent; skipped: ("provider" | "model")[] } {
  const filters = emptyUsageFilters();
  if (request.projectPath) filters.project = [pathKey(request.projectPath)];
  return {
    intent: intentFor(
      request.period,
      usageReportWindows(request, now).window,
      request.metric,
      filters,
    ),
    skipped: (["provider", "model"] as const).filter((key) => request[key]),
  };
}

/** A dashboard that is not opened shortly after the request ignores it instead of surprising the owner later. */
export const USAGE_VIEW_INTENT_TTL_MS = 60_000;

let pending: { intent: UsageViewIntent; at: number } | null = null;
const listeners = new Set<() => void>();

/** Stores the intent for the dashboard, which applies it whether mounted now or later. */
export function requestUsageView(intent: UsageViewIntent, now = Date.now()) {
  pending = {
    intent: { ...intent, filters: { ...emptyUsageFilters(), ...intent.filters } },
    at: now,
  };
  for (const listener of listeners) listener();
}

/** True while an intent waits for the dashboard to take it. */
export function hasUsageViewIntent(): boolean {
  return pending !== null;
}

/** Discards an intent no dashboard took, so it cannot apply to a later visit. */
export function dropUsageViewIntent() {
  pending = null;
}

/** Returns the waiting intent once and clears it. */
export function takeUsageViewIntent(now = Date.now()): UsageViewIntent | null {
  const waiting = pending;
  pending = null;
  return waiting && now - waiting.at <= USAGE_VIEW_INTENT_TTL_MS ? waiting.intent : null;
}

export function subscribeUsageViewIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
