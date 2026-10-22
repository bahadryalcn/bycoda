import {
  providerAccountColorValue,
  type ProviderAccount,
} from "../../providers/model/providerAccounts";
import { usageSeriesColor } from "./usageOverview";
import type { UsageDimension, UsageSample } from "./usageAnalytics";

/** Provider totals use the configured default account. Models/projects use their leading account. */
export function usageColorMap(
  accounts: readonly ProviderAccount[],
  samples: readonly UsageSample[],
  dimension: UsageDimension,
): Map<string, string> {
  const result = new Map<string, string>();
  const byId = new Map(accounts.map((account) => [`${account.provider}:${account.id}`, account]));
  for (const account of accounts) {
    result.set(`${account.provider}:${account.id}`, providerAccountColorValue(account));
    if (!result.has(account.provider) || account.isDefault || account.id === "default")
      result.set(account.provider, providerAccountColorValue(account));
  }
  if (dimension === "project" || dimension === "model") {
    const weights = new Map<string, Map<string, number>>();
    for (const sample of samples) {
      const group = weights.get(sample[dimension]) ?? new Map<string, number>();
      group.set(
        sample.account,
        (group.get(sample.account) ?? 0) + sample.tokens + sample.duration / 1000,
      );
      weights.set(sample[dimension], group);
    }
    for (const [key, group] of weights) {
      const accountId = [...group].sort((a, b) => b[1] - a[1])[0]?.[0];
      const account = accountId ? byId.get(accountId) : undefined;
      if (account) result.set(key, providerAccountColorValue(account));
    }
  }
  result.set("__other", "var(--ui-text-secondary)");
  return result;
}
export function usageChartColor(colors: ReadonlyMap<string, string>, key: string): string {
  let hash = 0;
  for (const c of key) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return colors.get(key) ?? usageSeriesColor(hash, key);
}
