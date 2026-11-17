import { useRef, useState } from "react";
import { useFormat, useT } from "../../../../shared/i18n";
import type {
  ModelRoutingEntry,
  ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuAction } from "../../../../shared/ui/DropdownMenu";
import { Text } from "../../../../shared/ui/Text";
import { Trash2, X } from "../../../../shared/ui/icons";
import { effortChoices } from "./orderBulk";

function PickMenu({
  label,
  disabled,
  items,
  onPick,
}: {
  label: string;
  disabled: boolean;
  items: DropdownMenuAction[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={label}
          align="start"
          items={items}
          onPick={onPick}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** What can be done to the selected rows at once; Escape or Clear drops the selection. */
export function OrderSelectionBar({
  selected,
  pools,
  onRemove,
  onEffort,
  onAddToGroup,
  onClear,
}: {
  selected: readonly ModelRoutingEntry[];
  pools: readonly ModelRoutingPool[];
  onRemove: () => void;
  onEffort: (value: string) => void;
  onAddToGroup: (poolId: string) => void;
  onClear: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const efforts = effortChoices(selected);
  return (
    <div
      role="toolbar"
      aria-label={t("Selected models")}
      className="flex flex-wrap items-center gap-2 px-4 py-2"
    >
      <Text size="secondary" aria-live="polite">
        {t("{p0} selected", { p0: format.formatNumber(selected.length) })}
      </Text>
      <Button size="sm" tone="danger" startIcon={<Trash2 className="icon-sm" />} onClick={onRemove}>
        {t("Remove")}
      </Button>
      <PickMenu
        label={t("Set effort…")}
        disabled={!efforts.length}
        items={efforts.map(({ value, label }) => ({ kind: "item", id: value, label }))}
        onPick={onEffort}
      />
      <PickMenu
        label={t("Add to group…")}
        disabled={!pools.length}
        items={pools.map((pool) => ({
          kind: "item",
          id: pool.id,
          label: pool.name || t("Unnamed group"),
        }))}
        onPick={onAddToGroup}
      />
      <Button size="sm" variant="ghost" startIcon={<X className="icon-sm" />} onClick={onClear}>
        {t("Clear selection")}
      </Button>
    </div>
  );
}
