import { Button } from "../../../shared/ui/Button";
import { useFormat, useT } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Text } from "../../../shared/ui/Text";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import {
  accountStatusWith,
  accountUsageKey,
  providerAccountSignedOut,
  useProviderAccountUsage,
} from "../../providers/model/accountUsage";
import {
  defaultProviderAccountIdIn,
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
  const format = useFormat();
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
  const currentId = accountId ?? defaultProviderAccountIdIn(accounts);
  // A replacement may be the only account left after deleting the old one.
  if (accounts.length < 2 && accounts.some((account) => account.id === currentId)) return null;
  if (accounts.length === 0) return null;

  const label =
    source.accounts === undefined
      ? providerAccountLabelIn(storedAccounts, currentId, t)
      : (accounts.find((account) => account.id === currentId)?.label ??
        t("Unavailable Host account"));
  const current = accounts.find((account) => account.id === currentId);

  return (
    <>
      <Button
        className={variant === "pill" ? "max-w-28 shrink-0" : "max-w-full"}
        size={variant === "notice" ? "sm" : undefined}
        variant={variant === "notice" ? "secondary" : "ghost"}
        ref={trigger}
        type="button"
        tooltip={variant === "pill" ? t("Account: {p0}", { p0: label }) : undefined}
        aria-label={variant === "pill" ? t("Account: {p0}", { p0: label }) : t("Switch account")}
        expanded={open}
        aria-haspopup="menu"
        data-model-control={variant === "pill" ? true : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        {variant === "pill" &&
        current &&
        storedAccounts.find((account) => account.id === current.id) ? (
          <AccountColorDot account={storedAccounts.find((account) => account.id === current.id)!} />
        ) : null}
        <Text
          as="span"
          size={variant === "pill" ? "micro" : "inherit"}
          tone="inherit"
          truncate={variant === "pill"}
          className={variant === "pill" ? "min-w-0" : undefined}
        >
          {variant === "pill" ? label : t("Switch account")}
        </Text>
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          side="top"
          align={variant === "pill" ? "start" : "end"}
          size="md"
          label={variant === "pill" ? t("Account") : t("Accounts")}
          data-model-control
          items={accounts.map((account) => {
            const local = storedAccounts.find((entry) => entry.id === account.id);
            const limits = local ? usage.usage[accountUsageKey(local)] : undefined;
            const status = local ? accountStatusWith(limits, usage.now, t, format) : undefined;
            const statusLabel =
              status?.tone === "unknown"
                ? limits && providerAccountSignedOut(limits)
                  ? t("Not signed in")
                  : t("Usage unavailable")
                : status && t(status.label);
            return {
              kind: "item" as const,
              id: account.id,
              label: account.label,
              icon: local ? <AccountColorDot account={local} /> : undefined,
              description: status
                ? status.detail
                  ? `${statusLabel} · ${status.detail}`
                  : statusLabel
                : undefined,
              checked: account.id === currentId,
              selectionRole: "radio" as const,
            };
          })}
          onPick={(id) => {
            onClose?.();
            if (id !== currentId) onSelect(id);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
