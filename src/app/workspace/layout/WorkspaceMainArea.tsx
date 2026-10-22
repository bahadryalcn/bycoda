import { useLayoutEffect, type ComponentProps, type RefObject } from "react";
import { ProjectTerminalDock } from "../../../features/terminal/ui/ProjectTerminalDock";
import { ToolsWorkspace } from "../../../features/host-tools/ToolsWorkspace";
import { PaneTree } from "../../../features/workspace/ui/PaneTree";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import type { ProjectTerminalDock as ProjectTerminal } from "../../../features/projects/model/projectTerminal";
import { sameProjectPath } from "../../../features/projects/model/recents";
import type { SettingsSectionId } from "../../../features/settings/model/settings";
import type { Session } from "../../../features/sessions/model/session";
import { hasPendingApproval, type Block } from "../../../features/sessions/model/session";
import { LinkedWorkItemPanel } from "../surfaces/lazySurfaces";
import type { LinkedWorkItemPanelState } from "../helpers/types";
import { useTabHibernation } from "../tabs/useTabHibernation";

type DockProps = ComponentProps<typeof ProjectTerminalDock>;
type PaneTreeProps = ComponentProps<typeof PaneTree>;
type LinkedPanelProps = ComponentProps<typeof LinkedWorkItemPanel>;

/** Props shared by every pane in the session pane tree (PaneTree spreads them into SessionPane). */
export type WorkspaceSessionPaneProps = Omit<
  PaneTreeProps,
  | "visible"
  | "layout"
  | "maximizedPaneId"
  | "onToggleMaximizePane"
  | "sessions"
  | "editorPanes"
  | "dirtyFileIds"
  | "fileErrorCounts"
  | "focusedId"
  | "addToChatSessionId"
  | "composerFocused"
  | "composerFocusToken"
  | "onSelectFile"
  | "onCloseFile"
  | "onCloseOtherFiles"
  | "onOpenInNewWindow"
  | "onPinFile"
  | "onReorderFiles"
  | "onFileDirtyChange"
  | "onFileErrorCountChange"
  | "transcriptPool"
  | "onRatio"
  | "editorNavigation"
  | "onUpdatePlan"
  | "onMovePane"
  | "onMoveFile"
  | "onDetachPane"
  | "onPopOutPane"
  | "onTerminalMetaChange"
>;

export interface WorkspaceMainAreaProps {
  // Project terminal dock (markup only; dock state lives in Workspace)
  dockGridRef: RefObject<HTMLDivElement | null>;
  projectCwd: string;
  projectTerminals: ProjectTerminal[];
  projectTerminalFocused: boolean;
  focusProjectTerminal: DockProps["onFocus"];
  onHideProjectTerminal: DockProps["onHide"];
  onProjectTerminalSide: DockProps["onSideChange"];
  paintDockSize: DockProps["onSizePaint"];
  commitDockSize: DockProps["onSizeCommit"];
  onNewTerminal: DockProps["onAddTerminal"];
  onNewTerminalWithProfile: DockProps["onAddTerminalWithProfile"];
  onSplitProjectTerminal: DockProps["onSplitTerminal"];
  openSettings: (section: SettingsSectionId) => void;
  onSelectProjectTerminal: DockProps["onSelectTerminal"];
  onCloseProjectTerminal: DockProps["onCloseTerminal"];
  onCloseOtherProjectTerminals: DockProps["onCloseOtherTerminals"];
  onReorderProjectTerminals: DockProps["onReorderTerminals"];
  onTerminalMetaChange: DockProps["onTerminalMetaChange"];

  // Tab / pane tree
  tabs: WorkspaceTab[];
  activeTabId: string;
  windowTransferPending: boolean;
  movingWindows: Set<string>;
  inboxViewOpen: boolean;
  dirtyFiles: PaneTreeProps["dirtyFileIds"];
  fileErrorCounts: PaneTreeProps["fileErrorCounts"];
  sessions: Session[];
  /** Hibernation eligibility: a hidden tab with busy or unseen-finished sessions stays mounted. */
  busySessionIds: ReadonlySet<string>;
  unseenFinishedIds: ReadonlySet<string>;
  active: Session | undefined;
  composerFocused: boolean;
  composerFocusToken: PaneTreeProps["composerFocusToken"];
  onSelectFileSurface: PaneTreeProps["onSelectFile"];
  onCloseFile: PaneTreeProps["onCloseFile"];
  onCloseOtherFiles: PaneTreeProps["onCloseOtherFiles"];
  onOpenFileInNewWindow: PaneTreeProps["onOpenInNewWindow"];
  onPinFile: PaneTreeProps["onPinFile"];
  onReorderFiles: PaneTreeProps["onReorderFiles"];
  onFileDirtyChange: PaneTreeProps["onFileDirtyChange"];
  onFileErrorCountChange: PaneTreeProps["onFileErrorCountChange"];
  transcriptPool: PaneTreeProps["transcriptPool"];
  onRatio: (tabId: string, splitId: string, index: number, ratio: number) => void;
  editorNavigation: PaneTreeProps["editorNavigation"];
  onUpdatePlan: PaneTreeProps["onUpdatePlan"];
  onMovePane: PaneTreeProps["onMovePane"];
  onMoveFileBetweenPanes: PaneTreeProps["onMoveFile"];
  onDetachPane: PaneTreeProps["onDetachPane"];
  onPopOutPane: PaneTreeProps["onPopOutPane"];
  maximizedPane: { tabId: string; paneId: string } | null;
  onToggleMaximizePane: PaneTreeProps["onToggleMaximizePane"];
  sessionPaneProps: WorkspaceSessionPaneProps;

  // Linked work-item panels
  linkedWorkItemPanels: ReadonlyMap<string, LinkedWorkItemPanelState>;
  repairSessions: LinkedPanelProps["repairSessions"];
  onRepairChecks: LinkedPanelProps["onRepairChecks"];
  closeLinkedWorkItemPanel: (sessionId: string) => void;
  onOpenInboxSession: (sessionId: string) => unknown;
  visibleRecents: LinkedPanelProps["recents"];
  searchViewOpen: boolean;
  settingsOpen: boolean;
  notesViewOpen: boolean;
  serversViewOpen?: boolean;
  automationsViewOpen: boolean;
  activeLinkedWorkItemPanel: LinkedWorkItemPanelState | null;
}

/** Runs on every session update, across every open session: rescan a transcript
 * only when its block array changed. */
const liveBlocksByArray = new WeakMap<Block[], boolean>();
function hasLiveBlock(blocks: Block[]): boolean {
  let live = liveBlocksByArray.get(blocks);
  if (live === undefined) {
    live = blocks.some((block) => block.streaming || block.tool?.status === "in_progress");
    liveBlocksByArray.set(blocks, live);
  }
  return live;
}

export function WorkspaceMainArea({
  dockGridRef,
  projectCwd,
  projectTerminals,
  projectTerminalFocused,
  focusProjectTerminal,
  onHideProjectTerminal,
  onProjectTerminalSide,
  paintDockSize,
  commitDockSize,
  onNewTerminal,
  onNewTerminalWithProfile,
  onSplitProjectTerminal,
  openSettings,
  onSelectProjectTerminal,
  onCloseProjectTerminal,
  onCloseOtherProjectTerminals,
  onReorderProjectTerminals,
  onTerminalMetaChange,
  tabs,
  activeTabId,
  windowTransferPending,
  movingWindows,
  inboxViewOpen,
  dirtyFiles,
  fileErrorCounts,
  sessions,
  busySessionIds,
  unseenFinishedIds,
  active,
  composerFocused,
  composerFocusToken,
  onSelectFileSurface,
  onCloseFile,
  onCloseOtherFiles,
  onOpenFileInNewWindow,
  onPinFile,
  onReorderFiles,
  onFileDirtyChange,
  onFileErrorCountChange,
  transcriptPool,
  onRatio,
  editorNavigation,
  onUpdatePlan,
  onMovePane,
  onMoveFileBetweenPanes,
  onDetachPane,
  onPopOutPane,
  maximizedPane,
  onToggleMaximizePane,
  sessionPaneProps,
  linkedWorkItemPanels,
  repairSessions,
  onRepairChecks,
  closeLinkedWorkItemPanel,
  onOpenInboxSession,
  visibleRecents,
  searchViewOpen,
  settingsOpen,
  notesViewOpen,
  serversViewOpen = false,
  automationsViewOpen,
  activeLinkedWorkItemPanel,
}: WorkspaceMainAreaProps) {
  useLayoutEffect(() => {
    transcriptPool?.setProtectedIds(
      sessions
        .filter(
          (session) =>
            session.busy ||
            session.continuingElsewhere ||
            session.pendingQuestion ||
            hasPendingApproval(session.blocks) ||
            hasLiveBlock(session.blocks),
        )
        .map((session) => session.id),
      sessions.map((session) => session.id),
    );
  }, [transcriptPool, sessions]);
  // Hidden, idle tabs release their pane tree; the tab entry itself is untouched.
  const isHibernated = useTabHibernation({
    tabs,
    activeTabId,
    sessions,
    busySessionIds,
    unseenFinishedIds,
    dirtyFileIds: dirtyFiles,
    movingTabIds: movingWindows,
  });
  return (
    <main className="relative flex min-h-0 min-w-0 flex-1">
      <ToolsWorkspace>
        <div ref={dockGridRef} className="grid h-full min-h-0 min-w-0 flex-1">
          {projectTerminals.map((dock) => {
            const show = dock.open && sameProjectPath(dock.projectPath, projectCwd);
            return (
              <div
                key={dock.projectPath}
                className={show ? "h-full min-h-0 min-w-0 w-full overflow-hidden" : "hidden"}
                style={show ? { gridArea: "dock" } : undefined}
                aria-hidden={!show}
              >
                <ProjectTerminalDock
                  dock={dock}
                  focused={show && projectTerminalFocused}
                  onFocus={focusProjectTerminal}
                  onHide={onHideProjectTerminal}
                  onSideChange={onProjectTerminalSide}
                  onSizePaint={paintDockSize}
                  onSizeCommit={commitDockSize}
                  onAddTerminal={onNewTerminal}
                  onAddTerminalWithProfile={onNewTerminalWithProfile}
                  onSplitTerminal={onSplitProjectTerminal}
                  onSelectDefaultProfile={() => openSettings("terminal")}
                  onSelectTerminal={onSelectProjectTerminal}
                  onCloseTerminal={onCloseProjectTerminal}
                  onCloseOtherTerminals={onCloseOtherProjectTerminals}
                  onReorderTerminals={onReorderProjectTerminals}
                  onTerminalMetaChange={onTerminalMetaChange}
                />
              </div>
            );
          })}
          <div className="relative flex min-h-0 min-w-0 flex-col" style={{ gridArea: "main" }}>
            <div className="relative min-h-0 min-w-0 flex-1">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  aria-hidden={tab.id !== activeTabId}
                  className={
                    tab.id === activeTabId
                      ? "absolute inset-0 flex h-full min-h-0 flex-col"
                      : "hidden"
                  }
                >
                  <div
                    inert={windowTransferPending || movingWindows.has(tab.id)}
                    aria-busy={windowTransferPending || movingWindows.has(tab.id)}
                    className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
                  >
                    {isHibernated(tab) ? null : (
                    <PaneTree
                      {...sessionPaneProps}
                      visible={tab.id === activeTabId && !inboxViewOpen}
                      layout={tab.layout}
                      maximizedPaneId={
                        maximizedPane?.tabId === tab.id ? maximizedPane.paneId : null
                      }
                      onToggleMaximizePane={onToggleMaximizePane}
                      sessions={sessions}
                      editorPanes={[...tab.editorPanes, ...(tab.terminalPanes ?? [])]}
                      dirtyFileIds={dirtyFiles}
                      fileErrorCounts={fileErrorCounts}
                      focusedId={
                        tab.id === activeTabId &&
                        !inboxViewOpen &&
                        !tab.diffFocused &&
                        !projectTerminalFocused
                          ? tab.focusedId
                          : ""
                      }
                      addToChatSessionId={tab.id === activeTabId ? active?.id : undefined}
                      composerFocused={composerFocused && !projectTerminalFocused}
                      composerFocusToken={composerFocusToken}
                      onSelectFile={onSelectFileSurface}
                      onCloseFile={onCloseFile}
                      onCloseOtherFiles={onCloseOtherFiles}
                      onOpenInNewWindow={onOpenFileInNewWindow}
                      onPinFile={onPinFile}
                      onReorderFiles={onReorderFiles}
                      onFileDirtyChange={onFileDirtyChange}
                      onFileErrorCountChange={onFileErrorCountChange}
                      transcriptPool={transcriptPool}
                      onRatio={(splitId, index, ratio) => onRatio(tab.id, splitId, index, ratio)}
                      editorNavigation={editorNavigation}
                      onUpdatePlan={onUpdatePlan}
                      onMovePane={onMovePane}
                      onMoveFile={onMoveFileBetweenPanes}
                      onDetachPane={onDetachPane}
                      onPopOutPane={onPopOutPane}
                      onTerminalMetaChange={onTerminalMetaChange}
                    />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {[...linkedWorkItemPanels.values()].map((panel) => (
          <LinkedWorkItemPanel
            repairSessions={repairSessions}
            onRepairChecks={onRepairChecks}
            onOpenSession={(sessionId) => {
              closeLinkedWorkItemPanel(panel.sessionId);
              onOpenInboxSession(sessionId);
            }}
            key={panel.sessionId}
            target={panel.item}
            cwd={panel.cwd}
            recents={visibleRecents}
            visible={
              !searchViewOpen &&
              !settingsOpen &&
              !inboxViewOpen &&
              !notesViewOpen &&
              !serversViewOpen &&
              !automationsViewOpen &&
              activeLinkedWorkItemPanel?.sessionId === panel.sessionId
            }
            onClose={() => closeLinkedWorkItemPanel(panel.sessionId)}
          />
        ))}
      </ToolsWorkspace>
    </main>
  );
}
