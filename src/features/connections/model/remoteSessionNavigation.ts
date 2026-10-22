import type { Session } from "../../sessions/model/session";
import { sameProjectPath } from "../../projects/model/recents";
import { leafIds, type WorkspaceTab } from "../../workspace/model/layout";

/** Host session IDs are resolved only within the selected remote project. */
export function findRemoteSessionTab(
  tabs: readonly WorkspaceTab[],
  sessions: readonly Session[],
  project: string,
  sessionId: string,
  remoteSessionFor: (shellId: string) => string | undefined,
) {
  for (const tab of tabs) {
    const shellId = leafIds(tab.layout).find((id) => {
      const shell = sessions.find((session) => session.id === id);
      return shell && sameProjectPath(shell.cwd, project) && remoteSessionFor(id) === sessionId;
    });
    if (shellId) return { tab, shellId };
  }
  return undefined;
}
