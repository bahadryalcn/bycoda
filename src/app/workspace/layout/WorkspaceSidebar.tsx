import { memo, type ComponentProps } from "react";
import type { WorkspaceTab } from "../../../features/workspace/model/layout";
import { pickTextHarness } from "../../../integrations/harness";
import type { useWorkspaceNavigation } from "../../hooks/useWorkspaceNavigation";
import type { AuxiliaryToolId } from "../../model/toolWindows";
import { Sidebar } from "../../shell/Sidebar";
import {
  selectedChangeKind,
  selectedChangePath,
  selectedCommitSha,
} from "../helpers/sessionHelpers";

type SidebarProps = ComponentProps<typeof Sidebar>;

/** Sidebar props that this wrapper derives from workspace state. */
type DerivedSidebarProp =
  | "workspaceSwitchPending"
  | "workspaceSwitchError"
  | "status"
  | "canGoBack"
  | "canGoForward"
  | "selectedDiffPath"
  | "selectedDiffKind"
  | "selectedCommitSha"
  | "textHarness"
  | "onOpenNotes"
  | "automationsActive"
  | "tasksActive"
  | "socialActive"
  | "assistantActive";

/**
 * Sidebar props passed through unchanged, plus the raw workspace inputs the
 * derived props are computed from. `settingsOpen` and `notesEnabled` are
 * Sidebar props too and are passed through (read via `props`).
 */
export interface WorkspaceSidebarProps extends Omit<SidebarProps, DerivedSidebarProp> {
  workspaceNavigation: ReturnType<typeof useWorkspaceNavigation>;
  historyFailed: boolean;
  searchViewOpen: boolean;
  inboxViewOpen: boolean;
  notesViewOpen: boolean;
  serversViewOpen?: boolean;
  automationsViewOpen: boolean;
  taskBoardShown: boolean;
  socialBoardShown: boolean;
  /** Assistant, terminal and conversation tools share the automations surface. */
  auxiliaryTool?: AuxiliaryToolId | null;
  tabVisitNav: { canBack: boolean; canForward: boolean };
  surfaceForward: { canForward: boolean };
  activeTab: WorkspaceTab | undefined;
  activeHarness: Parameters<typeof pickTextHarness>[0];
  onOpenNotes: NonNullable<SidebarProps["onOpenNotes"]>;
}

export const WorkspaceSidebar = memo(
  function WorkspaceSidebar({
    workspaceNavigation,
    historyFailed,
    searchViewOpen: _searchViewOpen,
    inboxViewOpen: _inboxViewOpen,
    notesViewOpen: _notesViewOpen,
    serversViewOpen: _serversViewOpen,
    automationsViewOpen,
    taskBoardShown,
    socialBoardShown,
    auxiliaryTool,
    tabVisitNav,
    surfaceForward,
    activeTab,
    activeHarness,
    onOpenNotes,
    ...props
  }: WorkspaceSidebarProps) {
    // The Room is a full-window tool like Tasks and Automations: the session sidebar stays
    // hidden while it is the active tool, and its open preference is left untouched.
    const assistantRoomOpen = automationsViewOpen && auxiliaryTool === "assistant";
    return (
      <Sidebar
        {...props}
        open={props.open && !assistantRoomOpen}
        workspaceSwitchPending={workspaceNavigation.pending?.project === props.cwd}
        workspaceSwitchError={
          workspaceNavigation.error?.project === props.cwd
            ? workspaceNavigation.error.message
            : undefined
        }
        status={historyFailed ? "error" : "idle"}
        canGoBack={tabVisitNav.canBack}
        canGoForward={surfaceForward.canForward || tabVisitNav.canForward}
        selectedDiffPath={activeTab ? selectedChangePath(activeTab, props.gitCwd) : undefined}
        selectedDiffKind={activeTab ? selectedChangeKind(activeTab) : undefined}
        selectedCommitSha={activeTab ? selectedCommitSha(activeTab) : undefined}
        textHarness={pickTextHarness(activeHarness)}
        onOpenNotes={props.notesEnabled ? onOpenNotes : undefined}
        automationsActive={
          automationsViewOpen && !taskBoardShown && !socialBoardShown && !auxiliaryTool
        }
        tasksActive={automationsViewOpen && taskBoardShown && !auxiliaryTool}
        socialActive={automationsViewOpen && socialBoardShown && !auxiliaryTool}
        assistantActive={assistantRoomOpen}
      />
    );
  },
  (a, b) => {
    const ignored = new Set(["workspaceNavigation", "tabVisitNav", "surfaceForward"]);
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    for (const key of Object.keys(a) as Array<keyof WorkspaceSidebarProps>) {
      if (!ignored.has(key) && !Object.is(a[key], b[key])) return false;
    }
    return (
      a.workspaceNavigation.pending?.project === b.workspaceNavigation.pending?.project &&
      a.workspaceNavigation.error?.project === b.workspaceNavigation.error?.project &&
      a.workspaceNavigation.error?.message === b.workspaceNavigation.error?.message &&
      a.tabVisitNav.canBack === b.tabVisitNav.canBack &&
      a.tabVisitNav.canForward === b.tabVisitNav.canForward &&
      a.surfaceForward.canForward === b.surfaceForward.canForward
    );
  },
);
