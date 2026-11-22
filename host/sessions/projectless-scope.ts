import { createHash } from "node:crypto";
import { PROJECTLESS_PROJECT_ID } from "../../src/shared/model/host-contracts/projectless-sessions";
import { resolveSessionCwd, sessionScratchCwd } from "../providers/session-folder";

/** Not a path: the `projects` row only satisfies the sessions foreign key. */
export const PROJECTLESS_SCOPE_CWD = "bycoda-projectless://sessions";

export const PROJECTLESS_SCOPE = {
  id: PROJECTLESS_PROJECT_ID,
  cwd: PROJECTLESS_SCOPE_CWD,
  name: "~",
};

export function isProjectlessScope(projectId: string): boolean {
  return projectId === PROJECTLESS_PROJECT_ID;
}

/** Refuses every client-chosen location before any workspace or folder work. */
export function assertProjectlessCreate(input: Record<string, unknown>): void {
  if (
    input.workspaceId !== undefined ||
    input.worktreeCwd !== undefined ||
    input.autoWorktreeBranch !== undefined ||
    input.workspaceMode === "worktree"
  )
    throw new Error("Sessions without a project use a Host-managed folder");
}

/**
 * The folder is keyed by the command, not a client session id, so a chosen id cannot
 * reach another session's scratch and a retried command finds the same folder.
 */
export async function projectlessSessionCwd(commandId: string): Promise<string> {
  const key = createHash("sha256").update(`projectless-scratch:${commandId}`).digest("hex");
  const cwd = await resolveSessionCwd(sessionScratchCwd(key.slice(0, 32)));
  if (!cwd) throw new Error("Invalid session scratch directory");
  return cwd;
}
