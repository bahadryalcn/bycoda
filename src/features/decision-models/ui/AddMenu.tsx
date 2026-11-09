import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuAction } from "../../../shared/ui/DropdownMenu";
import { Plus } from "../../../shared/ui/icons";

/** The four ways to add a source; the dialogs for each live beside this menu. */
export type AddPath = "manual" | "local" | "api" | "custom";

/** One primary action; the four paths sit in this menu. */
export function AddMenu({
  onPick,
  disabled = false,
}: {
  onPick: (path: AddPath) => void;
  disabled?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const items: DropdownMenuAction[] = [
    {
      kind: "item",
      id: "manual",
      label: t("From a file or address"),
      description: t("A model file or a running address on this computer."),
    },
    {
      kind: "item",
      id: "local",
      label: t("Install on this computer"),
      description: t("Download a model that runs locally."),
    },
    {
      kind: "item",
      id: "api",
      label: t("API provider"),
      description: t("Use a provider with your own key."),
    },
    {
      kind: "item",
      id: "custom",
      label: t("Custom endpoint"),
      description: t("Any address that answers the decision contract."),
    },
  ];
  return (
    <>
      <Button
        variant="primary"
        size="sm"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        startIcon={<Plus aria-hidden="true" />}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {t("Add")}
      </Button>
      {anchor ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Add a decision model")}
          items={items}
          align="end"
          onPick={(id) => {
            setAnchor(null);
            onPick(id as AddPath);
          }}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </>
  );
}
