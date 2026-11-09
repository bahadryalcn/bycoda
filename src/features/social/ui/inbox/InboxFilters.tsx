import { useRef, useState, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { DropdownMenu, type DropdownMenuItem } from "../../../../shared/ui/DropdownMenu";
import { FilterTrigger } from "../../../../shared/ui/FilterTrigger";
import { SearchInput } from "../../../../shared/ui/SearchInput";
import { INBOX_STATUSES, type InboxFilterState, type InboxStatus } from "./inboxTypes";
import { statusText } from "./inboxModel";
import "./inbox.css";

export type InboxAccountOption = { value: string; label: string };

const STATUS_PREFIX = "status:";
const ACCOUNT_PREFIX = "account:";

/**
 * One toolbar row: search, a filter popover (status and account) and trailing controls.
 * Changing any filter resets the list to its first page.
 */
export function InboxFilters({
  value,
  accounts,
  onChange,
  children,
}: {
  value: InboxFilterState;
  accounts: InboxAccountOption[];
  onChange(next: InboxFilterState): void;
  /** Controls at the end of the row (the auto-refresh switch). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const activeCount = (value.status !== "all" ? 1 : 0) + (value.accountId !== "" ? 1 : 0);

  const items: DropdownMenuItem[] = [
    {
      kind: "group",
      id: "status",
      label: t("Status"),
      items: [
        { value: "all", label: t("All") },
        ...INBOX_STATUSES.map((status: InboxStatus) => ({
          value: status,
          label: statusText(status),
        })),
      ].map((option) => ({
        kind: "item" as const,
        id: `${STATUS_PREFIX}${option.value}`,
        label: option.label,
        checked: value.status === option.value,
        selectionRole: "radio" as const,
      })),
    },
    { kind: "sep" },
    {
      kind: "group",
      id: "account",
      label: t("Account"),
      items: [{ value: "", label: t("All accounts") }, ...accounts].map((option) => ({
        kind: "item" as const,
        id: `${ACCOUNT_PREFIX}${option.value}`,
        label: option.label,
        checked: value.accountId === option.value,
        selectionRole: "radio" as const,
      })),
    },
  ];

  const pick = (id: string) => {
    setOpen(false);
    if (id.startsWith(STATUS_PREFIX))
      onChange({ ...value, status: id.slice(STATUS_PREFIX.length) as InboxFilterState["status"] });
    else if (id.startsWith(ACCOUNT_PREFIX))
      onChange({ ...value, accountId: id.slice(ACCOUNT_PREFIX.length) });
  };

  return (
    <div className="inbox-toolbar">
      <SearchInput
        containerClassName="inbox-search"
        aria-label={t("Search conversations")}
        appearance="field"
        type="search"
        value={value.query}
        placeholder={t("Name, message or tag")}
        onChange={(event) => onChange({ ...value, query: event.target.value })}
      />
      <FilterTrigger
        ref={trigger}
        label={t("Filter conversations")}
        activeCount={activeCount}
        onReset={() => onChange({ ...value, status: "all", accountId: "" })}
        resetLabel={t("Clear filters")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <DropdownMenu
          anchor={trigger}
          label={t("Filter conversations")}
          returnFocusRef={trigger}
          align="start"
          onClose={() => setOpen(false)}
          items={items}
          onPick={pick}
        />
      ) : null}
      {children ? <div className="inbox-toolbar-end">{children}</div> : null}
    </div>
  );
}
