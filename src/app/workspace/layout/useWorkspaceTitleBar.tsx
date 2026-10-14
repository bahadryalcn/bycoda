import type { ComponentProps, MutableRefObject } from "react";
import { type WorkspaceTab } from "../../../features/workspace/model/layout";
import { TitleBar } from "../../shell/TitleBar";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { useMoveTabsToNewWindow } from "../windows/useMoveTabsToNewWindow";
import type { useTabVisitState } from "../navigation/useTabVisitHistory";
import type { useRailNavigation } from "../navigation/useRailNavigation";

type TitleBarProps = ComponentProps<typeof TitleBar>;

export interface WorkspaceTitleBarDeps {
  windowTransfer: WindowTransferPayload | null;
  detachedSessionWindow: boolean;
  onMoveTabsToNewWindow: ReturnType<typeof useMoveTabsToNewWindow>["onMoveTabsToNewWindow"];
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  titleTabs: TitleBarProps["tabs"];
  activeTabId: string;
  sidebarCwd: string;
  projectRailOpen: boolean;
  sessionSidebarOpen: boolean;
  compactTitleBar: boolean;
  tabVisitNav: ReturnType<typeof useTabVisitState>["tabVisitNav"];
  surfaceForward: ReturnType<typeof useRailNavigation>["surfaceForward"];
  onRailBack: TitleBarProps["onGoBack"];
  onRailForward: TitleBarProps["onGoForward"];
  onToggleSidebar: TitleBarProps["onToggleSidebar"];
  onToggleSessionSidebar: TitleBarProps["onToggleSessionSidebar"];
  activateTab: TitleBarProps["onSelect"];
  onNew: TitleBarProps["onNew"];
  onNewTerminal: TitleBarProps["onNewTerminal"];
  onOpenSettings: TitleBarProps["onOpenSettings"];
  onOpenInbox: TitleBarProps["onOpenInbox"];
  notesEnabled: boolean;
  onOpenNotes: TitleBarProps["onOpenNotes"];
  onCloseTitleTab: TitleBarProps["onClose"];
  onCloseTabs: TitleBarProps["onCloseMany"];
  onArchiveTitleTab: TitleBarProps["onArchiveTab"];
  onDeleteTitleTab: TitleBarProps["onDeleteTab"];
  onReorderTabs: TitleBarProps["onReorder"];
  onPlaceTabOnPane: TitleBarProps["onPlaceOnPane"];
  layoutControl: TitleBarProps["layout"];
  onMoveTabToNewWindow: TitleBarProps["onMoveToNewWindow"];
  onCancelMoveToNewWindow: TitleBarProps["onCancelMoveToNewWindow"];
  onGoToFile: TitleBarProps["onGoToFile"];
  onPinFile: TitleBarProps["onPinFile"];
  visibleRecents: TitleBarProps["recents"];
  onSelectProject: TitleBarProps["onSelectProject"];
}

export function useWorkspaceTitleBar({
  windowTransfer,
  detachedSessionWindow,
  onMoveTabsToNewWindow,
  tabsRef,
  titleTabs,
  activeTabId,
  sidebarCwd,
  projectRailOpen,
  sessionSidebarOpen,
  compactTitleBar,
  tabVisitNav,
  surfaceForward,
  onRailBack,
  onRailForward,
  onToggleSidebar,
  onToggleSessionSidebar,
  activateTab,
  onNew,
  onNewTerminal,
  onOpenSettings,
  onOpenInbox,
  notesEnabled,
  onOpenNotes,
  onCloseTitleTab,
  onCloseTabs,
  onArchiveTitleTab,
  onDeleteTitleTab,
  onReorderTabs,
  onPlaceTabOnPane,
  layoutControl,
  onMoveTabToNewWindow,
  onCancelMoveToNewWindow,
  onGoToFile,
  onPinFile,
  visibleRecents,
  onSelectProject,
}: WorkspaceTitleBarDeps) {
  return (
    <TitleBar
      detached={detachedSessionWindow}
      onReturnTabToMain={
        windowTransfer
          ? (tabId) => void onMoveTabsToNewWindow([tabId], { targetWindowLabel: "main" })
          : undefined
      }
      onReturnToMain={
        windowTransfer
          ? () =>
              void onMoveTabsToNewWindow(
                tabsRef.current.map((tab) => tab.id),
                { targetWindowLabel: "main" },
              )
          : undefined
      }
      tabs={titleTabs}
      activeId={activeTabId}
      cwd={sidebarCwd}
      projectRailOpen={!detachedSessionWindow && projectRailOpen}
      sessionSidebarOpen={!detachedSessionWindow && sessionSidebarOpen}
      compactRail={compactTitleBar}
      canGoBack={tabVisitNav.canBack}
      canGoForward={surfaceForward.canForward || tabVisitNav.canForward}
      onGoBack={onRailBack}
      onGoForward={onRailForward}
      onToggleSidebar={onToggleSidebar}
      onToggleSessionSidebar={onToggleSessionSidebar}
      onSelect={activateTab}
      onNew={onNew}
      onNewTerminal={onNewTerminal}
      onOpenSettings={onOpenSettings}
      onOpenInbox={onOpenInbox}
      onOpenNotes={notesEnabled ? onOpenNotes : undefined}
      onClose={onCloseTitleTab}
      onCloseMany={onCloseTabs}
      onArchiveTab={onArchiveTitleTab}
      onDeleteTab={onDeleteTitleTab}
      onReorder={onReorderTabs}
      onPlaceOnPane={onPlaceTabOnPane}
      layout={layoutControl}
      onMoveToNewWindow={onMoveTabToNewWindow}
      onCancelMoveToNewWindow={onCancelMoveToNewWindow}
      onGoToFile={onGoToFile}
      onPinFile={onPinFile}
      recents={visibleRecents}
      onSelectProject={onSelectProject}
    />
  );
}
