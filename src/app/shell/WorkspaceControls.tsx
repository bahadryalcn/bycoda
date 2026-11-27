import { useRef, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../shared/ui/DropdownMenu";
import { Text } from "../../shared/ui/Text";
import { useT } from "../../shared/i18n";
import { AudioLines, Maximize2, Minimize2, MoreHorizontal, RefreshCw } from "../../shared/ui/icons";
import { FullscreenButton, useFullscreenToggle } from "./FullscreenButton";
import { SoundsButton, useSoundsToggle } from "../../features/notifications/ui/SoundsButton";

export const WORKSPACE_REFRESH_EVENT = "bycoda:refresh-workspace-view";

/** The Usage glyph lives with the shared icons; this re-export keeps existing imports working. */
export { UsageIcon } from "../../shared/ui/icons";

const refreshView = () => window.dispatchEvent(new Event(WORKSPACE_REFRESH_EVENT));

/**
 * Window-wide controls sit inline when the workspace footer has room and fold into one
 * overflow menu when it is narrow. Both forms stay mounted; the `footer` container query
 * shows one, so a resize never re-renders.
 */
export function WorkspaceControls({ canRefresh = true }: { canRefresh?: boolean }) {
  const t = useT();
  return (
    <Text
      as="nav"
      size="inherit"
      tone="secondary"
      aria-label={t("Workspace controls")}
      className="ml-auto flex shrink-0 items-center justify-end gap-1"
    >
      <div className="hidden items-center gap-1 @min-[40rem]/footer:flex">
        <Button
          iconOnly
          label={t("Refresh current view")}
          variant="ghost"
          motion="none"
          type="button"
          data-workspace-control="refresh"
          data-tauri-drag-region="false"
          disabled={!canRefresh}
          disabledReason={canRefresh ? undefined : t("This view updates on its own.")}
          onClick={refreshView}
        >
          <RefreshCw className="icon-sm" />
        </Button>
        <SoundsButton />
        <FullscreenButton />
      </div>
      <div className="flex items-center @min-[40rem]/footer:hidden">
        <WorkspaceControlsMenu canRefresh={canRefresh} />
      </div>
    </Text>
  );
}

function WorkspaceControlsMenu({ canRefresh }: { canRefresh: boolean }) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const sounds = useSoundsToggle();
  const fullscreen = useFullscreenToggle();
  const items: DropdownMenuItem[] = [
    {
      kind: "item",
      id: "refresh",
      label: t("Refresh current view"),
      icon: <RefreshCw className="icon-sm" />,
      disabled: !canRefresh,
    },
    {
      kind: "item",
      id: "sounds",
      label: t("Sounds"),
      icon: <AudioLines className="icon-sm" />,
      selectionRole: "checkbox",
      checked: sounds.enabled,
    },
    {
      kind: "item",
      id: "fullscreen",
      label: fullscreen.label,
      icon: fullscreen.fullscreen ? (
        <Minimize2 className="icon-sm" strokeWidth={1.75} />
      ) : (
        <Maximize2 className="icon-sm" strokeWidth={1.75} />
      ),
      shortcut: fullscreen.shortcut ?? undefined,
    },
  ];
  return (
    <>
      <Button
        ref={anchor}
        iconOnly
        label={t("More")}
        variant="ghost"
        motion="none"
        type="button"
        aria-haspopup="menu"
        expanded={open}
        data-workspace-control="more"
        data-tauri-drag-region="false"
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal className="icon-sm" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Workspace controls")}
          side="top"
          align="end"
          items={items}
          onClose={() => setOpen(false)}
          onPick={(id) => {
            if (id === "refresh") refreshView();
            else if (id === "sounds") sounds.toggle();
            else if (id === "fullscreen") fullscreen.toggle();
          }}
        />
      ) : null}
      {sounds.notice}
      {fullscreen.notice}
    </>
  );
}
