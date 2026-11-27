import { useSyncExternalStore } from "react";
import { pathKey } from "../../../shared/lib/paths";
import { createStore } from "../../../shared/lib/store";

/** The worktree a project's header is focused on; the project folder is one too. It scopes
 * the Changes panel and where new sessions start; the session list always shows every
 * session. No focus means "All repositories": the Changes overview, and new sessions start
 * in the project folder. Kept for this run only: the app reopens on All repositories. */
export type WorktreeFocus = { path: string; branch: string | null };

const listeners = createStore();
let focuses: Record<string, WorktreeFocus> = {};

export function worktreeFocus(project: string): WorktreeFocus | undefined {
  return focuses[pathKey(project)];
}

export function setWorktreeFocus(project: string, focus: WorktreeFocus | undefined) {
  const next = { ...focuses };
  if (focus) next[pathKey(project)] = focus;
  else delete next[pathKey(project)];
  focuses = next;
  listeners.notify();
}

export function useWorktreeFocus(project: string): WorktreeFocus | undefined {
  return useSyncExternalStore(listeners.subscribe, () => worktreeFocus(project));
}
