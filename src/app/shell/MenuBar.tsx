import { Button } from "../../shared/ui/Button";
import { t, useLocale } from "../../shared/i18n";
import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ExplorerMenu, type ExplorerMenuItem } from "../../features/files/ui/ExplorerMenu";
import { ALT, MOD, SHIFT } from "../../platform/tauri/platform";
import { runUpdateFlow } from "../model/updater";
import { openUsageGuide } from "../../features/onboarding/model/usageGuide";
import type { TitleBarLayout } from "./TitleBar";
import {
  SPLIT_DOWN_ID,
  SPLIT_RIGHT_ID,
  buildLayoutMenuItems,
  layoutPresetFromMenuId,
} from "./layoutMenu";
import {
  keybindingShortcutLabel,
  loadAutosave,
  loadKeybindingOverrides,
  saveAutosave,
  subscribeAutosave,
  subscribeKeybindings,
} from "../../features/settings/model/settings";

type MenuKey = "file" | "view" | "terminal";

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

export const MenuBar = memo(function MenuBar({
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
  useLocale();
  const [open, setOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuKey | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [, refreshShortcuts] = useState(loadKeybindingOverrides);
  const [autosave, setAutosave] = useState(loadAutosave);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeKeybindings(() => refreshShortcuts(loadKeybindingOverrides())), []);

  useEffect(() => subscribeAutosave(() => setAutosave(loadAutosave())), []);

  const shortcut = (command: string, keys: string) =>
    keybindingShortcutLabel(command, keys) ?? undefined;

  // Toggle with standalone Alt key tap
  useEffect(() => {
    let altPressedAlone = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altPressedAlone = true;
      } else if (altPressedAlone) {
        altPressedAlone = false;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" && altPressedAlone) {
        setOpen((prev) => {
          if (prev) {
            setActiveMenu(null);
            setMenuAnchor(null);
            return false;
          }
          return true;
        });
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

  const openDropdown = useCallback((key: MenuKey, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setActiveMenu(key);
    setMenuAnchor({ x: rect.left, y: rect.bottom + 2 });
  }, []);

  const closeMenu = useCallback(() => {
    setActiveMenu(null);
    setMenuAnchor(null);
  }, []);

  const handlePick = useCallback(
    (id: string) => {
      closeMenu();
      setOpen(false);

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

  const getMenuItems = (key: MenuKey): ExplorerMenuItem[] => {
    switch (key) {
      case "file":
        return [
          {
            kind: "item",
            id: "new_tab",
            get label() {
              return t("New Tab");
            },
            shortcut: shortcut("Tab: New", `${MOD}T`),
          },
          {
            kind: "item",
            id: "new_terminal",
            get label() {
              return t("New Terminal");
            },
            shortcut: shortcut("Terminal: New", `${MOD}\``),
          },
          {
            kind: "item",
            id: "new_window",
            get label() {
              return t("New Window");
            },
            shortcut: shortcut("App: New Window", `${MOD}${SHIFT}N`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "toggle_autosave",
            get label() {
              return t("Autosave");
            },
            checked: autosave,
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "open_project",
            get label() {
              return t("Open Project…");
            },
            shortcut: shortcut("App: Open Project", `${MOD}O`),
          },
          {
            kind: "item",
            id: "open_search",
            get label() {
              return t("Search…");
            },
            shortcut: shortcut("App: Search", `${MOD}K`),
          },
          {
            kind: "item",
            id: "go_to_file",
            get label() {
              return t("Go to File…");
            },
            shortcut: shortcut("App: Go to File", `${MOD}P`),
          },
          {
            kind: "item",
            id: "find_in_project",
            get label() {
              return t("Find in Files…");
            },
            shortcut: shortcut("App: Find in Files", `${MOD}${SHIFT}F`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "close_tab",
            get label() {
              return t("Close Pane");
            },
            shortcut: shortcut("Pane: Close", `${MOD}W`),
          },
          {
            kind: "item",
            id: "close_other_tabs",
            get label() {
              return t("Close Other Tabs");
            },
            shortcut: shortcut("Tab: Close Others", `${MOD}${ALT}T`),
          },
          ...(onCloseIdleTabs
            ? [
                {
                  kind: "item" as const,
                  id: "close_idle_tabs",
                  get label() {
                    return t("Close Idle Tabs");
                  },
                  disabled: !idleTabCount,
                },
              ]
            : []),
          {
            kind: "item",
            id: "close_all_tabs",
            get label() {
              return t("Close All Tabs");
            },
            shortcut: shortcut("Tab: Close All", `${MOD}${SHIFT}W`),
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "check_for_updates",
            get label() {
              return t("Check for Updates…");
            },
          },
        ];
      case "view":
        return [
          {
            kind: "item",
            id: "usage_guide",
            get label() {
              return t("Usage guide");
            },
          },
          { kind: "sep" },
          {
            kind: "item",
            id: "toggle_sidebar",
            get label() {
              return t("Toggle Sidebar");
            },
            shortcut: shortcut("App: Toggle Sidebar", `${MOD}B`),
          },
          {
            kind: "item",
            id: "toggle_session_sidebar",
            get label() {
              return t("Toggle Session Sidebar");
            },
            shortcut: shortcut("App: Toggle Session Sidebar", `${MOD}${SHIFT}B`),
          },
          {
            kind: "item",
            id: "open_inbox",
            get label() {
              return t("Inbox");
            },
          },
          ...(onOpenNotes
            ? [
                {
                  kind: "item" as const,
                  id: "open_notes",
                  get label() {
                    return t("Notes");
                  },
                },
              ]
            : []),
          {
            kind: "item",
            id: "toggle_terminal",
            get label() {
              return t("Toggle Terminal");
            },
            shortcut: shortcut("Terminal: Toggle Dock", `${MOD}J`),
          },
          {
            kind: "item",
            id: "open_model_picker",
            get label() {
              return t("Switch Model…");
            },
            shortcut: shortcut("App: Switch Model", `${MOD}.`),
          },
          {
            kind: "item",
            id: "toggle_diff",
            get label() {
              return t("Toggle Changes");
            },
          },
          ...(layout
            ? [
                {
                  kind: "item" as const,
                  id: "layout_menu",
                  get label() {
                    return t("Layout");
                  },
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
            get label() {
              return t("Zoom In");
            },
            shortcut: shortcut("View: Zoom In", `${MOD}+`),
          },
          {
            kind: "item",
            id: "zoom_out",
            get label() {
              return t("Zoom Out");
            },
            shortcut: shortcut("View: Zoom Out", `${MOD}-`),
          },
          {
            kind: "item",
            id: "zoom_reset",
            get label() {
              return t("Reset Zoom");
            },
            shortcut: shortcut("View: Reset Zoom", `${MOD}0`),
          },
        ];
      case "terminal":
        return [
          {
            kind: "item",
            id: "new_terminal",
            get label() {
              return t("New Terminal");
            },
            shortcut: shortcut("Terminal: New", `${MOD}\``),
          },
          {
            kind: "item",
            id: "toggle_terminal",
            get label() {
              return t("Toggle Terminal");
            },
            shortcut: shortcut("Terminal: Toggle Dock", `${MOD}J`),
          },
        ];
    }
  };

  if (!open && !activeMenu) {
    return null;
  }

  const MENUS: { key: MenuKey; label: string }[] = [
    {
      key: "file",
      get label() {
        return t("File");
      },
    },
    {
      key: "view",
      get label() {
        return t("View");
      },
    },
    {
      key: "terminal",
      get label() {
        return t("Terminal");
      },
    },
  ];

  return (
    <div
      ref={barRef}
      data-workspace-menubar
      className="flex h-7 shrink-0 items-center gap-0.5 border-b border-stroke bg-content/5 px-2 text-[12px]"
      data-tauri-drag-region="deep"
    >
      {MENUS.map(({ key, label }) => {
        const isActive = activeMenu === key;
        return (
          <Button
            selected={isActive}
            variant="ghost"
            motion="none"
            key={key}
            type="button"
            data-tauri-drag-region="false"
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
            className={``}
          >
            {label}
          </Button>
        );
      })}

      {activeMenu && menuAnchor ? (
        <ExplorerMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={getMenuItems(activeMenu)}
          ariaLabel={`${activeMenu} menu`}
          onPick={handlePick}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
});
