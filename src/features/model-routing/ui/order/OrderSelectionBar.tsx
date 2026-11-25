import { useRef, useState } from "react";
import { useFormat, useT } from "../../../../shared/i18n";
import type {
  ModelRoutingEntry,
  ModelRoutingPool,
} from "../../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuAction } from "../../../../shared/ui/DropdownMenu";
import { LiveText } from "../../../../shared/ui/LiveText";
import { Trash2, X } from "../../../../shared/ui/icons";
import { effortChoices } from "./orderBulk";

function PickMenu({
  label,
  disabled,
  disabledReason,
  items,
  onPick,
}: {
  label: string;
  disabled: boolean;
  disabledReason?: string;
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
        disabledReason={disabled ? disabledReason : undefined}
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
      <LiveText
        size="secondary"
        text={t("{p0} selected", { p0: format.formatNumber(selected.length) })}
      />
      <Button size="sm" tone="danger" startIcon={<Trash2 className="icon-sm" />} onClick={onRemove}>
        {t("Remove")}
      </Button>
      <PickMenu
        label={t("Set effort…")}
        disabled={!efforts.length}
        disabledReason={t("The selected models have no effort setting.")}
        items={efforts.map(({ value, label }) => ({ kind: "item", id: value, label }))}
        onPick={onEffort}
      />
      <PickMenu
        label={t("Add to group…")}
        disabled={!pools.length}
        disabledReason={t("Create a group first.")}
        items={pools.map((pool) => ({
          kind: "item",
          id: pool.id,
          label: pool.name || t("Unnamed group"),
        }))}
        onPick={onAddToGroup}
      />
      <Button iconOnly size="sm" variant="ghost" label={t("Clear selection")} onClick={onClear}>
        <X className="icon-sm" />
      </Button>
    </div>
  );
}
