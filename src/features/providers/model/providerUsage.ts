export { formatUsageTokens } from "../../../shared/i18n/format";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderAccount, ProviderAccountProvider } from "./providerAccounts";
import {
  rowCost,
  rowInput,
  rowTokens,
  usageRate,
  type ModelPrice,
  type UsagePricing,
  type UsageRow,
} from "./usagePricing";

export {
  createUsagePricing,
  rowCost,
  rowTokens,
  usageRate,
  type ModelPrice,
  type UsagePricing,
  type UsageRow,
} from "./usagePricing";

export type UsageReport = {
  rows: UsageRow[];
  /** False when the account has never written a session log. */
  found: boolean;
  filesScanned: number;
};

/** Longest range the Usage section offers; one scan covers every range. */
export const USAGE_MAX_DAYS = 30;

export async function fetchProviderUsage(
  provider: ProviderAccountProvider,
  accountId: string,
  sinceMs: number,
): Promise<UsageReport> {
  return invoke<UsageReport>("provider_usage_report", {
    provider,
    accountId,
    sinceMs,
  });
}

export type ModelPrices = {
  models: ModelPrice[];
  /** Unix seconds. */
  fetchedAt: number;
};

/** OpenRouter's public price list, cached by the app for a day. */
export async function fetchModelPrices(): Promise<ModelPrices | null> {
  try {
    return await invoke<ModelPrices>("provider_model_prices");
  } catch {
    return null;
  }
}

/**

/** What the cache reads would have cost as ordinary input. */
function rowCacheSavings(row: UsageRow, pricing: UsagePricing): number {
  const rate = pricing(row.model);
  if (!rate) return 0;
  return (row.cacheRead * (rate.input - rate.cacheRead)) / 1_000_000;
}

export type AccountUsage = {
  account: ProviderAccount;
  rows: UsageRow[];
};

export type UsageDay = {
  /** Local midnight. */
  date: Date;
  tokens: number;
  cost: number;
};

export type UsageBreakdown = "model" | "project" | "account";

export type UsageBreakdownRow = {
  key: string;
  label: string;
  /** Full value behind a shortened label, such as a project's path. */
  title?: string;
  provider: ProviderAccountProvider | null;
  tokens: number;
  cost: number;
  /** Share of the largest row, for the bar. */
  share: number;
};

export type UsageSummary = {
  days: UsageDay[];
  tokens: number;
  cost: number;
  activeDays: number;
  /** Cache reads as a share of all input tokens. */
  cacheHitRate: number;
  cacheSavings: number;
  /** Models seen in the logs that have no rate, so their cost is missing. */
  unpricedModels: string[];
};

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** The last `dayCount` local calendar days, oldest first, ending today. */
export function usageDays(dayCount: number, now: Date): Date[] {
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    date.setDate(date.getDate() - (dayCount - 1 - index));
    return date;
  });
}

/** Rows that fall inside the last `dayCount` local days. */
function rowsInRange(
  usage: AccountUsage[],
  dayCount: number,
  now: Date,
): { entry: AccountUsage; row: UsageRow; day: string }[] {
  const start = usageDays(dayCount, now)[0].getTime() / 1000;
  return usage.flatMap((entry) =>
    entry.rows
      .filter((row) => row.slot >= start)
      .map((row) => ({
        entry,
        row,
        day: localDayKey(new Date(row.slot * 1000)),
      })),
  );
}

export function summarizeUsage(
  usage: AccountUsage[],
  dayCount: number,
  now: Date,
  pricing: UsagePricing = usageRate,
): UsageSummary {
  const days = usageDays(dayCount, now).map((date) => ({
    date,
    tokens: 0,
    cost: 0,
  }));
  const byDay = new Map(days.map((day) => [localDayKey(day.date), day]));
  let input = 0;
  let cacheRead = 0;
  let cacheSavings = 0;
  const unpriced = new Set<string>();

  for (const { row, day } of rowsInRange(usage, dayCount, now)) {
    const target = byDay.get(day);
    if (!target) continue;
    const cost = rowCost(row, pricing);
    if (cost == null) unpriced.add(row.model);
    target.tokens += rowTokens(row);
    target.cost += cost ?? 0;
    input += rowInput(row);
    cacheRead += row.cacheRead;
    cacheSavings += rowCacheSavings(row, pricing);
  }

  return {
    days,
    tokens: days.reduce((sum, day) => sum + day.tokens, 0),
    cost: days.reduce((sum, day) => sum + day.cost, 0),
    activeDays: days.filter((day) => day.tokens > 0).length,
    cacheHitRate: input > 0 ? cacheRead / input : 0,
    cacheSavings,
    unpricedModels: [...unpriced].sort(),
  };
}

function projectName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function usageBreakdown(
  usage: AccountUsage[],
  dayCount: number,
  now: Date,
  by: UsageBreakdown,
  accountLabel: (account: ProviderAccount) => string,
  pricing: UsagePricing = usageRate,
): UsageBreakdownRow[] {
  const rows = new Map<string, Omit<UsageBreakdownRow, "share">>();
  for (const { entry, row } of rowsInRange(usage, dayCount, now)) {
    const { account } = entry;
    const [key, label, title, provider] =
      by === "model"
        ? // The same model used from two accounts is one row.
          [row.model, row.model, undefined, account.provider]
        : by === "account"
          ? [
              `${account.provider}:${account.id}`,
              accountLabel(account),
              undefined,
              account.provider,
            ]
          : [
              row.project,
              row.project ? projectName(row.project) : "Unknown folder",
              row.project || undefined,
              null,
            ];
    const target = rows.get(key) ?? {
      key,
      label,
      title,
      provider,
      tokens: 0,
      cost: 0,
    };
    target.tokens += rowTokens(row);
    target.cost += rowCost(row, pricing) ?? 0;
    rows.set(key, target);
  }
  const sorted = [...rows.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  const top = sorted[0];
  return sorted.map((row) => ({
    ...row,
    share: top
      ? top.cost > 0
        ? row.cost / top.cost
        : top.tokens > 0
          ? row.tokens / top.tokens
          : 0
      : 0,
  }));
}

export function formatUsageCost(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
