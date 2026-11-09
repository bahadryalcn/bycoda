import type { RefObject } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { Settings } from "../../../shared/ui/icons";
import {
  MESSAGING_PROVIDER_LABELS,
  toggleListValue,
  type MessageFilters,
} from "../model/messageThreads";
import type { MessagingAccount, MessagingProvider } from "../model/messagingTypes";
import { isMessagingProviderEnabled } from "../model/messagingProviders";
import { MessagingProviderMark } from "./MessagingProviderMark";

const MANAGE_ID = "manage";

/** Account and provider filters; checkbox rows keep the menu open while toggling. */
export function MessagesFilterMenu({
  anchor,
  accounts,
  filters,
  onChange,
  onManageAccounts,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  accounts: readonly MessagingAccount[];
  filters: MessageFilters;
  onChange: (filters: MessageFilters) => void;
  onManageAccounts: () => void;
  onClose: () => void;
}) {
  useLocale();
  const providers = [...new Set(accounts.map((account) => account.provider))].filter(
    isMessagingProviderEnabled,
  );
  const items: DropdownMenuItem[] = [];
  if (providers.length > 1)
    items.push({
      kind: "group",
      id: "providers",
      label: t("Providers"),
      items: providers.map((provider) => ({
        kind: "item",
        id: `provider:${provider}`,
        label: t(MESSAGING_PROVIDER_LABELS[provider]),
        icon: <MessagingProviderMark provider={provider} className="block icon-sm shrink-0" />,
        checked: !filters.hiddenProviders.includes(provider),
        selectionRole: "checkbox",
      })),
    });
  if (accounts.length > 1)
    items.push({
      kind: "group",
      id: "accounts",
      label: t("Accounts"),
      items: accounts.map((account) => ({
        kind: "item",
        id: `account:${account.id}`,
        label: account.label || account.identity || t(MESSAGING_PROVIDER_LABELS[account.provider]),
        description:
          account.label && account.identity !== account.label ? account.identity : undefined,
        icon: (
          <MessagingProviderMark provider={account.provider} className="block icon-sm shrink-0" />
        ),
        checked: !filters.hiddenAccountIds.includes(account.id),
        selectionRole: "checkbox",
      })),
    });
  if (items.length > 0) items.push({ kind: "sep" });
  items.push({
    kind: "item",
    id: MANAGE_ID,
    label: t("Manage messaging accounts"),
    icon: <Settings className="icon-sm" strokeWidth={1.75} />,
  });

  return (
    <DropdownMenu
      anchor={anchor}
      returnFocusRef={anchor}
      label={t("Filter messages")}
      width={260}
      items={items}
      onClose={onClose}
      onPick={(id) => {
        // Plain rows close the menu before onPick; checkbox rows stay open.
        if (id === MANAGE_ID) onManageAccounts();
        else if (id.startsWith("provider:")) {
          const provider = id.slice("provider:".length) as MessagingProvider;
          onChange({
            ...filters,
            hiddenProviders: toggleListValue(filters.hiddenProviders, provider),
          });
        } else if (id.startsWith("account:")) {
          const accountId = id.slice("account:".length);
          onChange({
            ...filters,
            hiddenAccountIds: toggleListValue(filters.hiddenAccountIds, accountId),
          });
        }
      }}
    />
  );
}
