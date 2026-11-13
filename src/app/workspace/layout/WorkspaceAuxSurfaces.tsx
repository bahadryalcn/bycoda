import { memo } from "react";
import { useStableHandlers } from "../../../shared/hooks/useStableHandlers";
import { useHeldValue } from "../helpers/stableProps";
import type { ComponentProps } from "react";
import { SessionPane } from "../../../features/sessions/ui/SessionPane";
import { SessionSurface } from "../../../features/sessions/ui/SessionSurface";
import { requestTranscriptJump } from "../../../features/sessions/model/transcriptJump";
import type { Session } from "../../../features/sessions/model/session";
import type { OpenFileFn } from "../../../features/search/model/search";
import type { InboxSessionPortal } from "../../../features/inbox/ui/InboxDiscussionPanel";
import { LiveSearchView } from "./LiveSearchView";
import type { WorkspaceSessionPaneProps } from "./WorkspaceMainArea";

type SearchProps = ComponentProps<typeof LiveSearchView>;

export interface WorkspaceAuxSurfacesProps {
  // Live search
  searchViewOpen: boolean;
  searchDialogOpen?: boolean;
  searchRequest?: SearchProps["request"];
  onExpandSearch?: () => void;
  onCompactSearch?: () => void;
  gitCwd: string;
  visibleRecents: SearchProps["recents"];
  projectHistory: SearchProps["history"];
  lockSnapshot: SearchProps["lockSnapshot"];
  searchViewFocusToken: SearchProps["focusToken"];
  projectRailOpen: boolean;
  compactProjectRail: boolean;
  compactRailActive: boolean;
  onLeaveSearch: SearchProps["onClose"];
  onToggleSidebar: SearchProps["onToggleSidebar"];
  onOpenFile: OpenFileFn;
  onSelectHistorySession: (sessionId: string) => Promise<unknown>;
  onSelectProject: SearchProps["onOpenProject"];

  // Hidden inbox-ask session surfaces
  sessions: Session[];
  inboxViewOpen: boolean;
  inboxAskPortal: InboxSessionPortal | null;
  socialSessionIds?: readonly string[];
  socialWorkspaceTargets?: Readonly<
    Record<
      string,
      import("../../../features/sessions/public/SessionPanelTargets").SessionPanelTarget
    >
  >;
  socialSessionPortal?: InboxSessionPortal | null;
  socialVisible?: boolean;
  composerFocused: boolean;
  composerFocusToken: number;
  sessionPaneProps: WorkspaceSessionPaneProps;
}

function WorkspaceAuxSurfacesComponent({
  searchViewOpen,
  searchDialogOpen = false,
  searchRequest,
  onExpandSearch,
  onCompactSearch,
  gitCwd,
  visibleRecents,
  projectHistory,
  lockSnapshot,
  searchViewFocusToken,
  projectRailOpen,
  compactProjectRail,
  compactRailActive,
  onLeaveSearch,
  onToggleSidebar,
  onOpenFile,
  onSelectHistorySession,
  onSelectProject,
  sessions,
  inboxViewOpen,
  inboxAskPortal,
  socialSessionIds = [],
  socialWorkspaceTargets = {},
  socialSessionPortal,
  socialVisible = false,
  composerFocused,
  composerFocusToken,
  sessionPaneProps,
}: WorkspaceAuxSurfacesProps) {
  return (
    <>
      {searchViewOpen || searchDialogOpen ? (
        <LiveSearchView
          open
          presentation={searchDialogOpen ? "dialog" : "page"}
          request={searchRequest}
          onExpand={onExpandSearch}
          onCompact={onCompactSearch}
          cwd={gitCwd}
          recents={visibleRecents}
          history={projectHistory}
          lockSnapshot={lockSnapshot}
          focusToken={searchViewFocusToken}
          besideRail={projectRailOpen || compactProjectRail}
          compactRail={compactRailActive}
          onClose={onLeaveSearch}
          onToggleSidebar={onToggleSidebar}
          onOpenFile={onOpenFile}
          onOpenSession={(sessionId, blockId, query) => {
            if (blockId) requestTranscriptJump(sessionId, blockId, query);
            void onSelectHistorySession(sessionId);
          }}
          onOpenProject={onSelectProject}
        />
      ) : null}
      <div className="hidden" aria-hidden>
        {sessions
          .filter((session) => session.inboxAsk || socialSessionIds.includes(session.id))
          .map((session) => {
            const social = socialSessionIds.includes(session.id);
            const portal = social ? socialSessionPortal : inboxAskPortal;
            const dockVisible =
              (social ? socialVisible : inboxViewOpen) && portal?.sessionId === session.id;
            const workspace = social ? socialWorkspaceTargets[session.id] : undefined;
            const visible = dockVisible || !!workspace?.visible;
            return (
              <SessionSurface key={session.id} host={dockVisible ? portal?.host : workspace?.host}>
                <SessionPane
                  {...sessionPaneProps}
                  session={session}
                  embedded={social}
                  visible={visible}
                  focused={dockVisible || !!workspace?.focused}
                  inSplit={dockVisible ? false : (workspace?.inSplit ?? false)}
                  composerFocused={composerFocused}
                  composerFocusToken={composerFocusToken}
                />
              </SessionSurface>
            );
          })}
      </div>
    </>
  );
}

const MemoWorkspaceAuxSurfaces = memo(WorkspaceAuxSurfacesComponent);

/** Workspace recreates most handlers per render; stable proxies let the memo hold. */
export function WorkspaceAuxSurfaces(props: WorkspaceAuxSurfacesProps) {
  // Rail layout only matters while search is shown (see WorkspaceToolPanels).
  const shown = !!(props.searchViewOpen || props.searchDialogOpen);
  const projectRailOpen = useHeldValue(props.projectRailOpen, shown);
  const compactProjectRail = useHeldValue(props.compactProjectRail, shown);
  const compactRailActive = useHeldValue(props.compactRailActive, shown);
  return (
    <MemoWorkspaceAuxSurfaces
      {...useStableHandlers({ ...props, projectRailOpen, compactProjectRail, compactRailActive })}
    />
  );
}
