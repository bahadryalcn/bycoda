import { createHash } from "node:crypto";
import { runGitText } from "../src/shared/lib/processExecution.node";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import type {
  BranchDeliveryService,
  ExecutionActivityReservations,
  WorkspaceRegistry,
  WorkspaceRemovalService,
  WorkspaceOwnerAuthorization,
  WorkspacePolicyResolver,
} from "./workspace-service-contracts";
import { createWorkspacePolicyResolver } from "./workspace-policy";
import type { HostStore } from "./store";
import type { ManagedWorkspace, WorkspaceMutation } from "./workspace-contracts";

/** Supplied by the execution host. Never construct a second registry in an orchestrator. */
export interface TaskWorkspaceServices {
  policy?: WorkspacePolicyResolver;
  registry: WorkspaceRegistry;
  activity: ExecutionActivityReservations;
  removal: WorkspaceRemovalService;
  delivery: BranchDeliveryService;
  environmentId: string;
  /** S1 extension: owner-authorized target changes must advance the registry revision,
   * invalidating earlier delivery plans. The frozen update contract excludes target refs. */
  retargetWorkspace?(
    request: WorkspaceMutation & { targetBranchRef: string; targetDirectory: string },
    owner: WorkspaceOwnerAuthorization,
  ): Promise<ManagedWorkspace>;
}

/** Explicit writer choices override stored project policy; omitted choices inherit it. */
export async function writerWorkspaceMode(
  store: HostStore,
  services: { policy?: WorkspacePolicyResolver; environmentId: string } | undefined,
  projectId: string,
  isolate?: boolean,
): Promise<"current" | "worktree"> {
  if (isolate !== undefined) return isolate ? "worktree" : "current";
  const resolved = await (services?.policy ?? createWorkspacePolicyResolver(store)).resolve({
    projectId,
    environmentId: services?.environmentId ?? store.environmentId,
  });
  return resolved.policy.defaultMode;
}

export interface TaskFinalizationPreview {
  branch: string;
  head: string;
  status: string;
  diff: string;
  fingerprint: string;
  clean: boolean;
}

/** Read only: unexpected files must never become a blanket Host-created commit. */
export async function previewTaskFinalization(
  cwd: string,
  branch: string,
): Promise<TaskFinalizationPreview> {
  const git = (args: string[]) =>
    runGitText(args, {
      cwd,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
  const current = (await git(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  if (current !== branch.replace(/^refs\/heads\//, ""))
    throw new Error("The task branch changed. Restore its assigned branch before finalization.");
  const [head, status, diff] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["status", "--porcelain=v1", "--untracked-files=all"]),
    git(["diff", "HEAD", "--no-ext-diff", "--binary"]),
  ]);
  return {
    branch: current,
    head: head.trim(),
    status,
    diff,
    fingerprint: createHash("sha256").update(head).update(status).update(diff).digest("hex"),
    clean: !status.trim(),
  };
}

export function suspendedTaskDelivery(task: HostTask): HostTask {
  return task.autoMerge || task.deliveryRequested
    ? {
        ...task,
        autoMerge: undefined,
        deliveryRequested: undefined,
        deliveryApprovalRequired: true,
        deliveryState: task.merged ? "merged" : "awaitingOwner",
      }
    : task;
}
