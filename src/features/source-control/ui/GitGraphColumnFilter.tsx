import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { TextField } from "../../../shared/ui/TextField";
import { ListFilter } from "../../../shared/ui/icons";
import { t } from "../../../shared/i18n/git";
import { EMPTY_HISTORY_FILTERS, type GitHistoryFilters } from "../model/gitHistoryFilters";

export function GitGraphColumnFilter({
  label,
  field,
  filters,
  onChange,
}: {
  label: string;
  field: "subject" | "author" | "date" | "sha";
  filters: GitHistoryFilters;
  onChange: (filters: GitHistoryFilters) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const keys = field === "date" ? (["after", "before"] as const) : [field];
  const active = keys.some((key) => filters[key].trim());
  const name = t("Filter {p0}", { p0: label });
  return (
    <>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate">{label}</span>
        <Button
          variant="ghost"
          motion="none"
          iconOnly
          label={name}
          selected={active}
          aria-pressed={active}
          aria-expanded={!!anchor}
          aria-haspopup="dialog"
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <ListFilter className="size-3" />
        </Button>
      </span>
      {anchor ? (
        <Popover
          anchor={anchor}
          width={280}
          role="dialog"
          aria-label={name}
          onDismiss={() => setAnchor(null)}
        >
          <div className="flex flex-col gap-3 p-3">
            <span className="text-xs font-medium">{name}</span>
            <span className="text-xs text-[var(--ui-text-secondary)]">
              {t("Filters apply to loaded commits")}
            </span>
            {keys.map((key) => (
              <TextField
                key={key}
                label={key === "after" ? t("From date") : key === "before" ? t("To date") : label}
                type={field === "date" ? "date" : "text"}
                value={filters[key]}
                autoFocus={key === keys[0]}
                onChange={(event) => onChange({ ...filters, [key]: event.target.value })}
              />
            ))}
            <Button
              variant="ghost"
              disabled={!Object.values(filters).some((value) => value.trim())}
              onClick={() => onChange(EMPTY_HISTORY_FILTERS)}
            >
              {t("Reset all filters")}
            </Button>
            <Button
              variant="secondary"
              disabled={!active}
              onClick={() =>
                onChange({ ...filters, ...Object.fromEntries(keys.map((key) => [key, ""])) })
              }
            >
              {t("Reset filter")}
            </Button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
