import { hostSessionBinding } from "../../connections/model/sessionExecutionBinding";
import { generateHarnessBranchName } from "../../../integrations/harness";
import type { HarnessId } from "../../../shared/model/harnessIdentity";
import { withTimeout } from "../../../shared/lib/withTimeout";
import type { Session } from "../../sessions";
import type { ManagedWorkspace } from "./contracts";
import {
  resolveWorkspaceContext,
  workspaceRenameBranch,
  type WorkspaceContext,
} from "./workspaceClient";

/** Bound for the branch-name generation; a slow provider keeps the temporary name. */
export const BRANCH_NAME_TIMEOUT_MS = 20_000;

/** The temporary name a new managed session branch gets: `by/<8 hex>`. */
const TEMPORARY_BRANCH = /^by\/[0-9a-f]{8}$/;

/**
 * Whether this app, not the Host, names the session's branch after its first request: a local
 * native session in a managed worktree that still has its temporary branch. Host-run sessions
 * are renamed by the Host engine.
 */
export function shouldRenameTemporaryBranch(
  session: Pick<Session, "id" | "hostBinding">,
  workspace: Pick<ManagedWorkspace, "branchRef">,
): boolean {
  let hosted: boolean;
  try {
    hosted = !!hostSessionBinding(session);
  } catch {
    return false;
  }
  return !hosted && TEMPORARY_BRANCH.test(workspace.branchRef.replace(/^refs\/heads\//, ""));
}

/** A branch the Host renamed: its new name and the workspace revision that carries it. */
export type RenamedBranch = {
  branch: string;
  /** Absent when the Host's answer carries no revision (an older build). */
  revision?: number;
};

/**
 * Names the session's temporary `by/<8hex>` branch after its first request: runs
 * `generateHarnessBranchName` under a 20 s `withTimeout`, then calls `workspaceRenameBranch`
 * (`workspaces.renameBranch`). Any failure, timeout or missing v2 capability is silent and
 * keeps the temporary name. Resolves with the new branch and the workspace revision after the
 * rename, or null when nothing was renamed.
 */
export async function renameSessionBranch(input: {
  workspaceId: string;
  expectedRevision: number;
  /** The user's first message, the source for the branch fragment. */
  prompt: string;
  harness: HarnessId;
  /** The working copy the name generator runs in. */
  cwd: string;
  context: WorkspaceContext;
}): Promise<RenamedBranch | null> {
  try {
    const generated = await withTimeout(
      generateHarnessBranchName(input.harness, input.cwd, input.prompt),
      BRANCH_NAME_TIMEOUT_MS,
      "Branch name generation",
    );
    const fragment = generated?.trim().replace(/^(refs\/heads\/)?by\//, "");
    if (!fragment) return null;
    const result = await workspaceRenameBranch(
      {
        workspaceId: input.workspaceId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: `branch-rename:${input.workspaceId}`,
        fragment,
      },
      input.context,
    );
    if (!result.renamed) return null;
    // Read defensively: the revision is part of the answer on current Hosts only.
    const { revision } = result as { revision?: unknown };
    return {
      branch: result.branchRef.replace(/^refs\/heads\//, ""),
      ...(typeof revision === "number" && Number.isSafeInteger(revision) ? { revision } : {}),
    };
  } catch (error) {
    console.warn("[workspaces] branch rename skipped", error);
    return null;
  }
}

/**
 * After the first send of a local session in a new managed worktree: generates and applies the
 * branch name in parallel with the turn. Resolves with the rename or null; never rejects.
 */
export async function renameFirstSendBranch(input: {
  session: Pick<Session, "id" | "hostBinding" | "cwd" | "harness">;
  workspace: Pick<ManagedWorkspace, "id" | "revision" | "branchRef" | "path">;
  prompt: string;
}): Promise<RenamedBranch | null> {
  const { session, workspace, prompt } = input;
  if (!prompt.trim() || !shouldRenameTemporaryBranch(session, workspace)) return null;
  try {
    return await renameSessionBranch({
      workspaceId: workspace.id,
      expectedRevision: workspace.revision,
      prompt,
      harness: session.harness,
      cwd: workspace.path,
      context: await resolveWorkspaceContext(session.cwd),
    });
  } catch (error) {
    console.warn("[workspaces] branch rename skipped", error);
    return null;
  }
}
