import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "../../../shared/ui/icons";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import {
  accountStatus,
  accountUsageKey,
  useProviderAccountUsage,
} from "../../providers/model/accountUsage";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccountLabelIn,
  subscribeProviderAccounts,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import { useProviderAccounts } from "../../providers/public/useProviderAccounts";
import { AccountColorDot } from "../../providers/ui/AccountColorDot";
import { useModelSource } from "./modelSource";

/**
 * Accounts of one provider with their cached limit state. `pill` is the
 * composer-toolbar control; `notice` is the action on the usage-limit bar.
 * Hidden until there is a second account to pick.
 */
export function ProviderAccountMenu({
  variant,
  provider,
  accountId,
  onSelect,
  onClose,
}: {
  variant: "pill" | "notice";
  provider: ProviderAccountProvider;
  /** The session's current account. */
  accountId?: string;
  onSelect: (accountId: string) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const source = useModelSource();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const storedAccounts = useProviderAccounts(source.accounts === undefined ? provider : null);
  useEffect(() => subscribeProviderAccounts(() => setVersion((value) => value + 1)), []);
  const accounts =
    source.accounts === undefined ? storedAccounts : (source.accounts[provider] ?? []);
  const usage = useProviderAccountUsage(version, {
    provider,
    enabled: source.accounts === undefined && open && accounts.length > 1,
  });
  // A replacement may be the only account left after deleting the old one.
  if (
    accounts.length < 2 &&
    accounts.some((account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID))
  )
    return null;
  if (accounts.length === 0) return null;

  const label =
    source.accounts === undefined
      ? providerAccountLabelIn(storedAccounts, accountId, t)
      : (accounts.find((account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID))
          ?.label ?? t("Unavailable Host account"));
  const current = accounts.find(
    (account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID),
  );

  return (
    <>
      <Button
        className="max-w-28 shrink-0"
        variant="ghost"
        ref={trigger}
        type="button"
        tooltip={
          variant === "pill"
            ? t("Account: {p0}", { p0: label })
            : t("Continue this conversation with another account")
        }
        aria-label={variant === "pill" ? t("Account: {p0}", { p0: label }) : t("Switch account")}
        aria-expanded={open}
        aria-haspopup="menu"
        data-model-control={variant === "pill" ? true : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {current && storedAccounts.find((account) => account.id === current.id) ? (
          <AccountColorDot account={storedAccounts.find((account) => account.id === current.id)!} />
        ) : null}
        <span className={variant === "pill" ? "min-w-0 truncate text-ui-micro" : ""}>
          {variant === "pill" ? label : t("Switch account")}
        </span>
        <ChevronDown
          className={`icon-xs shrink-0 text-(--ui-text-secondary) ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          side="top"
          align={variant === "pill" ? "start" : "end"}
          width={260}
          label={variant === "pill" ? t("Account") : t("Continue with another account")}
          data-model-control
          items={accounts.map((account) => {
            const local = storedAccounts.find((entry) => entry.id === account.id);
            const status = local
              ? accountStatus(usage.usage[accountUsageKey(local)], usage.now)
              : undefined;
            return {
              kind: "item" as const,
              id: account.id,
              label: account.label,
              icon: local ? <AccountColorDot account={local} /> : undefined,
              description: status
                ? status.detail
                  ? `${status.label} · ${status.detail}`
                  : status.label
                : undefined,
              checked: account.id === accountId,
              selectionRole: "radio" as const,
            };
          })}
          onPick={(id) => {
            onClose?.();
            if (id !== accountId) onSelect(id);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
