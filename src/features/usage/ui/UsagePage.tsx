import { EmptyState } from "../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { InlineError } from "../../../shared/ui/InlineError";
import { UsageMeter } from "../../../shared/ui/UsageMeter";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
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
import { UsageProviderIdentity } from "./UsageProviderIdentity";
import { UsageOverview } from "./UsageOverview";
import type { UsageFilters } from "../model/usageAnalytics";
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
import { Heading } from "../../../shared/ui/Heading";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
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
        limits={(filters) => (
          <UsageLimits
            filters={filters}
            refresh={refresh}
            onRefresh={() => setRefresh((v) => v + 1)}
          />
        )}
      />
    </div>
  );
}

function UsageLimits({
  filters,
  refresh,
  onRefresh,
}: {
  filters: UsageFilters;
  refresh: number;
  onRefresh: () => void;
}) {
  const [version, setVersion] = useState(0);
  const accounts = (["codex", "claude"] as const).flatMap(providerAccounts);
  const identities = useProviderAccountIdentities(accounts, refresh);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- refresh account rows on provider profile changes
  useEffect(() => subscribeProviderAccounts(() => setVersion((v) => v + 1)), []);
  return (
    <div className="usage-limits-content" data-accounts-version={version}>
      <div className="usage-toolbar">
        <Heading size="section">{t("Provider account limit")}</Heading>
        <UsageDisplaySettings />
        <Button
          className="shrink-0"
          variant="ghost"
          iconOnly
          label={t("Refresh usage")}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden className="icon-sm" strokeWidth={1.75} />
        </Button>
      </div>
      <Surface variant="card" padding="none" dividers="card" className="usage-accounts">
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
        {(!filters.provider.length || filters.provider.includes("grok")) &&
        (!filters.account.length || filters.account.includes("grok:default")) ? (
          <GrokLimits refresh={refresh} />
        ) : null}
        {!accounts.length ? (
          <EmptyState
            size="inline"
            kind="empty"
            description={t(
              "No Claude or Codex accounts on this machine. Add an account in Providers settings.",
            )}
          />
        ) : null}
      </Surface>
      <UsageBudgets refresh={refresh} />
    </div>
  );
}

/**
 * Reset countdown on the shared minute clock. Only this text re-renders each
 * minute, and the clock stops while the window is hidden, so the account
 * section itself never re-renders for time alone.
 */
function ResetCountdown({ resetsAt }: { resetsAt: number }) {
  const tick = useMinuteNow();
  const [mountedAt] = useState(Date.now);
  return <>{formatResetCountdown(resetsAt - (tick || mountedAt))}</>;
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
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { id: accountId } = account;
  const label = usageLabel(account.label);
  const showRemaining = useShowRemainingUsage();
  const color = providerAccountColorValue(account);
  const limits = useCachedRateLimits(provider, accountId);
  useEffect(() => {
    void loadRateLimits(provider, accountId, refresh > 0);
  }, [provider, accountId, refresh]);
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
        <div className="usage-account-identity">
          <Heading size="item" level={3}>
            <Text size="inherit" tone="secondary" className="usage-account-provider">
              <UsageProviderIdentity provider={provider} />
            </Text>
            <span className="usage-account-name">{label}</span>
            {account.isDefault && label !== t("Default account") ? (
              <Text
                size="caption"
                tone="muted"
                weight="regular"
                leading="inherit"
                className="usage-account-default"
              >
                {t("Default account")}
              </Text>
            ) : null}
          </Heading>
          <ProviderAccountSubtitle
            identity={identity}
            wrap
            fallback={
              identity === undefined
                ? t("Loading account identity…")
                : t("Account identity unavailable")
            }
            size="caption"
            tone="secondary"
            className="usage-account-subtitle"
          />
        </div>
        {limits.updatedAt > 0 ? (
          <Text size="caption" tone="muted" leading="inherit" className="usage-account-observed">
            <span className="sr-only">{t("Last observed")}: </span>
            <Timestamp
              value={limits.updatedAt}
              format="relative"
              relativeStyle="short"
              title={t("Last observed: {p0}", {
                p0: formatDate(limits.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
              })}
            />
          </Text>
        ) : null}
        <Button
          ref={menuButton}
          variant="ghost"
          iconOnly
          label={t("Account actions")}
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
                    <span
                      {...surfaceAttributes({ radius: "pill", variant: "user-color" }, "size-2.5")}
                      style={{ "--surface-user-color": option.value } as CSSProperties}
                    />
                  ),
                })),
              },
              {
                kind: "item",
                id: "default",
                label: t("Use automatic color"),
                checked: !account.color,
              },
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
          const direction = showRemaining ? t("left") : t("used");
          const windowLabel = t(
            kind === "session" && window.windowMinutes === 300
              ? "5 hours"
              : kind === "session"
                ? "Session"
                : kind === "weekly"
                  ? "Weekly"
                  : "Monthly",
          );
          return (
            <div key={kind} className="usage-quota">
              <Text
                as="div"
                size="caption"
                tone="inherit"
                leading="inherit"
                className="usage-quota-heading"
              >
                <SectionLabel as="h4" classNames={{ label: "usage-quota-title" }}>
                  {windowLabel}
                  <Text size="inherit" tone="muted" weight="regular" className="usage-quota-reset">
                    {window.resetsAt == null ? (
                      t("Reset time unavailable")
                    ) : (
                      <>
                        <ResetCountdown resetsAt={window.resetsAt} />
                        <br />
                        <Timestamp
                          value={window.resetsAt}
                          format="datetime-seconds"
                          tooltip={false}
                        />
                      </>
                    )}
                  </Text>
                </SectionLabel>
                <Text as="p" size="inherit" tone="secondary">
                  <Text as="strong" size="body" tone="primary" weight="medium" leading="inherit">
                    {Math.round(shown)}%
                  </Text>
                  <span>{showRemaining ? t("left") : t("used")}</span>
                </Text>
              </Text>
              <UsageMeter
                label={`${label} · ${windowLabel} · ${direction}`}
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
        <InlineError
          className="usage-account-error"
          retry={{
            label: `${t("Retry")}: ${label}`,
            pending: limits.status === "fetching",
            onRetry: () => void loadRateLimits(provider, accountId, true),
          }}
        >
          {limits.error}
        </InlineError>
      ) : null}
      {windows.length > 0 && (limits.status === "fetching" || limits.status === "idle") ? (
        <LoadingText size="caption" tone="secondary">
          {t("Refreshing account limits… Previous limits remain visible.")}
        </LoadingText>
      ) : null}
      {!windows.length && !limits.error ? (
        <Text as="p" tone="muted">
          {label}:{" "}
          {limits.status === "fetching" || limits.status === "idle"
            ? t("Loading account limits…")
            : t("Account limits unavailable.")}
        </Text>
      ) : null}
    </section>
  );
}
