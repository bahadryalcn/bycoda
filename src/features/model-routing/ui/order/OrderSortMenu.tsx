import { useRef, useState } from "react";
import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { ListFilter } from "../../../../shared/ui/icons";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import { sortOrderDraft } from "../../model/smartSetup";

/** Re-sorts the order draft by intelligence or cost; the owner reviews and saves. */
export function OrderSortMenu({
  disabled,
  onEdit,
}: {
  disabled: boolean;
  onEdit: (operation: (draft: OrderDraft) => OrderDraft) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        startIcon={<ListFilter className="icon-sm" />}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {t("Sort")}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Sort")}
          items={[
            { kind: "item", id: "intelligence", label: t("Smartest first") },
            { kind: "item", id: "cost", label: t("Cheapest first") },
          ]}
          onPick={(id) =>
            onEdit((draft) => sortOrderDraft(draft, id === "cost" ? "cost" : "intelligence"))
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
