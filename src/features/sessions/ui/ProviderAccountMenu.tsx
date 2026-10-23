import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  accountStatus,
  accountUsageKey,
  useProviderAccountUsage,
} from "../../providers/model/accountUsage";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  providerAccountLabel,
  providerAccounts,
  subscribeProviderAccounts,
  type ProviderAccountProvider,
} from "../../providers/model/providerAccounts";
import { AccountColorDot } from "../../providers/ui/AccountColorDot";
import { AccountStatusLabel } from "../../providers/ui/ProviderAccountUsage";

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
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => subscribeProviderAccounts(() => setVersion((value) => value + 1)), []);
  const accounts = providerAccounts(provider);
  const usage = useProviderAccountUsage(version, {
    provider,
    enabled: open && accounts.length > 1,
  });
  // A replacement may be the only account left after deleting the old one.
  if (
    accounts.length < 2 &&
    accounts.some((account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID))
  )
    return null;
  if (accounts.length === 0) return null;

  const label = providerAccountLabel(provider, accountId);
  const current = accounts.find(
    (account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID),
  );
  const dismiss = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) onClose?.();
  };

  return (
    <>
      <Button
        className="max-w-28 shrink-0"
        variant="ghost"
        ref={trigger}
        type="button"
        title={
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
        {current ? <AccountColorDot account={current} /> : null}
        <span className={variant === "pill" ? "min-w-0 truncate text-ui-micro" : ""}>
          {variant === "pill" ? label : t("Switch account")}
        </span>
        <ChevronDown
          className={`size-3 shrink-0 text-(--ui-text-secondary) ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          side="top"
          align={variant === "pill" ? "start" : "end"}
          width={260}
          autoFocus
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="menu"
          aria-label={variant === "pill" ? t("Account") : t("Continue with another account")}
          tabIndex={-1}
          data-model-control
          className="p-1 font-sans"
        >
          {accounts.map((account) => {
            const selected = account.id === accountId;
            const status = accountStatus(usage.usage[accountUsageKey(account)], usage.now);
            return (
              <Button
                fullWidth
                variant="item"
                key={account.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  dismiss(true);
                  if (!selected) onSelect(account.id);
                }}
                className="w-full text-left"
              >
                <AccountColorDot account={account} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate">{account.label}</span>
                  <span className="text-(length:--ui-font-caption)">
                    <AccountStatusLabel status={status} />
                  </span>
                </span>
                {selected ? (
                  <Check className="size-3.5 shrink-0 text-(--ui-text-secondary)" strokeWidth={2} />
                ) : null}
              </Button>
            );
          })}
        </Popover>
      ) : null}
    </>
  );
}
