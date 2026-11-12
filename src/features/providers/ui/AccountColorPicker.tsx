import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useRef, useState } from "react";
import { ColorSwatchRow } from "../../../shared/ui/ColorPickerPopover";
import { Popover, type PopoverAnchor } from "../../../shared/ui/Popover";
import {
  setProviderAccountColor,
  providerAccountColor,
  PROVIDER_ACCOUNT_COLORS,
  type ProviderAccount,
  type ProviderAccountColor,
} from "../model/providerAccounts";
import { AccountColorDot } from "./AccountColorDot";

/** Swatch popover for one account, anchored to any trigger (a button or an overflow menu). */
export function AccountColorPopover({
  account,
  anchor,
  onDismiss,
  onPick,
}: {
  account: ProviderAccount;
  anchor: PopoverAnchor;
  onDismiss: () => void;
  onPick?: (color: ProviderAccountColor | undefined) => void;
}) {
  useLocale();
  const current = providerAccountColor(account);
  const pick = (color: ProviderAccountColor | undefined) => {
    if (onPick) onPick(color);
    else setProviderAccountColor(account.provider, account.id, color);
    onDismiss();
  };
  return (
    <Popover
      anchor={anchor}
      side="bottom"
      align="start"
      autoFocus
      onDismiss={onDismiss}
      role="dialog"
      aria-label={t("Color for {p0}", { p0: account.label })}
      tabIndex={-1}
      className="p-2"
    >
      <ColorSwatchRow
        colors={PROVIDER_ACCOUNT_COLORS.map((color) => color.value)}
        labels={PROVIDER_ACCOUNT_COLORS.map((color) => color.label)}
        colorIndex={PROVIDER_ACCOUNT_COLORS.findIndex((color) => color.id === current.id)}
        onPickIndex={(index) => pick(PROVIDER_ACCOUNT_COLORS[index].id)}
      />
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
  );
}

/** Dot that opens a swatch popover to colour one account. */
export function AccountColorPicker({
  account,
  disabled,
  onPick,
}: {
  account: ProviderAccount;
  disabled?: boolean;
  /** Draft editor callback; omit to persist immediately from account rows. */
  onPick?: (color: ProviderAccountColor | undefined) => void;
}) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = providerAccountColor(account);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        ref={trigger}
        type="button"
        disabled={disabled}
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
        <AccountColorPopover
          onPick={onPick}
          account={account}
          anchor={trigger}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
