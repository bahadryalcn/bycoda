import {
  newDefaultSession,
  newSession,
  type RuntimeMode,
  type Session,
} from "../../features/sessions/model/session";
import { sameProjectPath } from "../../features/projects/model/recents";

/** Fresh provider conversation; never copy transcript, usage or pending work. */
export function clearedWorkspaceSession(source: Session): Session {
  return {
    ...newSession(
      source.harness,
      source.cwd,
      source.model,
      source.runtimeMode,
      source.modelSettings,
    ),
    providerAccountId: source.providerAccountId,
    worktreeCwd: source.worktreeCwd,
    branch: source.branch,
    workspaceMode: source.workspaceMode,
    worktreeBase: source.worktreeBase,
  };
}

/** The caller supplies the visible project (or an explicit source session). */
export function newWorkspaceSession(
  cwd: string,
  runtimeMode?: RuntimeMode,
  focus?: { path: string; branch?: string | null } | null,
) {
  return {
    ...newDefaultSession(cwd, runtimeMode),
    ...(focus && !sameProjectPath(focus.path, cwd)
      ? { worktreeCwd: focus.path, branch: focus.branch ?? undefined }
      : {}),
  };
}
