import { EmptyState } from "../../../shared/ui/EmptyState";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import "./UsagePage.css";
import { WORKSPACE_REFRESH_EVENT } from "../../../app/shell/WorkspaceControls";
import {
  accountDisplayLabel,
  providerAccounts,
  providerAccountColorValue,
  type ProviderAccount,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import { loadRateLimits, useCachedRateLimits } from "../../providers/model/rateLimitsCache";
import type { RateLimitProvider } from "../../providers/model/rateLimits";
import { UsageAccountRow } from "./UsageAccountRow";
import { UsageOverview } from "./UsageOverview";
import type { UsageFilters } from "../model/usageAnalytics";
import { UsageDisplaySettings } from "./UsageDisplaySettings";
import { useShowRemainingUsage } from "../../settings/model/displayPrefs";
import {
  identityKey,
  useProviderAccountIdentities,
  type ProviderAccountIdentity,
} from "../../providers/model/providerAccountIdentity";
import { ProviderAccountSubtitle } from "../../providers/ui/ProviderAccountSubtitle";
import { Heading } from "../../../shared/ui/Heading";
import { Surface } from "../../../shared/ui/Surface";
import { UsageBudgets } from "./UsageBudgets";
import { UsageActiveTime } from "./UsageActiveTime";
import { GrokLimits } from "./GrokLimits";

export function UsagePage({ limitsOnly = false }: { limitsOnly?: boolean }) {
  useLocale();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const reload = () => setRefresh((v) => v + 1);
    window.addEventListener(WORKSPACE_REFRESH_EVENT, reload);
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, reload);
  }, []);
  return (
    <div id="setting-account-limits" data-setting-id="account-limits" className="usage-page">
      {limitsOnly ? null : <UsageActiveTime />}
      <UsageOverview
        limitsOnly={limitsOnly}
        refresh={refresh}
        onRefresh={() => setRefresh((v) => v + 1)}
        limits={(filters) => <UsageLimits filters={filters} refresh={refresh} />}
      />
    </div>
  );
}

function UsageLimits({ filters, refresh }: { filters: UsageFilters; refresh: number }) {
  const [version, setVersion] = useState(0);
  const accounts = (["codex", "claude"] as const).flatMap(providerAccounts);
  const identities = useProviderAccountIdentities(accounts, refresh);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- refresh account rows on provider profile changes
  useEffect(() => subscribeProviderAccounts(() => setVersion((v) => v + 1)), []);
  const shown = accounts.filter(
    (account) =>
      (!filters.provider.length || filters.provider.includes(account.provider)) &&
      (!filters.account.length || filters.account.includes(`${account.provider}:${account.id}`)),
  );
  const showGrok =
    (!filters.provider.length || filters.provider.includes("grok")) &&
    (!filters.account.length || filters.account.includes("grok:default"));
  return (
    <div className="usage-limits-content" data-accounts-version={version}>
      <div className="usage-toolbar">
        <Heading size="section" level={2}>
          {t("Provider account limit")}
        </Heading>
        <UsageDisplaySettings />
      </div>
      <Surface variant="card" padding="none" dividers="card" className="usage-accounts">
        {shown.map((account) => (
          <AccountLimits
            key={identityKey(account)}
            provider={account.provider as RateLimitProvider}
            account={account}
            accounts={accounts}
            refresh={refresh}
            identity={identities[identityKey(account)]}
          />
        ))}
        {showGrok ? <GrokLimits refresh={refresh} /> : null}
        {!accounts.length || (!shown.length && !showGrok) ? (
          <EmptyState
            size="inline"
            kind="empty"
            description={
              accounts.length
                ? t("No accounts match the filters.")
                : t(
                    "No Claude or Codex accounts on this machine. Add an account in Providers settings.",
                  )
            }
          />
        ) : null}
      </Surface>
      <UsageBudgets refresh={refresh} />
    </div>
  );
}

function AccountLimits({
  provider,
  account,
  accounts,
  refresh,
  identity,
}: {
  provider: RateLimitProvider;
  account: ProviderAccount;
  accounts: readonly ProviderAccount[];
  refresh: number;
  identity?: ProviderAccountIdentity | null;
}) {
  useLocale();
  const { id: accountId } = account;
  const name = accountDisplayLabel(account, accounts, identity?.email);
  const showRemaining = useShowRemainingUsage();
  const limits = useCachedRateLimits(provider, accountId);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- sync this account's quota cache with the page refresh generation
  useEffect(() => {
    void loadRateLimits(provider, accountId, refresh > 0);
  }, [provider, accountId, refresh]);
  return (
    <UsageAccountRow
      provider={provider}
      account={account}
      name={name}
      limits={limits}
      showRemaining={showRemaining}
      color={providerAccountColorValue(account)}
      menu
      subtitle={
        <ProviderAccountSubtitle
          identity={identity}
          wrap
          size="caption"
          tone="secondary"
          className="usage-account-subtitle"
        />
      }
      retryLabel={`${t("Retry")}: ${name}`}
      onRetry={() => void loadRateLimits(provider, accountId, true)}
    />
  );
}
