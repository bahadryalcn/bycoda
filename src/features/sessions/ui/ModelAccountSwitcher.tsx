/** Different job: Account rows combine live quota meters and account status; RadioGroup owns selection and keyboard focus. */
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Divider } from "../../../shared/ui/Divider";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { UsageMeter } from "../../../shared/ui/UsageMeter";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { Check } from "../../../shared/ui/icons";
import {
  accountUsageKey,
  providerAccountSignedOut,
  useProviderAccountUsage,
} from "../../providers/public/accountUsage";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../providers/public/providerAccounts";
import { modelAccountIdentities } from "../model/accountModelChoices";
import { ModelAccountNumber, type ModelAccountIdentity } from "./ModelAccountIdentity";
import {
  accountSwitcherKind,
  accountUsageSummary,
  type AccountUsageSummary,
} from "../model/modelPanelData";
import type { HarnessId } from "../model/session";
import { useModelSource } from "./modelSource";

/** Usage at or above these shares reads as running low, then nearly exhausted. */
const USAGE_WARNING = 75;
const USAGE_DANGER = 90;

type PanelAccount = ModelAccountIdentity & {
  id: string;
  label: string;
  usedPercent: number | null;
  resetsAt: number | null;
  limitReason?: string;
  status?: string;
};

export type AccountLimitReason = (harness: HarnessId, accountId?: string) => string | undefined;

/** The Accounts rows and all model choices share one snapshot of local account usage. */
export function usePickerAccountUsage(accountsVersion: string, enabled: boolean) {
  const t = useT();
  const { formatResetDuration } = useFormat();
  const { usage, now: minuteNow } = useProviderAccountUsage(accountsVersion, { enabled });
  const [resetTick, setResetTick] = useState(0);
  const now = Math.max(minuteNow, resetTick);
  const summaries = new Map<string, AccountUsageSummary>();
  let nextReset = Infinity;
  if (enabled) {
    for (const [key, limits] of Object.entries(usage)) {
      const summary = accountUsageSummary(limits, now);
      summaries.set(key, summary);
      if (summary.exhausted && summary.resetsAt != null) {
        nextReset = Math.min(nextReset, summary.resetsAt);
      }
    }
  }
  // Cross the actual reset instant. The existing clock handles longer countdowns.
  useEffect(() => {
    if (nextReset > now + 60_000) return;
    const timer = setTimeout(() => setResetTick(Date.now()), Math.max(0, nextReset - Date.now()));
    return () => clearTimeout(timer);
  }, [nextReset, now]);
  const limitReason: AccountLimitReason = (harness, id = DEFAULT_PROVIDER_ACCOUNT_ID) => {
    const summary = summaries.get(`${harness}:${id}`);
    if (!summary?.exhausted) return undefined;
    return summary.resetsAt == null
      ? t("Limit reached")
      : t("Limit reached · resets in {p0}", { p0: formatResetDuration(summary.resetsAt - now) });
  };
  return { usage, summaries, now, limitReason };
}

/**
 * One provider's accounts with their cached usage. Any provider with account profiles gets
 * the same control; Host catalogs list only the Host's accounts and carry no local usage.
 */
export function usePanelAccounts(
  harness: HarnessId | undefined,
  { usage, summaries, limitReason }: ReturnType<typeof usePickerAccountUsage>,
) {
  const t = useT();
  const source = useModelSource();
  const provider = harness && supportsProviderAccounts(harness) ? harness : undefined;
  const local = source.accounts === undefined;
  // Local profiles live in browser storage, so React reads them through their store.
  const localAccounts: ProviderAccount[] = JSON.parse(
    useSyncExternalStore(
      subscribeProviderAccounts,
      () => (provider && local ? JSON.stringify(providerAccounts(provider)) : "[]"),
      () => (provider && local ? JSON.stringify(providerAccounts(provider)) : "[]"),
    ),
  );
  const raw: readonly { id: string; label: string }[] = !provider
    ? []
    : local
      ? localAccounts
      : (source.accounts?.[provider] ?? []);
  const identities = harness ? modelAccountIdentities(harness, raw) : [];
  const accounts: PanelAccount[] = raw.map((account, index) => {
    const profile = local ? (account as ProviderAccount) : undefined;
    const key = profile ? accountUsageKey(profile) : undefined;
    const limits = key ? usage[key] : undefined;
    const summary = key ? summaries.get(key) : undefined;
    // Fixed wording only: a provider's raw error text never reaches the list.
    const status = !profile
      ? undefined
      : !limits || limits.status === "idle" || limits.status === "fetching"
        ? t("Checking…")
        : providerAccountSignedOut(limits)
          ? t("Not signed in")
          : limits.status === "error" || limits.status === "unavailable"
            ? t("Usage unavailable")
            : undefined;
    return {
      ...identities[index],
      id: account.id,
      label: identities[index]?.accountLabel ?? account.label,
      usedPercent: summary?.usedPercent ?? null,
      resetsAt: summary?.resetsAt ?? null,
      limitReason: provider ? limitReason(provider, account.id) : undefined,
      status,
    };
  });
  return accounts;
}

/** Share of the account's limit used. */
function Percent({ value }: { value: number | null }) {
  const { formatNumber } = useFormat();
  const t = useT();
  if (value == null) return null;
  const percent = formatNumber(value / 100, { style: "percent", maximumFractionDigits: 0 });
  return (
    <span className="shrink-0 tabular-nums ui-caption-text">
      {percent} {t("used")}
    </span>
  );
}

/** Marks the account containing this project's default model. */
function DefaultMark() {
  const t = useT();
  return (
    <Text size="micro" tone="secondary">
      {t("Default model")}
    </Text>
  );
}

/** Disclosure for providers with more accounts than fit above the models. */
export function ModelAccountControl({
  accounts,
  accountId,
  defaultAccountId,
  listOpen,
  onToggleList,
}: {
  accounts: PanelAccount[];
  accountId: string;
  /** Account the default model lives on, when it is on this provider. */
  defaultAccountId?: string;
  listOpen: boolean;
  onToggleList: () => void;
}) {
  const t = useT();
  const { formatNumber } = useFormat();
  const current = accounts.find((account) => account.id === accountId);
  const implicitAccount = !current && accountId === DEFAULT_PROVIDER_ACCOUNT_ID;
  const label = current?.label ?? t("Unavailable Host account");
  // The default lives on another account: hint at it so the path to it stays visible.
  const elsewhere =
    defaultAccountId && defaultAccountId !== accountId
      ? accounts.find((account) => account.id === defaultAccountId)
      : undefined;
  const used =
    current?.usedPercent != null
      ? ` · ${formatNumber(current.usedPercent / 100, { style: "percent", maximumFractionDigits: 0 })} ${t("used")}`
      : "";
  const name = elsewhere
    ? `${t("Account: {p0}", { p0: label })}${used} · ${t("Default: {p0}", { p0: elsewhere.label })}`
    : `${t("Account: {p0}", { p0: label })}${used}`;
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      fullWidth
      align="start"
      motion="none"
      className="min-w-0 flex-1"
      data-model-account-menu
      expanded={listOpen}
      aria-label={listOpen || implicitAccount ? undefined : name}
      tooltip={listOpen || implicitAccount ? undefined : name}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggleList}
    >
      {!listOpen ? <ModelAccountNumber account={current} /> : null}
      <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1 text-start">
        {listOpen || implicitAccount ? t("Accounts") : label}
      </Text>
      {!listOpen && elsewhere ? <StatusDot data-model-default-elsewhere /> : null}
      {!listOpen ? <Percent value={current?.usedPercent ?? null} /> : null}
    </Button>
  );
}

/** Account list shown above the models; searchable from six accounts. */
export function ModelAccountList({
  accounts,
  accountId,
  defaultAccountId,
  now,
  inline,
  onSelect,
}: {
  accounts: PanelAccount[];
  accountId: string;
  defaultAccountId?: string;
  now: number;
  inline: boolean;
  onSelect: (accountId: string) => void;
}) {
  const t = useT();
  const { formatResetDuration } = useFormat();
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reveal the opened account controls even when models are scrolled to the bottom.
  useLayoutEffect(() => {
    if (!inline) list.current?.scrollIntoView?.({ block: "nearest" });
  }, [inline]);
  const searchable = accountSwitcherKind(accounts.length) === "search";
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? accounts.filter((account) => account.label.toLocaleLowerCase().includes(needle))
    : accounts;
  return (
    <div ref={list} className="shrink-0" data-model-account-list>
      {searchable ? (
        <div className="px-2 pt-1 pb-1.5">
          <SearchInput
            type="search"
            appearance="field"
            autoFocus
            aria-label={t("Find account")}
            placeholder={t("Find account")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState
          size="inline"
          kind="filtered"
          inset="row"
          className="ui-caption-text"
          description={t("No matching accounts")}
        />
      ) : (
        <RadioGroup
          variant="tiles"
          label={inline ? t("Account") : t("Accounts")}
          value={accountId}
          keepFocus
          className="grid min-w-0 gap-0.5"
          tileClassName="min-w-0 text-start"
          tile={{ fullWidth: true }}
          options={shown.map((account) => {
            const selected = account.id === accountId;
            const detail =
              account.limitReason ??
              account.status ??
              (account.resetsAt != null
                ? t("Resets in {p0}", { p0: formatResetDuration(account.resetsAt - now) })
                : undefined);
            return {
              value: account.id,
              disabled: !!account.limitReason,
              content: (
                <>
                  <ModelAccountNumber account={account} />
                  <span className="min-w-0 flex-1">
                    <Text
                      as="span"
                      size="inherit"
                      tone="inherit"
                      leading="snug"
                      className="flex min-w-0 flex-wrap items-baseline gap-x-1.5"
                    >
                      <Text
                        data-model-account-name
                        size="inherit"
                        tone="inherit"
                        leading="snug"
                        weight="medium"
                        wrap="anywhere"
                        className="min-w-0"
                      >
                        {account.label}
                      </Text>
                      {account.id === defaultAccountId ? (
                        <Text
                          data-model-default-account
                          size="micro"
                          tone="secondary"
                          wrap="anywhere"
                        >
                          <DefaultMark />
                        </Text>
                      ) : null}
                    </Text>
                    {detail ? (
                      <Text
                        as="span"
                        size="micro"
                        tone={(account.usedPercent ?? 0) >= USAGE_DANGER ? "danger" : "secondary"}
                        wrap="anywhere"
                        className="block"
                      >
                        {detail}
                      </Text>
                    ) : null}
                  </span>
                  {account.usedPercent != null ? (
                    <span className="grid w-max min-w-14 shrink-0 justify-items-end gap-0.5">
                      <Percent value={account.usedPercent} />
                      <UsageMeter
                        compact
                        showLegend={false}
                        decimals={0}
                        className="w-full"
                        segments={[
                          { id: "usage", label: account.label, value: account.usedPercent },
                        ]}
                        limit={100}
                        tone={
                          account.usedPercent >= USAGE_DANGER
                            ? "danger"
                            : account.usedPercent >= USAGE_WARNING
                              ? "warning"
                              : "accent"
                        }
                        label={t("Usage of {p0}", { p0: account.label })}
                      />
                    </span>
                  ) : null}
                  {selected ? (
                    <Check className="icon-sm shrink-0" tone="secondary" />
                  ) : (
                    <span className="size-3.5 shrink-0" aria-hidden />
                  )}
                </>
              ),
            };
          })}
          onValueChange={onSelect}
        />
      )}
      <Divider decorative inset="sm" />
    </div>
  );
}
