import { useSyncExternalStore } from "react";
import { createStoredSetting } from "../../../shared/lib/storedSetting";

/** Chart types each Usage panel offers; the first one is the panel's default. */
export const USAGE_CHART_KINDS = {
  trend: ["line", "area", "stacked-bar", "cumulative"],
  share: ["donut", "bar"],
  hourly: ["bar", "line"],
  quotaHistory: ["points", "line"],
} as const;

export type UsageChartPanel = keyof typeof USAGE_CHART_KINDS;
export type UsageChartKind<P extends UsageChartPanel> = (typeof USAGE_CHART_KINDS)[P][number];

const CHANGE_EVENT = "bycoda:usagechartkindchange";

function chartKindSetting<P extends UsageChartPanel>(panel: P) {
  const kinds: readonly string[] = USAGE_CHART_KINDS[panel];
  const fallback = kinds[0] as UsageChartKind<P>;
  return createStoredSetting<UsageChartKind<P>>({
    key: `bycoda.usage.chartKind.${panel}`,
    fallback,
    // An unknown or retired kind falls back to the panel default instead of breaking the chart.
    parse: (raw) => (kinds.includes(raw) ? (raw as UsageChartKind<P>) : fallback),
    serialize: (value) => value,
    event: CHANGE_EVENT,
    storageEvents: true,
  });
}

const settings = {
  trend: chartKindSetting("trend"),
  share: chartKindSetting("share"),
  hourly: chartKindSetting("hourly"),
  quotaHistory: chartKindSetting("quotaHistory"),
};

// A choice storage could not keep still applies to this window until a later save succeeds.
const unsaved = new Map<UsageChartPanel, string>();

export function loadUsageChartKind<P extends UsageChartPanel>(panel: P): UsageChartKind<P> {
  return (unsaved.get(panel) ?? settings[panel].load()) as UsageChartKind<P>;
}

export function saveUsageChartKind<P extends UsageChartPanel>(
  panel: P,
  kind: UsageChartKind<P>,
): boolean {
  const saved = (settings[panel] as ReturnType<typeof chartKindSetting<P>>).save(kind);
  if (saved) unsaved.delete(panel);
  else {
    unsaved.set(panel, kind);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
  return saved;
}

/** The remembered chart type of one panel, shared by every open window. */
export function useUsageChartKind<P extends UsageChartPanel>(
  panel: P,
): [UsageChartKind<P>, (kind: UsageChartKind<P>) => void] {
  const setting = settings[panel];
  const kind = useSyncExternalStore(
    setting.subscribe,
    () => loadUsageChartKind(panel),
    () => USAGE_CHART_KINDS[panel][0],
  ) as UsageChartKind<P>;
  return [kind, (next) => saveUsageChartKind(panel, next)];
}
