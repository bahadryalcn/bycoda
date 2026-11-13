import { surfaceAttributes } from "../../shared/ui/Surface";
import { Text } from "../../shared/ui/Text";
import { Button } from "../../shared/ui/Button";
import { useT } from "../../shared/i18n";
import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "../../shared/ui/ContextMenu";
import { ALT, MOD, SHIFT } from "../../platform/tauri/platform";
import { runUpdateFlow } from "../model/updater";
import { openUsageGuide } from "../../features/onboarding/model/usageGuide";
import { startTour } from "../../features/onboarding/model/tourState";
import type { TitleBarLayout } from "./TitleBar";
import {
  SPLIT_DOWN_ID,
  SPLIT_RIGHT_ID,
  buildLayoutMenuItems,
  layoutPresetFromMenuId,
} from "./layoutMenu";
import {
  loadAutosave,
  loadKeybindingOverrides,
  saveAutosave,
  subscribeAutosave,
  subscribeKeybindings,
} from "../../features/settings/model/settings";
import { quickComposerShortcutLabel } from "../../features/quick-composer/model/quickComposerShortcut";
import { useStableHandlers } from "../../shared/hooks/useStableHandlers";

type MenuKey = "file" | "view" | "terminal";

/**
 * Window event the title bar's compact application-menu button dispatches. It
 * toggles the same menu bar the Alt key does; `detail` is the viewport point
 * (the button's bottom-left) where the first menu should drop down.
 */
export const APP_MENU_TOGGLE_EVENT = "bycoda:app-menu-toggle";

type Props = {
  onNew: () => void;
  onNewTerminal?: () => void;
  onToggleTerminal?: () => void;
  onGoToFile?: () => void;
  onToggleSidebar: () => void;
  onToggleSessionSidebar: () => void;
  onShowSourceControl?: () => void;
  onCloseCurrentTab?: () => void;
  onCloseOtherTabs?: () => void;
  onCloseIdleTabs?: () => void;
  idleTabCount?: number;
  onCloseAllTabs?: () => void;
  onPickProject?: () => void;
  onFindInProject?: () => void;
  onSearch?: () => void;
  onOpenInbox?: () => void;
  onOpenNotes?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  layout?: TitleBarLayout;
};

const MemoMenuBar = memo(function MenuBar({
  onNew,
  onNewTerminal,
  onToggleTerminal,
  onGoToFile,
  onToggleSidebar,
  onToggleSessionSidebar,
  onShowSourceControl,
  onCloseCurrentTab,
  onCloseOtherTabs,
  onCloseIdleTabs,
  idleTabCount,
  onCloseAllTabs,
  onPickProject,
  onFindInProject,
  onSearch,
  onOpenInbox,
  onOpenNotes,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  layout,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // The title bar's compact button opens the menus as one popover, not as the menubar band.
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const [keybindingOverrides, refreshShortcuts] = useState(loadKeybindingOverrides);
  const [autosave, setAutosave] = useState(loadAutosave);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeKeybindings(() => refreshShortcuts(loadKeybindingOverrides())), []);

  useEffect(() => subscribeAutosave(() => setAutosave(loadAutosave())), []);

  // Same rule as `keybindingShortcutLabel`, read from the state this component re-renders on.
  const shortcut = (command: string, keys: string) => {
    const override = keybindingOverrides[command];
    if (override?.disabled) return undefined;
    return override?.shortcut ? quickComposerShortcutLabel(override.shortcut) : keys;
  };

  // Toggle with a standalone Alt tap or F10 (outside terminals, where F10 belongs to the program).
  useEffect(() => {
    let altPressedAlone = false;

    const toggle = () => {
      setOpen((prev) => {
        if (prev) {
          setActiveMenu(null);
          setMenuAnchor(null);
          return false;
        }
        return true;
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altPressedAlone = true;
      } else if (altPressedAlone) {
        altPressedAlone = false;
      }
      if (
        e.key === "F10" &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !(e.target instanceof Element && e.target.closest(".xterm"))
      ) {
        e.preventDefault();
        toggle();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" && altPressedAlone) {
        toggle();
        altPressedAlone = false;
      }
    };

    const onBlur = () => {
      altPressedAlone = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const openDropdown = (key: MenuKey, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setActiveMenu(key);
    setMenuAnchor({ x: rect.left, y: rect.bottom + 2 });
  };

  const closeMenu = useCallback(() => {
    setActiveMenu(null);
    setMenuAnchor(null);
  }, []);

  // The title bar's compact menu button opens File, View and Terminal as one popover
  // under the button (no extra band); with no anchor it falls back to the Alt menubar.
  useEffect(() => {
    const onToggle = (event: Event) => {
      if (open || activeMenu || popover) {
        setOpen(false);
        setPopover(null);
        closeMenu();
        return;
      }
      const anchor = (event as CustomEvent<{ x: number; y: number } | undefined>).detail;
      if (anchor) setPopover(anchor);
      else setOpen(true);
    };
    window.addEventListener(APP_MENU_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(APP_MENU_TOGGLE_EVENT, onToggle);
  }, [open, activeMenu, popover, closeMenu]);

  const handlePick = useCallback(
    (id: string) => {
      closeMenu();
      setOpen(false);
      setPopover(null);

      switch (id) {
        case "new_tab":
          onNew();
          break;
        case "new_terminal":
          onNewTerminal?.();
          break;
        case "toggle_terminal":
          onToggleTerminal?.();
          break;
        case "new_window":
          void invoke("open_new_window").catch(() => {});
          break;
        case "open_project":
          onPickProject?.();
          break;
        case "open_search":
          onSearch?.();
          break;
        case "open_inbox":
          onOpenInbox?.();
          break;
        case "open_notes":
          onOpenNotes?.();
          break;
        case "usage_guide":
          openUsageGuide();
          break;
        case "product_tour":
          startTour("first-run");
          break;
        case "go_to_file":
          onGoToFile?.();
          break;
        case "find_in_project":
          onFindInProject?.();
          break;
        case "close_tab":
          onCloseCurrentTab?.();
          break;
        case "close_other_tabs":
          onCloseOtherTabs?.();
          break;
        case "close_idle_tabs":
          onCloseIdleTabs?.();
          break;
        case "close_all_tabs":
          onCloseAllTabs?.();
          break;
        case "toggle_autosave": {
          const next = saveAutosave(!loadAutosave());
          setAutosave(next);
          break;
        }
        case "toggle_sidebar":
          onToggleSidebar();
          break;
        case "toggle_session_sidebar":
          onToggleSessionSidebar();
          break;
        case "open_model_picker":
          window.dispatchEvent(new Event("open_model_picker"));
          break;
        case "toggle_diff":
          onShowSourceControl?.();
          break;
        case "check_for_updates":
          void runUpdateFlow(true);
          break;
        case "zoom_in":
          onZoomIn?.();
          break;
        case "zoom_out":
          onZoomOut?.();
          break;
        case "zoom_reset":
          onZoomReset?.();
          break;
        case SPLIT_RIGHT_ID:
          layout?.onSplit("right");
          break;
        case SPLIT_DOWN_ID:
          layout?.onSplit("down");
          break;
        default: {
          const preset = layoutPresetFromMenuId(id);
          if (preset) layout?.onArrange(preset);
        }
      }
    },
    [
      layout,
      closeMenu,
      autosave,
      onCloseCurrentTab,
      onCloseOtherTabs,
      onCloseIdleTabs,
      idleTabCount,
      onCloseAllTabs,
      onFindInProject,
      onGoToFile,
      onNew,
      onNewTerminal,
      onToggleTerminal,
      onPickProject,
      onSearch,
      onOpenInbox,
      onOpenNotes,
      onShowSourceControl,
      onToggleSidebar,
      onToggleSessionSidebar,
      onZoomIn,
      onZoomOut,
      onZoomReset,
    ],
  );

  const getMenuItems = (key: MenuKey): ContextMenuItem[] => {
    switch (key) {
      case "file":
        return [
          {
            kind: "item",
            id: "new_tab",
            label: t("New Tab"),
            shortcut: shortcut("Tab: New", `${MOD}T`),
          },
          {
            kind: "item",
            id: "new_terminal",
            label: t("New Terminal"),
            shortcut: shortcut("Terminal: New", `${MOD}\``),
          },
          {
            kind: "item",
            id: "new_window",
            label: t("New Window"),
            shortcut: shortcut("App: New Window", `${MOD}${SHIFT}N`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "toggle_autosave",
            label: t("Autosave"),
            checked: autosave,
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "open_project",
            label: t("Open Project…"),
            shortcut: shortcut("App: Open Project", `${MOD}O`),
          },
          {
            kind: "item",
            id: "open_search",
            label: t("Search…"),
            shortcut: shortcut("App: Search", `${MOD}K`),
          },
          {
            kind: "item",
            id: "go_to_file",
            label: t("Go to File…"),
            shortcut: shortcut("App: Go to File", `${MOD}P`),
          },
          {
            kind: "item",
            id: "find_in_project",
            label: t("Find in Files…"),
            shortcut: shortcut("App: Find in Files", `${MOD}${SHIFT}F`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "close_tab",
            label: t("Close Pane"),
            shortcut: shortcut("Pane: Close", `${MOD}W`),
          },
          {
            kind: "item",
            id: "close_other_tabs",
            label: t("Close Other Tabs"),
            shortcut: shortcut("Tab: Close Others", `${MOD}${ALT}T`),
          },
          ...(onCloseIdleTabs
            ? [
                {
                  kind: "item" as const,
                  id: "close_idle_tabs",
                  label: t("Close Idle Tabs"),
                  disabled: !idleTabCount,
                },
              ]
            : []),
          {
            kind: "item",
            id: "close_all_tabs",
            label: t("Close All Tabs"),
            shortcut: shortcut("Tab: Close All", `${MOD}${SHIFT}W`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "check_for_updates",
            label: t("Check for Updates…"),
          },
        ];
      case "view":
        return [
          {
            kind: "item",
            id: "usage_guide",
            label: t("Usage guide"),
          },
          {
            kind: "item",
            id: "product_tour",
            label: t("Take the tour"),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "toggle_sidebar",
            label: t("Toggle Sidebar"),
            shortcut: shortcut("App: Toggle Sidebar", `${MOD}B`),
          },
          {
            kind: "item",
            id: "toggle_session_sidebar",
            label: t("Toggle Session Sidebar"),
            shortcut: shortcut("App: Toggle Session Sidebar", `${MOD}${SHIFT}B`),
          },
          {
            kind: "item",
            id: "open_inbox",
            label: t("Inbox"),
          },
          ...(onOpenNotes
            ? [
                {
                  kind: "item" as const,
                  id: "open_notes",
                  label: t("Notes"),
                },
              ]
            : []),
          {
            kind: "item",
            id: "toggle_terminal",
            label: t("Toggle Terminal"),
            shortcut: shortcut("Terminal: Toggle Dock", `${MOD}J`),
          },
          {
            kind: "item",
            id: "open_model_picker",
            label: t("Switch Model…"),
            shortcut: shortcut("App: Switch Model", `${MOD}${SHIFT}.`),
          },
          {
            kind: "item",
            id: "toggle_diff",
            label: t("Toggle Changes"),
          },
          ...(layout
            ? [
                {
                  kind: "item" as const,
                  id: "layout_menu",
                  label: t("Layout"),
                  submenu: buildLayoutMenuItems({
                    current: layout.current,
                    canArrange: layout.canArrange,
                    splitRightShortcut: shortcut("Pane: Split Right", `${MOD}D`),
                    splitDownShortcut: shortcut("Pane: Split Down", `${MOD}${SHIFT}D`),
                  }),
                },
              ]
            : []),
          { kind: "sep" },
          {
            kind: "item",
            id: "zoom_in",
            label: t("Zoom In"),
            shortcut: shortcut("View: Zoom In", `${MOD}+`),
          },
          {
            kind: "item",
            id: "zoom_out",
            label: t("Zoom Out"),
            shortcut: shortcut("View: Zoom Out", `${MOD}-`),
          },
          {
            kind: "item",
            id: "zoom_reset",
            label: t("Reset Zoom"),
            shortcut: shortcut("View: Reset Zoom", `${MOD}0`),
          },
        ];
      case "terminal":
        return [
          {
            kind: "item",
            id: "new_terminal",
            label: t("New Terminal"),
            shortcut: shortcut("Terminal: New", `${MOD}\``),
          },
          {
            kind: "item",
            id: "toggle_terminal",
            label: t("Toggle Terminal"),
            shortcut: shortcut("Terminal: Toggle Dock", `${MOD}J`),
          },
        ];
    }
  };

  if (popover) {
    return (
      <ContextMenu
        x={popover.x}
        y={popover.y}
        items={[
          ...getMenuItems("file"),
          { kind: "sep" },
          ...getMenuItems("view"),
          { kind: "sep" },
          ...getMenuItems("terminal"),
        ]}
        ariaLabel={t("Application menu")}
        onPick={handlePick}
        onClose={() => setPopover(null)}
      />
    );
  }

  if (!open && !activeMenu) {
    return null;
  }

  const MENUS: { key: MenuKey; label: string }[] = [
    {
      key: "file",
      label: t("File"),
    },
    {
      key: "view",
      label: t("View"),
    },
    {
      key: "terminal",
      label: t("Terminal"),
    },
  ];

  return (
    <Text
      ref={barRef}
      data-workspace-menubar
      as="div"
      size="caption"
      tone="inherit"
      {...surfaceAttributes(
        { frame: "pane", edge: "bottom", variant: "panel" },
        "flex min-h-(--ui-control-height-compact) shrink-0 items-center gap-0.5 px-2",
      )}
      data-tauri-drag-region="deep"
    >
      {MENUS.map(({ key, label }) => {
        const isActive = activeMenu === key;
        return (
          <Button
            selected={isActive}
            variant="ghost"
            size="sm"
            motion="none"
            key={key}
            type="button"
            data-tauri-drag-region="false"
            aria-haspopup="menu"
            aria-expanded={isActive}
            onClick={(e) => {
              if (isActive) {
                closeMenu();
              } else {
                openDropdown(key, e.currentTarget);
              }
            }}
            onMouseEnter={(e) => {
              if (activeMenu && activeMenu !== key) {
                openDropdown(key, e.currentTarget);
              }
            }}
          >
            {label}
          </Button>
        );
      })}

      {activeMenu && menuAnchor ? (
        <ContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={getMenuItems(activeMenu)}
          ariaLabel={MENUS.find((menu) => menu.key === activeMenu)?.label}
          onPick={handlePick}
          onClose={closeMenu}
        />
      ) : null}
    </Text>
  );
});

/** The workspace recreates most handlers per render; stable proxies let the memo hold. */
export function MenuBar(props: Props) {
  return <MemoMenuBar {...useStableHandlers(props)} />;
}
