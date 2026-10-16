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
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        title={t("Account color")}
        aria-label={t("Color for {p0}: {p1}", { p0: account.label, p1: current.label })}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-content/10 px-2 text-[11px] text-content/70 hover:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
      >
        <AccountColorDot account={account} className="size-2.5" />
        <span>{t("Color")}</span>
      </button>
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
                <button
                  key={color.id}
                  type="button"
                  title={color.label}
                  aria-label={color.label}
                  aria-pressed={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(color.id)}
                  className="flex h-9 items-center gap-2 rounded-md px-2 text-xs hover:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent"
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
                </button>
              );
            })}
          </div>
          {account.color ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(undefined)}
              className="mt-1.5 w-full rounded-md px-2 py-1 text-left text-[11px] text-content/55 hover:bg-content/10 hover:text-content"
            >
              {t("Use automatic color")}
            </button>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}
