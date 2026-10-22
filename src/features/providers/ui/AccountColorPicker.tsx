import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useRef, useState } from "react";
import { Check } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import {
  setProviderAccountColor,
  providerAccountColor,
  PROVIDER_ACCOUNT_COLORS,
  type ProviderAccount,
  type ProviderAccountColor,
} from "../model/providerAccounts";
import { AccountColorDot } from "./AccountColorDot";

/** Dot that opens a swatch popover to colour one account. */
export function AccountColorPicker({
  account,
  disabled,
}: {
  account: ProviderAccount;
  disabled?: boolean;
}) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = providerAccountColor(account);
  const pick = (color: ProviderAccountColor | undefined) => {
    setProviderAccountColor(account.provider, account.id, color);
    setOpen(false);
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        ref={trigger}
        type="button"
        disabled={disabled}
        title={t("Account color")}
        aria-label={t("Color for {p0}: {p1}", { p0: account.label, p1: current.label })}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex shrink-0 items-center gap-1.5"
      >
        <AccountColorDot account={account} className="size-2.5" />
        <span>{t("Color")}</span>
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          side="bottom"
          align="start"
          autoFocus
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label={t("Color for {p0}", { p0: account.label })}
          tabIndex={-1}
          className="p-2"
        >
          <div className="grid grid-cols-3 gap-1">
            {PROVIDER_ACCOUNT_COLORS.map((color) => {
              const selected = current.id === color.id;
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  key={color.id}
                  type="button"
                  title={color.label}
                  aria-label={color.label}
                  aria-pressed={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(color.id)}
                  className="flex items-center gap-2"
                >
                  <span
                    className="grid size-4 place-items-center rounded-full"
                    style={{ background: color.value }}
                  >
                    {selected ? (
                      <Check className="size-2.5 text-on-solid" strokeWidth={3} aria-hidden />
                    ) : null}
                  </span>
                  <span>{color.label}</span>
                </Button>
              );
            })}
          </div>
          {account.color ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(undefined)}
              className="mt-1.5 w-full"
            >
              {t("Use automatic color")}
            </Button>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}
