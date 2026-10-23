import { isRemoteProjectPath } from "../../projects/model/recents";
import type { RemoteShellState } from "../../workspace/model/remoteEmptyChats";
import { remotePendingWorktree, remoteSessionFor, remoteTabBindingsReadable } from "./connections";
import { remoteCreateIntent } from "./remoteCreateIntent";
import { pendingRemoteCommand } from "./remoteOutbox";
import { remoteProjectFor } from "./remoteProjects";

/**
 * Local facts about a remote shell, read from this app's own storage. A shell
 * whose project is not known here is reported as pending, so it is kept, as is
 * every shell while the tab bindings cannot be read. A saved stub's host id
 * and the live binding both count as bound. A shell creating its host session
 * is pending too, as is one with a command waiting in the outbox.
 */
export function remoteShellState(
  shell: { id: string; cwd: string },
  options: { bound?: boolean; hasDraft?: boolean } = {},
): RemoteShellState {
  const bound = !!options.bound || !!remoteSessionFor(shell.id);
  const hasDraft = options.hasDraft ?? false;
  if (!isRemoteProjectPath(shell.cwd)) return { bound, pending: false, hasDraft };
  const project = remoteProjectFor(shell.cwd);
  const pending =
    !project ||
    !remoteTabBindingsReadable() ||
    !!remotePendingWorktree(shell.id) ||
    // Between submitting the first message and its outbox entry (or binding)
    // the draft is already cleared and nothing else shows the tab is sending.
    !!remoteCreateIntent(shell.id) ||
    !!pendingRemoteCommand(project.key, project.environmentId, null, shell.id);
  return { bound, pending, hasDraft };
}
