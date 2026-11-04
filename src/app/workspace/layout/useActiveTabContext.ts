import { projectDisplayName } from "../../../features/projects/model/projectNames";
import type { Session } from "../../../features/sessions/model/session";
import type { ToolsSession } from "../../../features/host-tools/toolsSessionRegistry";
import { sessionIssue } from "../../../features/sessions/model/sessionIssue";
import { wasTurnInterrupted } from "../../../features/sessions/model/inFlight";
import { useMemo } from "react";
import { remoteSessionFor } from "../../../features/connections/model/connections";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { sessionDisplayTitle } from "../../../features/sessions/model/session";
import { leafIds } from "../../../features/workspace/model/layout";
import type { ActiveWorkspaceContext } from "../derived/useActiveWorkspaceContext";
import type { LinkedWorkItemPanelState } from "../helpers/types";

export function toolsContextForSession(session: Session): ToolsSession | null {
  const sessionId = session.cwd.startsWith("remote://") ? remoteSessionFor(session.id) : session.id;
  if (!sessionId) return null;
  return {
    cwd: session.cwd,
    sessionId,
    composerSessionId: session.id,
    title: sessionDisplayTitle(session.title, session.harness),
    projectName: projectDisplayName(session.cwd),
    branch: session.branch,
    worktreeCwd: session.worktreeCwd,
    model: `${session.harness} · ${session.model}`,
    status:
      sessionIssue(session) === "failed"
        ? "Failed"
        : session.busy || session.continuingElsewhere
          ? "Working"
          : wasTurnInterrupted(session)
            ? "Interrupted"
            : "Idle",
  };
}

export interface ActiveTabContextDeps {
  active: ActiveWorkspaceContext["active"];
  activeTab: ActiveWorkspaceContext["activeTab"];
  projectCwd: string;
  linkedWorkItemPanels: ReadonlyMap<string, LinkedWorkItemPanelState>;
}

export function useActiveTabContext({
  active,
  activeTab,
  projectCwd,
  linkedWorkItemPanels,
}: ActiveTabContextDeps) {
  const toolSessionId =
    active && (active.cwd.startsWith("remote://") ? remoteSessionFor(active.id) : active.id);
  const available = !!active && !!toolSessionId && sameProjectPath(active.cwd, projectCwd);
  const cwd = active?.cwd;
  const composerSessionId = active?.id;
  const projectName = cwd ? projectDisplayName(cwd) : undefined;
  const branch = active?.branch;
  const worktreeCwd = active?.worktreeCwd;
  const title = active ? sessionDisplayTitle(active.title, active.harness) : "";
  // One object per tool target, not per render: the footer is memoized on it.
  const conversationTools = useMemo(
    () =>
      available && cwd && toolSessionId && composerSessionId
        ? {
            cwd,
            sessionId: toolSessionId,
            composerSessionId,
            title,
            projectName,
            branch,
            worktreeCwd,
          }
        : undefined,
    [available, cwd, toolSessionId, composerSessionId, title, projectName, branch, worktreeCwd],
  );
  const activeTabSessionIds = activeTab ? leafIds(activeTab.layout) : [];
  const activeLinkedWorkItemPanel = activeTab
    ? (linkedWorkItemPanels.get(activeTab.focusedId) ??
      [...linkedWorkItemPanels.values()]
        .reverse()
        .find((panel) => activeTabSessionIds.includes(panel.sessionId)) ??
      null)
    : null;

  return { conversationTools, activeLinkedWorkItemPanel };
}
