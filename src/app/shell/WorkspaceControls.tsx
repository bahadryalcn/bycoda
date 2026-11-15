import { useRef, useState } from "react";
import { DropdownMenu, type DropdownMenuItem } from "../../shared/ui/DropdownMenu";
import { Button } from "../../shared/ui/Button";
import { Text } from "../../shared/ui/Text";
import { useT } from "../../shared/i18n";
import { RefreshCw, MoreHorizontal } from "../../shared/ui/icons";
import { FullscreenButton } from "./FullscreenButton";
import { SoundsButton } from "../../features/notifications/ui/SoundsButton";

export const WORKSPACE_REFRESH_EVENT = "bycoda:refresh-workspace-view";

/** The Usage glyph lives with the shared icons; this re-export keeps existing imports working. */
export { UsageIcon } from "../../shared/ui/icons";

export function WorkspaceControls({ canRefresh = true }: { canRefresh?: boolean }) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const items: DropdownMenuItem[] = [
    {
      kind: "item",
      id: "refresh",
      label: t("Refresh current view"),
      icon: <RefreshCw className="icon-sm" />,
      disabled: !canRefresh,
    },
  ];
  return (
    <Text
      as="nav"
      size="inherit"
      tone="secondary"
      aria-label={t("Workspace controls")}
      className="ml-auto flex shrink-0 items-center justify-end gap-1"
    >
      <Button
        ref={anchor}
        iconOnly
        label={t("Workspace controls")}
        variant="ghost"
        motion="none"
        aria-haspopup="menu"
        expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal className="icon-sm" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Workspace controls")}
          side="top"
          items={items}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            if (id === "refresh") window.dispatchEvent(new Event(WORKSPACE_REFRESH_EVENT));
          }}
        />
      ) : null}
      <SoundsButton />
      <FullscreenButton />
    </Text>
  );
}
