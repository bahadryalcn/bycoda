import { invoke } from "@tauri-apps/api/core";
import type { ProviderAccount } from "../../providers/public/providerAccounts";
import {
  fetchModelPrices,
  fetchProviderUsage,
  type ModelPrices,
  type UsageRow,
} from "../../providers/public/providerUsage";
import type { UsageTurnReport } from "../model/usageAnalytics";

export type UsageAccountRead = { account: ProviderAccount; rows: UsageRow[]; failed: boolean };
export type UsageSources = {
  reports: Promise<UsageAccountRead[]>;
  /** Null when the recorded-turn read failed. */
  turns: Promise<UsageTurnReport | null>;
  /** Null when the price list is unavailable. */
  prices: Promise<ModelPrices | null>;
};

/**
 * The reads behind every Usage figure: provider logs per account, recorded turns and prices.
 * The dashboard and the voice report share it so both see the same sources for one interval.
 */
export function loadUsageSources(
  accounts: readonly ProviderAccount[],
  sinceMs: number,
  untilMs: number,
): UsageSources {
  return {
    reports: Promise.all(
      accounts.map(async (account): Promise<UsageAccountRead> => {
        try {
          const report = await fetchProviderUsage(
            account.provider,
            account.id,
            Math.floor(sinceMs / 900_000) * 900_000,
          );
          return { account, rows: report.rows, failed: false };
        } catch {
          return { account, rows: [], failed: true };
        }
      }),
    ),
    turns: invoke<UsageTurnReport>("session_usage_report", { sinceMs, untilMs }).catch(() => null),
    prices: fetchModelPrices().catch(() => null),
  };
}
