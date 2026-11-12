import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { Popover } from "../../../shared/ui/Popover";
import { TextField } from "../../../shared/ui/TextField";
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
  const activeCount = keys.filter((key) => filters[key].trim()).length;
  const active = activeCount > 0;
  const name = t("Filter {p0}", { p0: label });
  return (
    <>
      <span className="flex min-w-0 items-center gap-1">
        <Text size="inherit" tone="inherit" truncate>
          {label}
        </Text>
        <FilterTrigger
          label={name}
          activeCount={activeCount}
          aria-expanded={!!anchor}
          aria-haspopup="dialog"
          onClick={(event) => setAnchor(event.currentTarget)}
        />
      </span>
      {anchor ? (
        <Popover
          anchor={anchor}
          width={280}
          kind="dialog"
          aria-label={name}
          onDismiss={() => setAnchor(null)}
        >
          <div className="flex flex-col gap-3 p-3">
            <Text as="span" size="caption" tone="inherit" weight="medium">
              {name}
            </Text>
            <Text size="caption" tone="secondary">
              {t("Filters apply to loaded commits")}
            </Text>
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
