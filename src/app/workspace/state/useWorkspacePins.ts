import { useCallback, useRef, useState } from "react";
import { composerDraftOf } from "../../../features/sessions/model/draftCache";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { isRemoteProjectPath } from "../../../features/projects/model/recents";
import {
  keepsWorkspaceTab,
  workspaceTabCwd,
  workspaceTabWorktree,
} from "../../../features/workspace/model/workspaceTabGroups";
import type { WindowTransferPayload } from "../../model/windowTransfer";

export interface WorkspacePinsDeps {
  windowTransfer: WindowTransferPayload | null;
  tabs: WorkspaceTab[];
  sessions: Session[];
}

/** Workspace pins, tab-to-workspace resolution and the keep-open check. */
export function useWorkspacePins({ windowTransfer, tabs, sessions }: WorkspacePinsDeps) {
  const [restoredPins] = useState(
    () =>
      new Map(
        windowTransfer
          ? []
          : tabs.flatMap((tab) => {
              const project = workspaceTabCwd(tab, sessions);
              return project && !isRemoteProjectPath(project) ? [[tab.id, project] as const] : [];
            }),
      ),
  );
  const workspacePins = useRef(restoredPins);
  const tabWorkspace = useCallback((tab: WorkspaceTab, list: readonly Session[]) => {
    const pinnedTab = workspacePins.current.get(tab.id);
    if (pinnedTab) return pinnedTab;
    for (const id of leafIds(tab.layout)) {
      const pinned = workspacePins.current.get(id);
      if (pinned) return pinned;
    }
    return workspaceTabWorktree(tab, list);
  }, []);
  const tabWorktreeOf = useCallback(
    (tab: WorkspaceTab) => tabWorkspace(tab, sessionsRef.current),
    [tabWorkspace],
  );
  const keepWorkspaceTab = useCallback(
    (tab: WorkspaceTab) =>
      keepsWorkspaceTab(
        tab,
        sessionsRef.current,
        tabWorkspace(tab, sessionsRef.current),
        (sessionId) => {
          const draft = composerDraftOf(sessionId);
          return (
            !!draft.text.trim() ||
            draft.attachments.length > 0 ||
            !!sessionsRef.current.find((entry) => entry.id === sessionId)?.queuedMessages?.length
          );
        },
      ),
    [tabWorkspace],
  );
  return { workspacePins, tabWorkspace, tabWorktreeOf, keepWorkspaceTab };
}
