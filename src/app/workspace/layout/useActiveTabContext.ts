import { remoteSessionFor } from "../../../features/connections/model/connections";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { sessionDisplayTitle } from "../../../features/sessions/model/session";
import { leafIds } from "../../../features/workspace/model/layout";
import type { ActiveWorkspaceContext } from "../derived/useActiveWorkspaceContext";
import type { LinkedWorkItemPanelState } from "../helpers/types";

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
  const conversationTools =
    active && toolSessionId && sameProjectPath(active.cwd, projectCwd)
      ? {
          cwd: active.cwd,
          sessionId: toolSessionId,
          composerSessionId: active.id,
          title: sessionDisplayTitle(active.title, active.harness),
        }
      : undefined;
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
