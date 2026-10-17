import { Alert } from "../../../shared/ui/Alert";
import { UsageMeter } from "../../../shared/ui/UsageMeter";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
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
import { ProviderUsageSettings } from "../../settings/ui/ProviderUsageSettings";
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

export function UsagePage() {
  useLocale();
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
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-content/50">
          {t(
            "This machine · provider account limits. Local session estimates are shown separately below.",
          )}
        </p>
        <SecondaryButton
          aria-label={t("Refresh usage")}
          title={t("Refresh usage")}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw className="size-3.5" />
          {t("Refresh usage")}
        </SecondaryButton>
      </div>
      {(["codex", "claude"] as const).map((provider) => (
        <section key={provider} className="mb-7">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <HarnessIcon harness={provider} className="size-4" />
            {provider === "codex" ? t("Codex") : t("Claude")}
          </h2>
          <div className="space-y-3">
            {accounts
              .filter((account) => account.provider === provider)
              .map((account) => (
                <AccountLimits
                  key={account.id}
                  provider={provider}
                  account={account}
                  refresh={refresh}
                  identity={identities[identityKey(account)]}
                />
              ))}
            {!accounts.some((account) => account.provider === provider) ? (
              <p className="text-xs text-content/60">
                {t("No accounts on this machine. Add an account in Providers settings.")}
              </p>
            ) : null}
          </div>
        </section>
      ))}
      <UsageBudgets refresh={refresh} />
      <UsageOverview refresh={refresh} />
      <ProviderUsageSettings refresh={refresh} showSummary={false} />
      <UsageDisplaySettings />
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
    <div className="space-y-3" aria-busy={limits.status === "fetching" || limits.status === "idle"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-xs font-medium">
            {label}
            {account.isDefault ? (
              <span className="ms-2 text-content/60">{t("Default account")}</span>
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
      {windows.map(({ kind, window }) => {
        const used = clampUsedPercent(window.usedPercent);
        const shown = showRemaining ? 100 - used : used;
        const direction = showRemaining ? "remaining" : "used";
        return (
          <div
            key={kind}
            className="grid gap-4 rounded-xl border border-stroke p-4 sm:grid-cols-[180px_1fr]"
          >
            <div>
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
              <p className="mt-2">
                <strong className="text-3xl font-semibold tabular-nums">
                  {Math.round(shown)}%
                </strong>
                <span className="ml-2 text-xs text-content/50">
                  {showRemaining ? t("left") : t("used")}
                </span>
              </p>
            </div>
            <div className="flex flex-col justify-center gap-2">
              <UsageMeter
                label={`${label} ${kind} ${direction}`}
                segments={[{ id: "used", label: t("used"), value: used }]}
                limit={100}
                unit="%"
                decimals={0}
                compact
                showRemaining={showRemaining}
                color={color}
              />
              <div className="flex flex-wrap justify-between gap-2 text-xs text-content/60">
                <span>{t("Provider account limit")}</span>
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
    </div>
  );
}
