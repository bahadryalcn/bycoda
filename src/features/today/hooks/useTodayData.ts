import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
} from "../../providers/public/providerAccounts";
import {
  createUsagePricing,
  fetchModelPrices,
  fetchProviderUsage,
  type AccountUsage,
  type UsagePricing,
} from "../../providers/public/providerUsage";
import { useLockSnapshot } from "../../group-lock/public/useGroupLock";
import { isProjectLockedIn } from "../../group-lock/public/lockState";
import type { UsageTurnReport } from "../../usage/public/usageAnalytics";
import {
  summarizeToday,
  todayWindow,
  type TodayData,
  type TodayPeriod,
} from "../model/todayAggregate";

type Load = {
  usage: AccountUsage[];
  turns: UsageTurnReport["turns"];
  pricing: UsagePricing;
  at: number;
};

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
  const [load, setLoad] = useState<{
    period: TodayPeriod;
    value: Load | null;
    failed: boolean;
  }>({
    period,
    value: null,
    failed: false,
  });
  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const since = Math.floor(todayWindow(period, now).start / 900_000) * 900_000;
    const accounts = PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts);
    Promise.all([
      Promise.all(
        accounts.map(async (account) => {
          try {
            return {
              account,
              rows: (await fetchProviderUsage(account.provider, account.id, since)).rows,
              failed: false,
            };
          } catch {
            return { account, rows: [], failed: true };
          }
        }),
      ),
      invoke<UsageTurnReport>("session_usage_report", {
        sinceMs: since,
        untilMs: now + 900_000,
      }).catch(() => null),
      fetchModelPrices().catch(() => null),
    ])
      .then(([reports, turns, prices]) => {
        if (cancelled) return;
        setLoad((previous) => ({
          period,
          failed:
            turns === null || (accounts.length > 0 && reports.every((report) => report.failed)),
          value: {
            usage: reports.map(({ account, rows }) => ({ account, rows })),
            turns: turns?.turns ?? previous.value?.turns ?? [],
            pricing: createUsagePricing(prices?.models),
            at: now,
          },
        }));
      })
      .catch(() => undefined); // -- each source already degrades to an empty answer.
    return () => {
      cancelled = true;
    };
  }, [period, version]);
  const value = load.period === period ? load.value : null;
  const data = useMemo(
    () =>
      value
        ? summarizeToday({
            usage: value.usage.map(({ account, rows }) => ({
              account,
              rows: rows.filter((row) => !row.project || !isProjectLockedIn(lock, row.project)),
            })),
            turns: value.turns.filter(
              (turn) => !turn.project || !isProjectLockedIn(lock, turn.project),
            ),
            pricing: value.pricing,
            period,
            now: value.at,
          })
        : null,
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
