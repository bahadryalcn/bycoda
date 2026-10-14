import { newDefaultSession, type RuntimeMode } from "../../features/sessions/model/session";
import { sameProjectPath } from "../../features/projects/model/recents";

/** The caller supplies the visible project (or an explicit source session). */
export function newWorkspaceSession(cwd: string, runtimeMode?: RuntimeMode,
  focus?: { path: string; branch?: string | null } | null) {
  return {
    ...newDefaultSession(cwd, runtimeMode),
    ...(focus && !sameProjectPath(focus.path, cwd)
      ? { worktreeCwd: focus.path, branch: focus.branch ?? undefined } : {}),
  };
}
