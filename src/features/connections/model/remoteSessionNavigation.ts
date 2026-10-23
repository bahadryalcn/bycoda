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

/**
 * The open tab that already owns a host session: the tab bound to it, or the tab
 * of the shell whose first message is creating it (the host lists a new session
 * before the `create` receipt binds it, so no binding exists yet).
 */
export function resolveRemoteSessionTarget(
  tabs: readonly WorkspaceTab[],
  sessions: readonly Session[],
  project: string,
  sessionId: string,
  remoteSessionFor: (shellId: string) => string | undefined,
  createShellFor: (
    sessionId: string,
    sameProject: (project: string) => boolean,
  ) => string | undefined,
) {
  const bound = findRemoteSessionTab(tabs, sessions, project, sessionId, remoteSessionFor);
  if (bound) return bound;
  const shellId = createShellFor(sessionId, (other) => sameProjectPath(other, project));
  if (!shellId) return undefined;
  const tab = tabs.find((entry) => leafIds(entry.layout).includes(shellId));
  return tab && sessions.some((session) => session.id === shellId) ? { tab, shellId } : undefined;
}
