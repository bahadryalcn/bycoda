import { notifyMachineGitChanged } from "../../../platform/tauri/fs";
import { hostProjectFor } from "../../automations/public/hostMachines";
import { remoteMachineFor, remoteRequest } from "../../connections/public/connections";
import { parseRemotePath, remotePath } from "../../connections/public/remoteProjects";
import { requireRemoteSupport } from "../../connections/public/remoteCapabilities";
import { t } from "../../../shared/i18n/gitCore";
import { isRemoteProjectPath } from "../../../shared/lib/paths";
import { createWorktree, type Worktree, type WorktreeRemovalReview } from "./worktrees";

export type RemoteWorktreeRemovalReview = WorktreeRemovalReview & {
  blockers: string[];
  ignoredEntryCount?: number;
  ignoredEntryPaths?: string[];
  token: string;
  expiresAt: number;
};

export const REMOTE_WORKTREE_REMOVAL = "git.worktreeRemoval.v1";

async function remoteRemovalTarget(cwd: string, path: string) {
  const { machine, environmentId } = await owningMachine(cwd);
  const target = parseRemotePath(path);
  if (!target || target.environmentId !== environmentId)
    throw new Error(t("This project’s machine isn’t connected on this computer."));
  await requireRemoteSupport(cwd, REMOTE_WORKTREE_REMOVAL);
  const project = await hostProjectFor(machine, cwd);
  return { machine, environmentId, params: { projectId: project.id, path: target.hostPath } };
}

export async function reviewRemoteWorktreeRemoval(cwd: string, path: string) {
  const { machine, environmentId, params } = await remoteRemovalTarget(cwd, path);
  return remoteRequest<RemoteWorktreeRemovalReview>(
    machine.id,
    "git.worktreeRemovalReview",
    params,
    true,
    true,
    environmentId,
  );
}

export function checkRemoteWorktreeRemoval(review: RemoteWorktreeRemovalReview) {
  if (review.blockers.length) throw new Error(review.blockers.join(" "));
  if (review.hasTerminals || review.hasAgents)
    throw new Error("Stop active terminals and agents before removing the worktree.");
  if (review.unpushed) throw new Error("Worktree has unpublished commits.");
}

export async function removeRemoteWorktree(
  cwd: string,
  path: string,
  review: RemoteWorktreeRemovalReview,
  force: boolean,
  keepSessions: boolean,
) {
  const { machine, environmentId, params } = await remoteRemovalTarget(cwd, path);
  const result = await remoteRequest<{ sessionIds: string[]; projectCwd: string }>(
    machine.id,
    "git.worktreeRemove",
    { ...params, token: review.token, force, keepSessions },
    false,
    true,
    environmentId,
  );
  notifyMachineGitChanged(environmentId);
  return result;
}

/** The machine that owns a `remote://` project, or an error that names why it is unreachable. */
async function owningMachine(cwd: string) {
  const parsed = parseRemotePath(cwd);
  if (!parsed) throw new Error(t("This project’s machine isn’t connected on this computer."));
  const machine = await remoteMachineFor(parsed.environmentId);
  if (!machine) throw new Error(t("This project’s machine isn’t connected on this computer."));
  return { machine, hostPath: parsed.hostPath, environmentId: parsed.environmentId };
}

/** Creates the worktree on the Host that owns the project, never on this computer. */
export async function createRemoteWorktree(
  cwd: string,
  branch: string,
  base: string,
  existing: boolean,
): Promise<Worktree> {
  const { machine, environmentId } = await owningMachine(cwd);
  const project = await hostProjectFor(machine, cwd);
  const created = await remoteRequest<{
    path: string;
    branch: string | null;
    head: string;
    isMain: boolean;
    missing: boolean;
    locked?: boolean;
  }>(
    machine.id,
    "git.worktreeCreate",
    { projectId: project.id, branch, base, existing },
    false,
    true,
  );
  notifyMachineGitChanged(environmentId);
  return {
    path: remotePath(environmentId, created.path),
    branch: created.branch,
    head: created.head,
    isMain: created.isMain,
    locked: created.locked ?? false,
    prunable: false,
    missing: created.missing,
    dirty: null,
    unpushed: null,
    sessionIds: [],
  };
}

/**
 * Creates a worktree where the project lives: a connected machine's project on its Host,
 * any other on this computer. Kept apart from `worktrees.ts`, which the Host bundles.
 */
export function createProjectWorktree(
  cwd: string,
  branch: string,
  base: string,
  existing: boolean,
): Promise<Worktree> {
  return isRemoteProjectPath(cwd)
    ? createRemoteWorktree(cwd, branch, base, existing)
    : createWorktree(cwd, branch, base, existing);
}
