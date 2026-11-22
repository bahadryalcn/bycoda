import { surfaceAttributes } from "../../shared/ui/Surface";
import { Text } from "../../shared/ui/Text";
import { Button } from "../../shared/ui/Button";
import { useT } from "../../shared/i18n";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ContextMenu, type ContextMenuItem } from "../../shared/ui/ContextMenu";
import { isImeComposition } from "../../shared/lib/keyboard";
import { ALT, IS_WIN, MOD, SHIFT } from "../../platform/tauri/platform";
import { useToast } from "../../shared/ui/ToastRegion";
import { reportFailure } from "../../shared/ui/reportFailure";
import { hideCurrentWindow } from "../model/appLifecycle";
import type { TitleBarLayout } from "./TitleBar";
import {
  SPLIT_DOWN_ID,
  SPLIT_RIGHT_ID,
  buildLayoutMenuItems,
  layoutPresetFromMenuId,
} from "./layoutMenu";
import {
  KEYBINDINGS,
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
  /** Read only while the menu renders its items, so the bar never counts idle tabs on its own. */
  countIdleTabs?: () => number;
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

function closeIdleTabsItem(label: string, countIdleTabs: Props["countIdleTabs"]): ContextMenuItem {
  // The menu reads the current count whenever it checks the row, including while already open.
  return Object.defineProperty(
    { kind: "item" as const, id: "close_idle_tabs", label },
    "disabled",
    {
      enumerable: true,
      configurable: true,
      get: () => !countIdleTabs?.(),
    },
  );
}

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
  countIdleTabs,
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
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // The title bar's compact button opens the menus as one popover, not as the menubar band.
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const [keybindingOverrides, refreshShortcuts] = useState(loadKeybindingOverrides);
  const [autosave, setAutosave] = useState(loadAutosave);
  const barRef = useRef<HTMLDivElement>(null);
  // Roving tab stop of the menubar: the last focused top-level menu button.
  const [tabStop, setTabStop] = useState<MenuKey>("file");

  const focusMenuButton = (key: MenuKey) => {
    barRef.current
      ?.querySelector<HTMLElement>(`[data-menubar-key="${key}"]`)
      ?.focus({ preventScroll: true });
  };

  // The bar takes focus when it appears and hands it back to where the user was when it hides,
  // unless an action already moved focus somewhere real (a dialog, an input).
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Move DOM focus into the menu on open and restore it on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const returnTo =
      previous instanceof HTMLElement && previous !== document.body ? previous : null;
    focusMenuButton("file");
    return () => {
      const current = document.activeElement;
      if (
        (!current || current === document.body || !current.isConnected) &&
        returnTo?.isConnected
      ) {
        returnTo.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => subscribeKeybindings(() => refreshShortcuts(loadKeybindingOverrides())), []);

  useEffect(() => subscribeAutosave(() => setAutosave(loadAutosave())), []);

  // Same rule as `keybindingShortcutLabel`, read from the state this component re-renders on.
  const shortcut = (command: string, keys?: string) => {
    const override = keybindingOverrides[command];
    if (override?.disabled) return undefined;
    return override?.shortcut
      ? quickComposerShortcutLabel(override.shortcut)
      : (keys ?? KEYBINDINGS.find((binding) => binding.command === command)?.keys);
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
      // Alt and F10 pressed while an IME is composing belong to the IME, not to the menu bar.
      if (isImeComposition(e)) {
        altPressedAlone = false;
        return;
      }
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
      if (e.key === "Alt" && altPressedAlone && !isImeComposition(e)) {
        toggle();
        altPressedAlone = false;
      }
    };

    const onBlur = () => {
      altPressedAlone = false;
    };

    // Alt+click and Alt+drag are gestures, not taps: a pointer press while Alt is held cancels the tap.
    const onPointerDown = () => {
      altPressedAlone = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onPointerDown, true);
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

  // Open the compact menu at its trigger, or the Alt menubar when no anchor is supplied.
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

      const reportWindowAction = (error: unknown) =>
        reportFailure(error, { toast }).catch((failure) =>
          console.warn("Window action failed", failure),
        );

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
        case "close_window":
          void getCurrentWindow().close().catch(reportWindowAction);
          break;
        case "minimize_to_tray":
          void hideCurrentWindow().catch(reportWindowAction);
          break;
        case "quit_app":
          void invoke("request_app_quit").catch(reportWindowAction);
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
      toast,
    ],
  );

  if (!popover && !open && !activeMenu) return null;

  const destinations: ContextMenuItem[] = [
    ...(onOpenInbox
      ? [
          {
            kind: "item" as const,
            id: "open_inbox",
            label: t("Inbox"),
            shortcut: shortcut("App: Open Inbox"),
          },
        ]
      : []),
    ...(onOpenNotes
      ? [
          {
            kind: "item" as const,
            id: "open_notes",
            label: t("Notes"),
            shortcut: shortcut("App: Open Notes"),
          },
        ]
      : []),
  ];

  const tabActions: ContextMenuItem[] = [
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
    ...(onCloseIdleTabs ? [closeIdleTabsItem(t("Close Idle Tabs"), countIdleTabs)] : []),
    {
      kind: "item",
      id: "close_all_tabs",
      label: t("Close All Tabs"),
      shortcut: shortcut("Tab: Close All", `${MOD}${SHIFT}W`),
    },
  ];

  const layoutItem: ContextMenuItem[] = layout
    ? [
        {
          kind: "item",
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
    : [];

  const windowActions: ContextMenuItem[] = IS_WIN
    ? [
        { kind: "sep" },
        { kind: "item", id: "close_window", label: t("Close window"), shortcut: "Alt+F4" },
        { kind: "item", id: "minimize_to_tray", label: t("Minimize to tray") },
        { kind: "item", id: "quit_app", label: t("Quit") },
      ]
    : [];

  const getMenuItems = (key: MenuKey, compact = false): ContextMenuItem[] => {
    switch (key) {
      case "file":
        return [
          {
            kind: "item",
            id: "new_tab",
            label: t("New session"),
            shortcut: shortcut("Tab: New", `${MOD}T`),
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
          ...(!compact ? [{ kind: "sep" as const }, ...tabActions, ...windowActions] : []),
        ];
      case "view":
        return [
          {
            kind: "item",
            id: "toggle_sidebar",
            label: t("Toggle sidebar"),
            shortcut: shortcut("App: Toggle Sidebar", `${MOD}B`),
          },
          {
            kind: "item",
            id: "toggle_session_sidebar",
            label: t("Toggle Session Sidebar"),
            shortcut: shortcut("App: Toggle Session Sidebar", `${MOD}${SHIFT}B`),
          },
          ...(!compact ? destinations : []),
          {
            kind: "item",
            id: "open_model_picker",
            label: t("Switch Model…"),
            shortcut: shortcut("App: Switch Model", `${MOD}${SHIFT}.`),
          },
          {
            kind: "item",
            id: "toggle_diff",
            label: t("Toggle Source Control"),
          },
          ...(!compact ? layoutItem : []),
          { kind: "sep" },
          {
            kind: "item",
            id: "zoom_in",
            label: t("Zoom in"),
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
          ...getMenuItems("file", true),
          ...destinations,
          { kind: "sep" },
          { kind: "item", id: "tabs_menu", label: t("Tabs"), submenu: tabActions },
          ...layoutItem,
          { kind: "item", id: "view_menu", label: t("View"), submenu: getMenuItems("view", true) },
          {
            kind: "item",
            id: "terminal_menu",
            label: t("Terminal"),
            submenu: getMenuItems("terminal"),
          },
          ...windowActions,
        ]}
        ariaLabel={t("Application menu")}
        onPick={handlePick}
        onClose={() => setPopover(null)}
      />
    );
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

  const moveToMenu = (from: MenuKey, to: "next" | "previous" | "first" | "last") => {
    const index = MENUS.findIndex((menu) => menu.key === from);
    const target =
      to === "first"
        ? MENUS[0]
        : to === "last"
          ? MENUS[MENUS.length - 1]
          : MENUS[(index + (to === "next" ? 1 : -1) + MENUS.length) % MENUS.length];
    if (!target) return;
    const button = barRef.current?.querySelector<HTMLElement>(`[data-menubar-key="${target.key}"]`);
    if (!button) return;
    // Focus first so the new menu's overlay records the button as its focus return.
    button.focus({ preventScroll: true });
    if (activeMenu) openDropdown(target.key, button);
  };

  // Standard menubar keys: Left/Right between menus (opening the neighbour while one is open),
  // Down/Up open the focused menu, Home/End jump, Escape hides the bar. Key events from the
  // dropdown bubble here through the React tree; the dropdown keeps its own item keys.
  const onBarKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (isImeComposition(e.nativeEvent) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target instanceof Element ? e.target : null;
    const menu = target?.closest('[role="menu"]');
    if (menu) {
      if (!activeMenu || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      // A submenu owns Left (close it) and Right; a row that opens a submenu owns Right.
      if (menu.id.endsWith("-submenu")) return;
      const row = document.getElementById(menu.getAttribute("aria-activedescendant") ?? "");
      if (e.key === "ArrowRight" && row?.hasAttribute("aria-haspopup")) return;
      e.preventDefault();
      moveToMenu(activeMenu, e.key === "ArrowRight" ? "next" : "previous");
      return;
    }
    const key = target?.closest<HTMLElement>("[data-menubar-key]")?.dataset.menubarKey as
      | MenuKey
      | undefined;
    if (!key || e.defaultPrevented) return;
    const button = target?.closest<HTMLElement>("[data-menubar-key]");
    switch (e.key) {
      case "ArrowRight":
        moveToMenu(key, "next");
        break;
      case "ArrowLeft":
        moveToMenu(key, "previous");
        break;
      case "Home":
        moveToMenu(key, "first");
        break;
      case "End":
        moveToMenu(key, "last");
        break;
      case "ArrowDown":
      case "ArrowUp":
        if (button) openDropdown(key, button);
        break;
      case "Escape":
        closeMenu();
        setOpen(false);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <Text
      ref={barRef}
      data-workspace-menubar
      role="menubar"
      aria-label={t("Application menu")}
      onKeyDown={onBarKeyDown}
      as="div"
      size="caption"
      tone="inherit"
      {...surfaceAttributes(
        { frame: "pane", edge: "bottom", variant: "workspace-panel" },
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
            role="menuitem"
            data-menubar-key={key}
            tabIndex={tabStop === key ? 0 : -1}
            onFocus={() => setTabStop(key)}
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
          key={activeMenu}
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
