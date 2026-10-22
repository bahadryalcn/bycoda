import { isRemoteProjectPath } from "../../projects/model/recents";
import type { Session } from "../../sessions/model/session";
import { isEmptyNewChat } from "./idleTabs";

/** Local facts about a remote shell (tab) that come from this app, not the host. */
export type RemoteShellState = {
  /** A host session is bound to this shell (live binding, or the saved stub's remoteSessionId). */
  bound: boolean;
  /** A create or send is queued for this shell, or its worktree is still being prepared. */
  pending: boolean;
  /** Unsent composer text or attachments. Recovery ignores this; cleanup must not. */
  hasDraft: boolean;
};

/** The fields needed to recognise a remote shell without its transcript. */
export type RemoteShellRef = {
  id: string;
  cwd: string;
  providerSessionId?: string | null;
};

/**
 * A remote shell this app never sent a turn from. Host session ids are minted
 * on the host when the first turn is submitted and bound to the shell then, so
 * an unbound shell with nothing queued has no host conversation to lose.
 * Decided from local state only: no network.
 */
export function isUnsentRemoteShell(shell: RemoteShellRef, state: RemoteShellState): boolean {
  if (!isRemoteProjectPath(shell.cwd)) return false;
  if (state.bound || state.pending || state.hasDraft) return false;
  return !shell.providerSessionId;
}

/** A live remote session that is unsent and has no transcript content at all. */
export function isUnsentRemoteChat(session: Session, state: RemoteShellState): boolean {
  return isUnsentRemoteShell(session, state) && isEmptyNewChat(session);
}
