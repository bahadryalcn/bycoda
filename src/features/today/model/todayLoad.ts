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
import { isProjectLockedIn } from "../../group-lock/public/lockState";
import type { LockSnapshot } from "../../group-lock/public/lockState";
import type { UsageTurnReport } from "../../usage/public/usageAnalytics";
import { summarizeToday, todayWindow, type TodayData, type TodayPeriod } from "./todayAggregate";

export type TodaySources = {
  usage: AccountUsage[];
  turns: UsageTurnReport["turns"];
  pricing: UsagePricing;
  at: number;
  /** Start of the read window; a later read may reuse these rows only if it needs no earlier ones. */
  since: number;
};

/**
 * Provider log rows per account, recorded turns and prices. A source that cannot be read keeps the
 * `previous` read's answer when that covered the whole window (the last good figures stay on screen,
 * flagged `failed`), and otherwise degrades to an empty answer.
 */
export async function fetchTodaySources(
  period: TodayPeriod,
  previous?: TodaySources,
): Promise<{ value: TodaySources; failed: boolean }> {
  const now = Date.now();
  const since = Math.floor(todayWindow(period, now).start / 900_000) * 900_000;
  const kept = previous && previous.since <= since ? previous : undefined;
  const accounts = PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts);
  const [reports, turns, prices] = await Promise.all([
    Promise.all(
      accounts.map(async (account) => {
        try {
          return {
            account,
            rows: (await fetchProviderUsage(account.provider, account.id, since)).rows,
            failed: false,
          };
        } catch {
          const earlier = kept?.usage.find(
            (entry) =>
              entry.account.provider === account.provider && entry.account.id === account.id,
          );
          return { account, rows: earlier?.rows ?? [], failed: true };
        }
      }),
    ),
    invoke<UsageTurnReport>("session_usage_report", {
      sinceMs: since,
      untilMs: now + 900_000,
    }).catch(() => null),
    fetchModelPrices().catch(() => null),
  ]);
  return {
    failed: prices === null || turns === null || reports.some((report) => report.failed),
    value: {
      usage: reports.map(({ account, rows }) => ({ account, rows })),
      turns: turns?.turns ?? kept?.turns ?? [],
      pricing: prices || !kept ? createUsagePricing(prices?.models) : kept.pricing,
      at: now,
      since,
    },
  };
}

/** Projects in a locked group are left out, as on the Usage page. */
export function summarizeTodaySources(
  value: TodaySources,
  lock: LockSnapshot,
  period: TodayPeriod,
): TodayData {
  return summarizeToday({
    usage: value.usage.map(({ account, rows }) => ({
      account,
      rows: rows.filter((row) => !row.project || !isProjectLockedIn(lock, row.project)),
    })),
    turns: value.turns.filter((turn) => !turn.project || !isProjectLockedIn(lock, turn.project)),
    pricing: value.pricing,
    period,
    now: value.at,
  });
}
