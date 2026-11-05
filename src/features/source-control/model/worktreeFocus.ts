import { useSyncExternalStore } from "react";
import { pathKey } from "../../../shared/lib/paths";
import { createStore } from "../../../shared/lib/store";

/** The working copy a project's sidebar is narrowed to. New sessions in that
 * project start there too. Kept for this run only: the app reopens on each
 * project's default workspace. */
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

export function inWorktreeFocus(
  session: { cwd: string; worktreeCwd?: string },
  focus: WorktreeFocus | undefined,
): boolean {
  return !focus || pathKey(session.worktreeCwd || session.cwd) === pathKey(focus.path);
}
