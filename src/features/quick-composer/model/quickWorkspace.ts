import type { WorkspaceMode, Session } from "../../sessions/model/session";
import type { QuickLaunch } from "./quickComposer";
import { listWorktrees, type Worktree } from "../../source-control/model/worktrees";
import { pathKey } from "../../../shared/lib/paths";

export type QuickWorkspace = {
  cwd: string | null;
  mode?: WorkspaceMode;
  /** Read-only policy resolution passed through the native popup boundary. */
  resolvedMode?: WorkspaceMode;
  base?: string;
  tree?: Worktree;
};

/** Switching projects must never carry another repository's working copy/base. */
export function workspaceForProject(choice: QuickWorkspace, cwd: string | null): QuickWorkspace {
  return choice.cwd === cwd ? choice : { cwd };
}

export async function quickWorkspaceLaunch(
  choice: QuickWorkspace,
): Promise<Pick<QuickLaunch, "workspaceMode" | "worktreeBase" | "worktreeCwd">> {
  if (choice.mode === "worktree") {
    return { workspaceMode: "worktree", worktreeBase: choice.base || "HEAD" };
  }
  if (choice.tree && choice.cwd) {
    const listed = await listWorktrees(choice.cwd);
    const tree = listed.worktrees.find(
      (tree) => !tree.missing && pathKey(tree.path) === pathKey(choice.tree!.path),
    );
    if (!tree)
      throw new Error("This worktree is no longer available. Select another working copy.");
    return pathKey(tree.path) === pathKey(choice.cwd)
      ? { workspaceMode: "current" }
      : { worktreeCwd: tree.path };
  }
  return choice.mode === "current" ? { workspaceMode: "current" } : {};
}

/** Feed the same deferred worktree creation path that the main composer uses. */
export function applyQuickWorkspace(session: Session, launch: QuickLaunch): Session {
  if (launch.workspaceMode === "worktree") {
    return {
      ...session,
      workspaceMode: "worktree",
      worktreeBase: launch.worktreeBase || "HEAD",
    };
  }
  if (launch.worktreeCwd) return { ...session, worktreeCwd: launch.worktreeCwd };
  return launch.workspaceMode === "current" ? { ...session, workspaceMode: "current" } : session;
}
