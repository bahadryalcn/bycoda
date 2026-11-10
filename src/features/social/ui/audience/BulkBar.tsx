import { useRef, useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import "./audience.css";

type BulkMenuItem = { kind: "item"; id: string; label: string; danger?: boolean };

export type BulkBarProps = {
  count: number;
  items: readonly BulkMenuItem[];
  onClear: () => void;
  onPick: (id: string) => void;
  /** Blocks every action while a bulk action runs. */
  disabled?: boolean;
};

/** Selection bar above the people table: how many are selected, clear, and the bulk actions menu. */
export function BulkBar({ count, items, onClear, onPick, disabled }: BulkBarProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="audience-bulk" role="group" aria-label={t("Selected people")}>
      <span className="audience-bulk-count">{t("{p0} selected", { p0: formatNumber(count) })}</span>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onClear}>
        {t("Clear selection")}
      </Button>
      <Button
        ref={button}
        variant="secondary"
        size="sm"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {t("Actions")}
      </Button>
      {open && !disabled ? (
        <DropdownMenu
          anchor={button}
          label={t("Actions for selected people")}
          returnFocusRef={button}
          onClose={() => setOpen(false)}
          items={[...items]}
          onPick={(id) => {
            setOpen(false);
            onPick(id);
          }}
        />
      ) : null}
    </div>
  );
}
