import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { FilterTrigger } from "../../../shared/ui/FilterTrigger";
import { Popover } from "../../../shared/ui/Popover";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";

/** Search and status in one popover; the trigger's own reset clears both. */
export function AutomationFilter({
  query,
  status,
  onQueryChange,
  onStatusChange,
  onReset,
}: {
  query: string;
  status: string;
  onQueryChange: (query: string) => void;
  onStatusChange: (status: string) => void;
  onReset: () => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const activeCount = (query.trim() ? 1 : 0) + (status !== "all" ? 1 : 0);
  return (
    <>
      <FilterTrigger
        ref={button}
        type="button"
        label={t("Filter automations")}
        activeCount={activeCount}
        onReset={onReset}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <Popover
          anchor={button}
          kind="dialog"
          aria-label={t("Filter automations")}
          onDismiss={() => setOpen(false)}
          size="md"
          variant="panel"
          className="space-y-2"
        >
          <TextField
            label={t("Filter automations")}
            type="search"
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <SearchableSelect
            hideLabel
            label={t("Status")}
            value={status}
            searchable={false}
            options={[
              { value: "all", label: t("All") },
              { value: "active", label: t("Active") },
              { value: "paused", label: t("Paused") },
              { value: "attention", label: t("Needs attention") },
            ]}
            onChange={onStatusChange}
          />
        </Popover>
      ) : null}
    </>
  );
}
