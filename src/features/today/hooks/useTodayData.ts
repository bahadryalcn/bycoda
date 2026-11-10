import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UsagePricing } from "../../providers/public/providerUsage";
import { useLockSnapshot } from "../../group-lock/public/useGroupLock";
import type { TodayData, TodayPeriod } from "../model/todayAggregate";
import { fetchTodaySources, summarizeTodaySources, type TodaySources } from "../model/todayLoad";

/**
 * Today or this week from the same sources as the Usage page: provider log rows per account,
 * recorded turns and model prices. Projects in a locked group are left out, as there.
 */
export function useTodayData(period: TodayPeriod): {
  data: TodayData | null;
  pricing: UsagePricing | null;
  loading: boolean;
  failed: boolean;
  reload: () => void;
} {
  const lock = useLockSnapshot();
  const [version, setVersion] = useState(0);
  const previousTurns = useRef<TodaySources["turns"] | undefined>(undefined);
  const [load, setLoad] = useState<{
    period: TodayPeriod;
    value: TodaySources | null;
    failed: boolean;
  }>({
    period,
    value: null,
    failed: false,
  });
  useEffect(() => {
    let cancelled = false;
    fetchTodaySources(period, previousTurns.current)
      .then(({ value, failed }) => {
        if (cancelled) return;
        previousTurns.current = value.turns;
        setLoad({ period, failed, value });
      })
      .catch(() => undefined); // -- each source already degrades to an empty answer.
    return () => {
      cancelled = true;
    };
  }, [period, version]);
  const value = load.period === period ? load.value : null;
  const data = useMemo(
    () => (value ? summarizeTodaySources(value, lock, period) : null),
    [value, lock, period],
  );
  const reload = useCallback(() => setVersion((current) => current + 1), []);
  return {
    data,
    pricing: value?.pricing ?? null,
    loading: !value,
    failed: load.period === period && load.failed,
    reload,
  };
}
