import { useEffect } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { useRateLimitQuery, loadRateLimits } from "../../providers/public/rateLimitsCache";
import { useShowRemainingUsage } from "../../settings/public/settings";
import {
  accountDisplayLabel,
  providerAccountColorValue,
  providerAccounts,
  type ProviderAccount,
} from "../../providers/public/providerAccounts";
import { UsageAccountRow } from "./UsageAccountRow";

const GROK_DEFAULT_ACCOUNT: ProviderAccount = {
  id: "default",
  provider: "grok",
  label: "Default account",
};

/** Grok exposes one CLI login, not isolated provider-account profiles. */
export function GrokLimits({ refresh }: { refresh: number }) {
  useLocale();
  const limits = useRateLimitQuery("grok", "default", true);
  const showRemaining = useShowRemainingUsage();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the shared Grok quota cache with the parent refresh generation.
  useEffect(() => {
    if (refresh > 0) void loadRateLimits("grok", "default", true);
  }, [refresh]);
  // The history legend colours the same stored account, so the bar and its legend dot match.
  const account = providerAccounts("grok").find((a) => a.id === "default") ?? GROK_DEFAULT_ACCOUNT;
  const name = accountDisplayLabel(account, [account]);
  return (
    <UsageAccountRow
      provider="grok"
      account={account}
      name={name}
      limits={limits}
      showRemaining={showRemaining}
      color={providerAccountColorValue(account)}
      retryLabel={`${t("Retry")}: ${name}`}
      onRetry={() => void loadRateLimits("grok", "default", true)}
    />
  );
}
