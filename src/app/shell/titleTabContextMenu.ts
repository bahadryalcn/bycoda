import type { ExplorerMenuItem } from "../../features/files/ui/ExplorerMenu";
import type { useT } from "../../shared/i18n";
import type { Tab } from "./TitleBar";

export function titleTabClosable(tab: Tab, tabCount: number): boolean {
  return tabCount > 1 || !tab.blank;
}

/** Busy tabs stay: their stream is handled by this window's listeners, and a
 * shell cannot change windows. */
/** Busy tabs may move too: the move is queued until their response finishes. */
export function titleTabCanMoveToNewWindow(tab: Tab): boolean {
  return !tab.hasTerminal && !tab.terminal && !tab.movingWindow;
}

export type TitleTabContextAction = "others" | "right" | "left";

/** Tab ids affected by a context-menu action relative to its clicked tab. */
export function titleTabContextCloseIds(
  tabs: readonly Tab[],
  targetId: string,
  action: TitleTabContextAction,
): string[] {
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (targetIndex < 0) return [];
  if (action === "left") {
    return tabs.slice(0, targetIndex).map((tab) => tab.id);
  }
  if (action === "right") {
    return tabs.slice(targetIndex + 1).map((tab) => tab.id);
  }
  return tabs.filter((tab) => tab.id !== targetId).map((tab) => tab.id);
}

export type TitleTabContextMenuOptions = {
  contextTab: Tab;
  tabs: readonly Tab[];
  t: ReturnType<typeof useT>;
  detached: boolean;
  closeShortcut?: string | null;
  idleTabCount?: number;
  hasReturnTabToMain: boolean;
  hasMoveToNewWindow: boolean;
  hasCloseIdleTabs: boolean;
  hasArchiveTab: boolean;
  hasDeleteTab: boolean;
};

/** Ids each bulk-close action of the tab context menu would close. */
export function titleTabContextCloseIdSets(tabs: readonly Tab[], tabId: string) {
  return {
    others: titleTabContextCloseIds(tabs, tabId, "others"),
    right: titleTabContextCloseIds(tabs, tabId, "right"),
    left: titleTabContextCloseIds(tabs, tabId, "left"),
  };
}

/** Builds the title-bar tab context menu for one tab. Labels stay lazy so they follow the locale. */
export function buildTitleTabContextMenuItems({
  contextTab,
  tabs,
  t,
  detached,
  closeShortcut,
  idleTabCount,
  hasReturnTabToMain,
  hasMoveToNewWindow,
  hasCloseIdleTabs,
  hasArchiveTab,
  hasDeleteTab,
}: TitleTabContextMenuOptions): ExplorerMenuItem[] {
  const contextCloseIds = titleTabContextCloseIdSets(tabs, contextTab.id);
  return [
    ...(contextTab.previewSessionId || contextTab.previewFileId
      ? [
          {
            kind: "item" as const,
            id: "keep-open",
            label: t("Keep open"),
          },
        ]
      : []),
    ...(detached && hasReturnTabToMain
      ? [
          {
            kind: "item" as const,
            id: "return-main",
            label: t("Return to main window"),
            disabled: contextTab.hasTerminal || contextTab.dirty || contextTab.movingWindow,
          },
        ]
      : []),
    {
      kind: "item",
      id: "close",
      get label() {
        return t("Close Tab");
      },
      shortcut: closeShortcut ?? undefined,
      disabled: !titleTabClosable(contextTab, tabs.length),
    },
    ...(hasMoveToNewWindow
      ? [
          contextTab.pendingWindowMove
            ? {
                kind: "item" as const,
                id: "cancel-new-window",
                get label() {
                  return t("Cancel Move to New Window");
                },
                get description() {
                  return t("Waiting for the running response to finish");
                },
              }
            : {
                kind: "item" as const,
                id: "new-window",
                get label() {
                  return t("Move to New Window");
                },
                disabled: !titleTabCanMoveToNewWindow(contextTab),
                description: contextTab.movingWindow
                  ? "Opening new window…"
                  : contextTab.hasTerminal || contextTab.terminal
                    ? "Terminals cannot move between windows"
                    : contextTab.busyHarnesses.length > 0
                      ? "Moves once the running response finishes"
                      : undefined,
              },
        ]
      : []),
    { kind: "sep" },
    {
      kind: "item",
      id: "others",
      get label() {
        return t("Close Other Tabs");
      },
      disabled: contextCloseIds.others.length === 0,
    },
    {
      kind: "item",
      id: "right",
      get label() {
        return t("Close Tabs to the Right");
      },
      disabled: contextCloseIds.right.length === 0,
    },
    {
      kind: "item",
      id: "left",
      get label() {
        return t("Close Tabs to the Left");
      },
      disabled: contextCloseIds.left.length === 0,
    },
    ...(hasCloseIdleTabs
      ? [
          {
            kind: "item" as const,
            id: "close-idle",
            get label() {
              return t("Close Idle Tabs");
            },
            disabled: !idleTabCount,
          },
        ]
      : []),
    ...(contextTab.sessionCount > 0 && (hasArchiveTab || hasDeleteTab)
      ? [
          { kind: "sep" as const },
          ...(hasArchiveTab
            ? [
                {
                  kind: "item" as const,
                  id: "archive",
                  get label() {
                    return t("Archive");
                  },
                  description:
                    contextTab.sessionCount > 1
                      ? `All ${contextTab.sessionCount} conversations in this tab`
                      : undefined,
                },
              ]
            : []),
          ...(hasDeleteTab
            ? [
                {
                  kind: "item" as const,
                  id: "delete",
                  get label() {
                    return t("Delete");
                  },
                  description:
                    contextTab.sessionCount > 1
                      ? `Permanently delete all ${contextTab.sessionCount} conversations in this tab`
                      : undefined,
                  danger: true,
                },
              ]
            : []),
        ]
      : []),
  ];
}
