import { useRef, useState } from "react";
import { useT } from "../../../../shared/i18n";
import { HARNESS_TITLE } from "../../../../shared/model/harnessIdentity";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { HarnessIcon } from "../../../../shared/ui/identity/HarnessIcon";
import { MoreHorizontal } from "../../../../shared/ui/icons";
import { Text } from "../../../../shared/ui/Text";
import { AccountColorDot } from "../../../providers/public/accountIdentity";
import { PROVIDER_ACCOUNT_COLORS } from "../../../providers/public/providerAccounts";
import type { AccountGroup } from "./orderGrouping";

/** The account a run of rows belongs to: colour, name, provider, live quota and account actions. */
export function AccountGroupHeader({
  group,
  quota,
  selection,
  onSelectAll,
  onRemoveAll,
  onAddAll,
}: {
  group: AccountGroup;
  /** Live quota text of the account, already resolved. */
  quota: string;
  /** How many of the group's rows are selected. */
  selection: number;
  onSelectAll: (selected: boolean) => void;
  onRemoveAll: () => void;
  onAddAll: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const { account, harness, rows } = group;
  const label =
    account?.label ??
    (group.accountId && group.accountId !== "default" && group.accountsKnown !== false
      ? t("Unavailable account")
      : HARNESS_TITLE[harness]);
  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-1">
      <Checkbox
        checked={selection === rows.length}
        indeterminate={selection > 0 && selection < rows.length}
        aria-label={t("Select all models of {p0}", { p0: label })}
        onChange={(event) => onSelectAll(event.currentTarget.checked)}
      />
      {account ? (
        <AccountColorDot
          account={{
            id: account.id,
            provider: harness,
            color: PROVIDER_ACCOUNT_COLORS.find((color) => color.id === account.color)?.id,
          }}
        />
      ) : null}
      <HarnessIcon harness={harness} size="sm" />
      <Text size="secondary" weight="medium" truncate className="min-w-0">
        {label}
      </Text>
      <Text size="caption" tone="secondary" className="ms-auto whitespace-nowrap">
        {quota}
      </Text>
      <Button
        ref={anchor}
        iconOnly
        variant="ghost"
        size="sm"
        label={t("More for {p0}", { p0: label })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="icon-sm" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("More for {p0}", { p0: label })}
          align="end"
          items={[
            { kind: "item", id: "add", label: t("Add all models of this account") },
            { kind: "item", id: "remove", label: t("Remove this account's models"), danger: true },
          ]}
          onPick={(id) => (id === "remove" ? onRemoveAll() : onAddAll())}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
