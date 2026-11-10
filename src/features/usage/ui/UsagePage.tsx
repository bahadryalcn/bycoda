import { LoadingText } from "../../../shared/ui/LoadingText";
import { Alert } from "../../../shared/ui/Alert";
import { UsageMeter } from "../../../shared/ui/UsageMeter";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import "./UsagePage.css";
import { RefreshCw, MoreHorizontal } from "../../../shared/ui/icons";
import { WORKSPACE_REFRESH_EVENT } from "../../../app/shell/WorkspaceControls";
import {
  providerAccounts,
  PROVIDER_ACCOUNT_COLORS,
  setProviderAccountColor,
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
import { usageLabel } from "./UsageVisualizations";
import { UsageDisplaySettings } from "./UsageDisplaySettings";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { useShowRemainingUsage } from "../../settings/model/displayPrefs";
import {
  identityKey,
  useProviderAccountIdentities,
  type ProviderAccountIdentity,
} from "../../providers/model/providerAccountIdentity";
import { ProviderAccountSubtitle } from "../../providers/ui/ProviderAccountSubtitle";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Button } from "../../../shared/ui/Button";
import { UsageBudgets } from "./UsageBudgets";
import { UsageActiveTime } from "./UsageActiveTime";

export function UsagePage({ limitsOnly = false }: { limitsOnly?: boolean }) {
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
      className="usage-page"
    >
      {limitsOnly ? null : <UsageActiveTime />}
      <UsageOverview
        limitsOnly={limitsOnly}
        refresh={refresh}
        limits={(filters) => (
          <div className="usage-limits-content">
            <div className="usage-toolbar">
              <h2>{t("Provider account limit")}</h2>
              <UsageDisplaySettings />
              <Button
                className="shrink-0"
                variant="ghost"
                iconOnly
                label={t("Refresh usage")}
                tooltip={t("Refresh usage")}
                onClick={() => setRefresh((v) => v + 1)}
              >
                <RefreshCw aria-hidden className="icon-sm" strokeWidth={1.75} />
              </Button>
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
                <p className="text-ui-caption text-(--ui-text-secondary)">
                  {t("No accounts on this machine. Add an account in Providers settings.")}
                </p>
              ) : null}
            </div>
            <UsageBudgets refresh={refresh} />
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
  const locale = useLocale();
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { id: accountId } = account;
  const label = usageLabel(account.label);
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
          <h3>
            <HarnessIcon harness={provider} className="icon-sm shrink-0" />
            <span className="sr-only">{provider === "codex" ? t("Codex") : t("Claude")}</span>
            <span className="min-w-0 truncate">{label}</span>
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
            className="text-ui-caption text-(--ui-text-secondary)"
          />
        </div>
        {limits.updatedAt > 0 ? (
          <span className="usage-account-observed">
            <span className="sr-only">{t("Last observed")}: </span>
            <Timestamp
              value={limits.updatedAt}
              format="relative"
              relativeStyle="short"
              title={`${t("Last observed")}: ${new Date(limits.updatedAt).toLocaleString(locale)}`}
            />
          </span>
        ) : null}
        <Button
          ref={menuButton}
          variant="ghost"
          iconOnly
          label={t("Account actions")}
          tooltip={t("Account actions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal aria-hidden className="icon-sm" />
        </Button>
        {menuOpen ? (
          <DropdownMenu
            anchor={menuButton}
            label={t("Account color")}
            items={[
              {
                kind: "group",
                id: "color",
                label: t("Color"),
                items: PROVIDER_ACCOUNT_COLORS.map((option) => ({
                  kind: "item" as const,
                  id: option.id,
                  label: t(option.label),
                  checked: account.color === option.id,
                  icon: (
                    <span className="size-2.5 rounded-full" style={{ background: option.value }} />
                  ),
                })),
              },
              { kind: "item", id: "default", label: t("Default"), checked: !account.color },
            ]}
            onPick={(id) => {
              setProviderAccountColor(
                account.provider,
                account.id,
                PROVIDER_ACCOUNT_COLORS.find((option) => option.id === id)?.id,
              );
              setMenuOpen(false);
            }}
            onClose={() => setMenuOpen(false)}
          />
        ) : null}
      </div>
      <div className="usage-quota-list">
        {windows.map(({ kind, window }) => {
          const used = clampUsedPercent(window.usedPercent);
          const shown = showRemaining ? 100 - used : used;
          const direction = showRemaining ? "remaining" : "used";
          return (
            <div key={kind} className="usage-quota">
              <div className="usage-quota-heading">
                <h4>
                  {t(
                    kind === "session" && window.windowMinutes === 300
                      ? "5 hours"
                      : kind === "session"
                        ? "Session"
                        : kind === "weekly"
                          ? "Weekly"
                          : "Monthly",
                  )}
                  <span className="usage-quota-reset">
                    {window.resetsAt == null
                      ? t("Reset time unavailable")
                      : formatResetCountdown(window.resetsAt - now)}
                  </span>
                </h4>
                <p>
                  <strong>{Math.round(shown)}%</strong>
                  <span>{showRemaining ? t("left") : t("used")}</span>
                </p>
              </div>
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
            </div>
          );
        })}
      </div>
      {limits.error ? (
        <div className="usage-account-error">
          <Alert inline tone="danger">
            {limits.error}
          </Alert>
          <Button
            size="sm"
            variant="ghost"
            label={`${t("Retry")}: ${label}`}
            loading={limits.status === "fetching"}
            onClick={() => void loadRateLimits(provider, accountId, true)}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : null}
      {windows.length > 0 && (limits.status === "fetching" || limits.status === "idle") ? (
        <LoadingText presentation="text" className="text-ui-caption text-(--ui-text-secondary)">
          {t("Refreshing account limits… Previous limits remain visible.")}
        </LoadingText>
      ) : null}
      {!windows.length && !limits.error ? (
        <p className="text-ui-caption text-(--ui-text-muted)">
          {label}:{" "}
          {limits.status === "fetching" || limits.status === "idle"
            ? t("Loading account limits…")
            : t("Account limits unavailable.")}
        </p>
      ) : null}
    </section>
  );
}
