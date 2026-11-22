import { useDecisionTarget } from "./DecisionTarget";
import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuAction } from "../../../shared/ui/DropdownMenu";
import {
  Plus,
  FolderOpen,
  File,
  Download,
  KeyRound,
  Globe,
} from "../../../shared/ui/icons";
/** The four ways to add a source; the dialogs for each live beside this menu. */
export type AddPath = "folder" | "manual" | "local" | "api" | "custom";
/** One primary action; the four paths sit in this menu. */
export function AddMenu({
  onPick,
  disabled = false,
}: {
  onPick: (path: AddPath) => void;
  disabled?: boolean;
}) {
  const target = useDecisionTarget();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const items: DropdownMenuAction[] = [
    {
      kind: "item",
      id: "folder",
      icon: <FolderOpen aria-hidden="true" />,
      label: t("Add from folder"),
      description: t("Find a model and its runtime inside a folder."),
    },
    {
      kind: "item",
      id: "manual",
      icon: <File aria-hidden="true" />,
      label: t("Add from a file or address"),
      description: t("Connect a model file, or the address of a running service."),
    },
    {
      kind: "item",
      id: "local",
      icon: <Download aria-hidden="true" />,
      label: target ? t("Install on Host {p1}", { p1: target }) : t("Install on this computer"),
      description: t("Download a model that runs locally."),
    },
    {
      kind: "item",
      id: "api",
      icon: <KeyRound aria-hidden="true" />,
      label: t("API provider"),
      description: t("Use a provider with your own key."),
    },
    {
      kind: "item",
      id: "custom",
      icon: <Globe aria-hidden="true" />,
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
        {t("Add model")}
      </Button>
      {anchor ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Add a decision model")}
          items={items}
          align="end"
          size="lg"
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
