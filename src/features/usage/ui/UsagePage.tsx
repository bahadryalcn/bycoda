import { Alert } from "../../../shared/ui/Alert";
import { UsageMeter } from "../../../shared/ui/UsageMeter";
import { t, useLocale } from "../../../shared/i18n";
import { useContext, useEffect, useState } from "react";
import { RevealedSetting } from "../../settings/ui/settingsControls";
import "./UsagePage.css";
import { RefreshCw } from "../../../shared/ui/icons";
import { WORKSPACE_REFRESH_EVENT } from "../../../app/shell/WorkspaceControls";
import {
  providerAccounts,
  providerAccountColorValue,
  type ProviderAccount,
  subscribeProviderAccounts,
} from "../../providers/model/providerAccounts";
import { loadRateLimits, useCachedRateLimits } from "../../providers/model/rateLimitsCache";
import {
  clampUsedPercent,
  formatResetCountdown,
  type RateLimitProvider,
} from "../../providers/model/rateLimits";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { UsageOverview } from "./UsageOverview";
import { UsageDisplaySettings } from "./UsageDisplaySettings";
import { AccountColorPicker } from "../../providers/ui/AccountColorPicker";
import { useShowRemainingUsage } from "../../settings/model/displayPrefs";
import {
  identityKey,
  useProviderAccountIdentities,
  type ProviderAccountIdentity,
} from "../../providers/model/providerAccountIdentity";
import { ProviderAccountSubtitle } from "../../providers/ui/ProviderAccountSubtitle";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { UsageBudgets } from "./UsageBudgets";

export function UsagePage({ limitsOnly = false }: { limitsOnly?: boolean }) {
  useLocale();
  const revealed = useContext(RevealedSetting);
  const [version, setVersion] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const accounts = (["codex", "claude"] as const).flatMap(providerAccounts);
  const identities = useProviderAccountIdentities(accounts, refresh);
  useEffect(() => subscribeProviderAccounts(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    const reload = () => setRefresh((v) => v + 1);
    window.addEventListener(WORKSPACE_REFRESH_EVENT, reload);
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, reload);
  }, []);
  return (
    <div
      id="setting-account-limits"
      data-setting-id="account-limits"
      data-accounts-version={version}
      className="usage-page"
    >
      <UsageOverview
        limitsOnly={limitsOnly}
        refresh={refresh}
        limits={(filters) => (
          <div className="usage-limits-content">
            <div className="usage-toolbar">
              <h2>{t("Provider account limit")}</h2>
              <SecondaryButton
                aria-label={t("Refresh usage")}
                title={t("Refresh usage")}
                onClick={() => setRefresh((v) => v + 1)}
              >
                <RefreshCw className="size-3.5" />
                {t("Refresh usage")}
              </SecondaryButton>
            </div>
            <div className="usage-accounts">
              {accounts
                .filter(
                  (account) =>
                    (!filters.provider.length || filters.provider.includes(account.provider)) &&
                    (!filters.account.length ||
                      filters.account.includes(`${account.provider}:${account.id}`)),
                )
                .map((account) => (
                  <AccountLimits
                    key={identityKey(account)}
                    provider={account.provider as RateLimitProvider}
                    account={account}
                    refresh={refresh}
                    identity={identities[identityKey(account)]}
                  />
                ))}
              {!accounts.length ? (
                <p className="text-xs text-content/60">
                  {t("No accounts on this machine. Add an account in Providers settings.")}
                </p>
              ) : null}
            </div>
            <UsageBudgets refresh={refresh} />
            <details
              className="usage-display-preferences"
              open={revealed === "show-remaining-usage" || undefined}
            >
              <summary>{t("Display preferences")}</summary>
              <UsageDisplaySettings />
            </details>
          </div>
        )}
      />
    </div>
  );
}

function AccountLimits({
  provider,
  account,
  refresh,
  identity,
}: {
  provider: RateLimitProvider;
  account: ProviderAccount;
  refresh: number;
  identity?: ProviderAccountIdentity | null;
}) {
  useLocale();
  const { id: accountId, label } = account;
  const showRemaining = useShowRemainingUsage();
  const color = providerAccountColorValue(account);
  const limits = useCachedRateLimits(provider, accountId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    void loadRateLimits(provider, accountId, refresh > 0);
  }, [provider, accountId, refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const windows = (["session", "weekly", "monthly"] as const).flatMap((kind) =>
    limits[kind] ? [{ kind, window: limits[kind]! }] : [],
  );
  return (
    <section
      className="usage-account"
      aria-label={`${provider === "codex" ? t("Codex") : t("Claude")} · ${label}`}
      aria-busy={limits.status === "fetching" || limits.status === "idle"}
    >
      <div className="usage-account-heading">
        <div className="min-w-0">
          <div className="usage-account-provider">
            <HarnessIcon harness={provider} className="size-3.5" />
            {provider === "codex" ? t("Codex") : t("Claude")}
          </div>
          <h3>
            {label}
            {account.isDefault && label !== t("Default account") ? (
              <span className="usage-account-default">{t("Default account")}</span>
            ) : null}
          </h3>
          <ProviderAccountSubtitle
            identity={identity}
            fallback={
              identity === undefined
                ? t("Loading account identity…")
                : t("Account identity unavailable")
            }
            className="text-xs text-content/60"
          />
        </div>
        <AccountColorPicker account={account} />
      </div>
      <div className="usage-quota-list">
        {windows.map(({ kind, window }) => {
          const used = clampUsedPercent(window.usedPercent);
          const shown = showRemaining ? 100 - used : used;
          const direction = showRemaining ? "remaining" : "used";
          return (
            <div key={kind} className="usage-quota">
              <div className="usage-quota-heading">
                <h4 className="text-xs font-medium">
                  {t(
                    kind === "session" && window.windowMinutes === 300
                      ? "5 hours"
                      : kind === "session"
                        ? "Session"
                        : kind === "weekly"
                          ? "Weekly"
                          : "Monthly",
                  )}
                </h4>
                <p>
                  <strong>{Math.round(shown)}%</strong>
                  <span>{showRemaining ? t("left") : t("used")}</span>
                </p>
              </div>
              <div>
                <UsageMeter
                  label={`${label} ${kind} ${direction}`}
                  segments={[{ id: "used", label: t("used"), value: used }]}
                  limit={100}
                  unit="%"
                  decimals={0}
                  compact
                  showLegend={false}
                  showRemaining={showRemaining}
                  color={color}
                />
                <div className="usage-quota-reset">
                  <span>
                    {window.resetsAt == null
                      ? t("Reset time unavailable")
                      : formatResetCountdown(window.resetsAt - now)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {limits.error ? (
        <Alert tone="danger" role="alert">
          {label}: {limits.error}
        </Alert>
      ) : null}
      {windows.length > 0 && (limits.status === "fetching" || limits.status === "idle") ? (
        <Alert tone="info" role="status">
          {t("Refreshing account limits… Previous limits remain visible.")}
        </Alert>
      ) : null}
      {!windows.length && !limits.error ? (
        <p className="rounded-xl border border-stroke p-4 text-xs text-content/50">
          {label}:{" "}
          {limits.status === "fetching" || limits.status === "idle"
            ? t("Loading account limits…")
            : t("Account limits unavailable.")}
        </p>
      ) : null}
    </section>
  );
}
