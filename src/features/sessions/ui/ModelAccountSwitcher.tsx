import { useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import { formatNumber } from "../../../shared/i18n/core";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Meter } from "../../../shared/ui/Meter";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Check, ChevronDown } from "../../../shared/ui/icons";
import { formatResetDuration } from "../../../shared/i18n/format";
import { accountUsageKey, useProviderAccountUsage } from "../../providers/public/accountUsage";
import {
  providerAccountColorValue,
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
  type ProviderAccount,
} from "../../providers/public/providerAccounts";
import { accountDisplayLabel } from "../model/accountModelChoices";
import { accountSwitcherKind, accountUsageSummary } from "../model/modelPanelData";
import type { HarnessId } from "../model/session";
import { useModelSource } from "./modelSource";

/** Usage at or above these shares reads as running low, then nearly exhausted. */
const USAGE_WARNING = 75;
const USAGE_DANGER = 90;

type PanelAccount = {
  id: string;
  label: string;
  /** Local profiles carry a colour and usage; Host catalogs only name their accounts. */
  local?: ProviderAccount;
  usedPercent: number | null;
  resetsAt: number | null;
  status?: string;
};

/**
 * One provider's accounts with their cached usage. Any provider with account profiles gets
 * the same control; Host catalogs list only the Host's accounts and carry no local usage.
 */
export function usePanelAccounts(harness: HarnessId, active: boolean) {
  const t = useT();
  const source = useModelSource();
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeProviderAccounts(() => setVersion((value) => value + 1)), []);
  const provider = supportsProviderAccounts(harness) ? harness : undefined;
  const local = source.accounts === undefined;
  const raw: readonly { id: string; label: string }[] = !provider
    ? []
    : local
      ? providerAccounts(provider)
      : (source.accounts?.[provider] ?? []);
  const usage = useProviderAccountUsage(version, {
    provider,
    enabled: active && local && provider != null && raw.length > 1,
  });
  const accounts: PanelAccount[] = raw.map((account) => {
    const profile = local ? (account as ProviderAccount) : undefined;
    const limits = profile ? usage.usage[accountUsageKey(profile)] : undefined;
    const summary = accountUsageSummary(limits, usage.now);
    // Fixed wording only: a provider's raw error text never reaches the list.
    const status = !profile
      ? undefined
      : !limits || limits.status === "idle" || limits.status === "fetching"
        ? t("Checking…")
        : limits.status === "unavailable"
          ? t("Not signed in")
          : limits.status === "error"
            ? t("Usage unavailable")
            : undefined;
    return {
      id: account.id,
      label: accountDisplayLabel(raw, account),
      local: profile,
      ...summary,
      status,
    };
  });
  return { accounts, now: usage.now };
}

function AccountDot({ account }: { account: PanelAccount }) {
  return account.local ? (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ background: providerAccountColorValue(account.local) }}
      aria-hidden
    />
  ) : null;
}

function Percent({ value }: { value: number | null }) {
  if (value == null) return null;
  return (
    <span className="shrink-0 tabular-nums ui-caption-text">
      {formatNumber(value / 100, { style: "percent", maximumFractionDigits: 0 })}
    </span>
  );
}

/** The control beside the provider title: label, two-way switch or a button for the list. */
export function ModelAccountControl({
  accounts,
  accountId,
  listOpen,
  onSelect,
  onToggleList,
}: {
  accounts: PanelAccount[];
  accountId: string;
  listOpen: boolean;
  onSelect: (accountId: string) => void;
  onToggleList: () => void;
}) {
  const t = useT();
  const kind = accountSwitcherKind(accounts.length);
  const current = accounts.find((account) => account.id === accountId);
  if (kind === "none") return null;
  if (kind === "label") {
    const only = accounts[0];
    return (
      <span data-model-account-label className="flex min-w-0 items-center gap-1.5 ui-caption-text">
        <AccountDot account={only} />
        <span className="min-w-0 truncate">{only.label}</span>
        <Percent value={only.usedPercent} />
      </span>
    );
  }
  if (kind === "switch") {
    return (
      <SegmentedControl
        label={t("Account")}
        className="min-w-0"
        value={accountId}
        onValueChange={onSelect}
        options={accounts.map((account) => ({
          value: account.id,
          label: account.label,
          icon: <AccountDot account={account} />,
          accessory: <Percent value={account.usedPercent} />,
        }))}
      />
    );
  }
  const label = current?.label ?? t("Unavailable Host account");
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      className="min-w-0 max-w-[65%]"
      data-model-account-menu
      aria-haspopup="listbox"
      aria-expanded={listOpen}
      aria-label={t("Account: {p0}", { p0: label })}
      tooltip={t("Account: {p0}", { p0: label })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggleList}
    >
      {current ? <AccountDot account={current} /> : null}
      <span className="min-w-0 truncate">{label}</span>
      <Percent value={current?.usedPercent ?? null} />
      <span className="shrink-0 border-l border-(--ui-tone-neutral-border) pl-1.5 ui-caption-text">
        {formatNumber(accounts.length)}
      </span>
      <ChevronDown
        className={`icon-xs shrink-0 text-(--ui-text-secondary) ${listOpen ? "rotate-180" : ""}`}
        strokeWidth={1.75}
      />
    </Button>
  );
}

/** The account list that takes the model list's place; searchable from six accounts. */
export function ModelAccountList({
  accounts,
  accountId,
  now,
  onSelect,
}: {
  accounts: PanelAccount[];
  accountId: string;
  now: number;
  onSelect: (accountId: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const searchable = accountSwitcherKind(accounts.length) === "search";
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? accounts.filter((account) => account.label.toLocaleLowerCase().includes(needle))
    : accounts;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-model-account-list>
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
        <div className="px-2 py-3 ui-caption-text">{t("No matching accounts")}</div>
      ) : (
        <RadioGroup
          variant="tiles"
          label={t("Accounts")}
          value={accountId}
          keepFocus
          className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
          tileClassName="w-full text-left"
          tile={{ fullWidth: true }}
          options={shown.map((account) => {
            const selected = account.id === accountId;
            const detail =
              account.status ??
              (account.resetsAt != null
                ? t("Resets in {p0}", { p0: formatResetDuration(account.resetsAt - now) })
                : undefined);
            return {
              value: account.id,
              content: (
                <>
                  <AccountDot account={account} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate leading-4">{account.label}</span>
                    {detail ? (
                      <span
                        className={`block truncate text-ui-micro leading-4 ${
                          (account.usedPercent ?? 0) >= USAGE_DANGER
                            ? "text-(--ui-tone-danger-fg)"
                            : "text-(--ui-text-secondary)"
                        }`}
                      >
                        {detail}
                      </span>
                    ) : null}
                  </span>
                  {account.usedPercent != null ? (
                    <span className="flex w-16 shrink-0 flex-col items-end gap-0.5">
                      <Meter
                        className="w-full"
                        value={account.usedPercent}
                        warning={USAGE_WARNING}
                        danger={USAGE_DANGER}
                        tone="accent"
                        label={t("Usage of {p0}", { p0: account.label })}
                      />
                      <Percent value={account.usedPercent} />
                    </span>
                  ) : null}
                  {selected ? (
                    <Check
                      className="icon-sm shrink-0 text-(--ui-text-secondary)"
                      strokeWidth={2}
                    />
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
    </div>
  );
}
