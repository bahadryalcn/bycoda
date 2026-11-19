import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import type { UsagePricing } from "../../providers/public/providerUsage";
import { useLockSnapshot } from "../../group-lock/public/useGroupLock";
import type { TodayData, TodayPeriod } from "../model/todayAggregate";
import { fetchTodaySources, summarizeTodaySources, type TodaySources } from "../model/todayLoad";
import { isReadDue, msUntilNextDay, sameLocalDay, TODAY_REFRESH_MS } from "../model/todayRefresh";

/**
 * Today or this week from the same sources as the Usage page: provider log rows per account,
 * recorded turns and model prices. Projects in a locked group are left out, as there.
 *
 * While the view is visible it re-reads on a slow interval, on return to the foreground and once
 * the local day changes (the windows move at midnight). At most one automatic read is in flight,
 * and a failed read keeps the last good figures.
 */
export function useTodayData(period: TodayPeriod): {
  /** Figures of `loadedPeriod`, which can differ from the selected period while it loads. */
  data: TodayData | null;
  loadedPeriod: TodayPeriod;
  pricing: UsagePricing | null;
  loading: boolean;
  /** True while a read for the selected period and refresh is still in flight; `data` may be stale then. */
  refreshing: boolean;
  failed: boolean;
  /** When the figures were last read completely, or null before the first complete read. */
  updatedAt: number | null;
  reload: () => void;
} {
  const lock = useLockSnapshot();
  const visible = useQueryVisible();
  const [version, setVersion] = useState(0);
  const previous = useRef<TodaySources | undefined>(undefined);
  const lastReadAt = useRef(0);
  const inFlight = useRef(false);
  const readId = useRef(0);
  const [load, setLoad] = useState<{
    period: TodayPeriod;
    version: number;
    value: TodaySources | null;
    failed: boolean;
    updatedAt: number | null;
  }>({
    period,
    version: 0,
    value: null,
    failed: false,
    updatedAt: null,
  });
  // Reads when the period or a refresh changes; the cleanup drops a superseded answer.
  useEffect(() => {
    let cancelled = false;
    const id = ++readId.current;
    inFlight.current = true;
    lastReadAt.current = Date.now();
    fetchTodaySources(period, previous.current)
      .then(({ value, failed }) => {
        if (cancelled) return;
        previous.current = value;
        setLoad((current) => ({
          period,
          version,
          failed,
          value,
          updatedAt: failed ? current.updatedAt : value.at,
        }));
      })
      .catch(() => undefined) // -- each source already degrades to an empty answer.
      .finally(() => {
        if (readId.current === id) inFlight.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [period, version]);
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Refresh external Today sources on a timer, including local midnight, while the pane is visible.
  useEffect(() => {
    if (!visible) return;
    const refreshIfDue = () => {
      const now = Date.now();
      if (!isReadDue(lastReadAt.current, now)) return;
      // One automatic read at a time, except a read that began on an earlier local day.
      if (inFlight.current && sameLocalDay(lastReadAt.current, now)) return;
      reload();
    };
    refreshIfDue();
    const interval = setInterval(refreshIfDue, TODAY_REFRESH_MS);
    let midnight: ReturnType<typeof setTimeout>;
    const armMidnight = () => {
      midnight = setTimeout(() => {
        refreshIfDue();
        armMidnight();
      }, msUntilNextDay(Date.now()));
    };
    armMidnight();
    return () => {
      clearInterval(interval);
      clearTimeout(midnight);
    };
  }, [visible, reload]);
  // Keep the last loaded period on screen while the newly selected one loads; `refreshing` marks it as stale.
  const value = load.value;
  const data = useMemo(
    () => (value ? summarizeTodaySources(value, lock, load.period) : null),
    [value, lock, load.period],
  );
  return {
    data,
    loadedPeriod: load.period,
    pricing: value?.pricing ?? null,
    loading: !value,
    refreshing: load.period !== period || load.version !== version,
    failed: load.period === period && load.failed,
    updatedAt: load.updatedAt,
    reload,
  };
}
