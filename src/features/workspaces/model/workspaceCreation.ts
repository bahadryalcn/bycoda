import { useCallback, useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { TimeoutError, withTimeout } from "../../../shared/lib/withTimeout";
import { gitHistory, subscribeGitChanged } from "../../../platform/tauri/fs";
import { parseRemotePath, remotePath } from "../../connections/model/remoteProjects";
import { subscribeRemoteCapabilities } from "../../connections/model/connections";
import { subscribeRemoteRecovered } from "../../connections/model/remoteHealth";
import { invalidateMachineSnapshot } from "../../automations/model/machineSnapshot";
import type { WorkspaceMode } from "../../sessions/model/session";
import { fetchGitIndex } from "../../source-control/model/gitIndexStore";
import { listWorktrees } from "../../source-control/model/worktrees";
import type { WorkspacePolicy } from "./contracts";
import {
  getWorkspaceCapabilities,
  requireWorkspaceCapability,
  resolveWorkspaceContext,
  workspaceRequest,
  WorkspaceCapabilityError,
} from "./workspaceClient";

export type WorkspaceCreationPreview = {
  baseRef: string;
  baseCommit: string;
  excludedPaths: number;
};
export const shortWorkspaceRef = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, "");

/** Bound for the policy reads that gate Send; a slow Host must not block a new draft. */
export const WORKSPACE_POLICY_READ_TIMEOUT_MS = 1500;
const EXPLICIT_WORKTREE_READ_TIMEOUT_MS = 10_000;

export type WorkspaceCreationResult = {
  policy?: WorkspacePolicy;
  preview?: WorkspaceCreationPreview;
  /** Set when the policy could not be read and the current checkout is used instead. */
  warning?: string;
};

/** Read-only observation. Creation always resolves the ref again on the owning Host. */
export async function loadWorkspaceCreation(
  cwd: string,
  selectedBase?: string,
  choice?: WorkspaceMode,
): Promise<WorkspaceCreationResult> {
  // Only an explicit worktree choice is a hard error; anything else falls back to the
  // current checkout with a warning so an unavailable Host never blocks Send.
  const explicit = choice === "worktree";
  const timeoutMs = explicit ? EXPLICIT_WORKTREE_READ_TIMEOUT_MS : WORKSPACE_POLICY_READ_TIMEOUT_MS;
  const fallback = (error: unknown): WorkspaceCreationResult => {
    console.warn("[workspaces] policy read unavailable; using the current checkout", error);
    return { warning: error instanceof Error ? error.message : String(error) };
  };
  let read: PolicyRead;
  try {
    read = await withTimeout(readWorkspacePolicy(cwd, choice), timeoutMs, "Workspace policy read");
  } catch (error) {
    if (explicit) throw error;
    return fallback(error);
  }
  if (read.done) return read.done;
  try {
    return await withTimeout(
      readWorkspacePreview(cwd, selectedBase, read.policy),
      explicit ? EXPLICIT_WORKTREE_READ_TIMEOUT_MS * 3 : timeoutMs * 4,
      "Workspace preview",
    );
  } catch (error) {
    if (explicit || !(error instanceof TimeoutError)) throw error;
    return fallback(error);
  }
}

/** Either a finished result (legacy Host, current mode) or the policy that needs a preview. */
type PolicyRead = { done: WorkspaceCreationResult } | { done?: undefined; policy: WorkspacePolicy };

async function readWorkspacePolicy(cwd: string, choice?: WorkspaceMode): Promise<PolicyRead> {
  // Legacy Hosts have no project policy and retain their current-checkout behavior.
  const capabilities = await getWorkspaceCapabilities({ cwd });
  if (!capabilities.includes("workspaces.policy.v1")) {
    if (choice === "worktree") await requireWorkspaceCapability("workspaces.managed.v1", { cwd });
    else return { done: {} };
  }
  const context = await resolveWorkspaceContext(cwd);
  const { resolved } = await workspaceRequest(
    "projects.workspacePolicy.get",
    {
      projectId: context.projectId,
      environmentId: context.environmentId,
    },
    context,
  );
  if ((choice ?? resolved.policy.defaultMode) === "current")
    return { done: { policy: resolved.policy } };
  await requireWorkspaceCapability("workspaces.managed.v1", context);
  return { policy: resolved.policy };
}

async function readWorkspacePreview(
  cwd: string,
  selectedBase: string | undefined,
  policy: WorkspacePolicy,
): Promise<WorkspaceCreationResult> {
  const baseRef = selectedBase || policy.integrationBranchRef;
  const trees = await listWorktrees(cwd);
  const main = trees.worktrees.find((tree) => tree.isMain);
  const parsed = parseRemotePath(cwd);
  const sourceCwd = main
    ? parsed && !parseRemotePath(main.path)
      ? remotePath(parsed.environmentId, main.path)
      : main.path
    : cwd;
  const index = await fetchGitIndex(sourceCwd, { full: true });
  const normalized = shortWorkspaceRef(baseRef);
  let baseCommit =
    baseRef === "HEAD" || index.branch === normalized
      ? index.head || undefined
      : trees.worktrees.find((tree) => tree.branch === normalized)?.head;
  if (!baseCommit) {
    const history = await gitHistory(cwd, 200, true);
    baseCommit = history.commits.find(
      (commit) => commit.sha === baseRef || commit.refs.some((ref) => ref.name === normalized),
    )?.sha;
  }
  if (!baseCommit)
    throw new Error(
      t("The selected base could not be verified. Refresh or choose another branch."),
    );
  const excludedPaths = new Set([
    ...index.files.map((file) => file.relative),
    ...(index.conflicts ?? []).map((file) => file.relative),
  ]).size;
  return { policy, preview: { baseRef, baseCommit, excludedPaths } };
}

export function useWorkspaceCreation(
  cwd: string,
  active: boolean,
  choice?: WorkspaceMode,
  base?: string,
) {
  const managedActive = active && choice !== "current";
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{
    cwd: string;
    choice?: WorkspaceMode;
    base?: string;
    reload: number;
    policy?: WorkspacePolicy;
    preview?: WorkspaceCreationPreview;
    error?: string;
    warning?: string;
    updateRequired?: boolean;
  }>();
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    if (!managedActive) return;
    window.addEventListener("focus", refresh);
    const unsubscribe = subscribeGitChanged(refresh, { cwd });
    const unsubscribeRecovered = subscribeRemoteRecovered((environmentId) => {
      const remote = parseRemotePath(cwd);
      if (!remote || !environmentId || remote.environmentId === environmentId) refresh();
    });
    const unsubscribeCapabilities = subscribeRemoteCapabilities(() => {
      // Descriptors can change without a disconnect. The snapshot cache must
      // forget its previous answer before the hook asks for the new policy.
      invalidateMachineSnapshot();
      refresh();
    });
    return () => {
      window.removeEventListener("focus", refresh);
      unsubscribe();
      unsubscribeRecovered();
      unsubscribeCapabilities();
    };
  }, [managedActive, cwd, refresh]);
  useEffect(() => {
    if (!managedActive || !cwd || cwd === "~") {
      setResult(undefined);
      return;
    }
    // A refresh (focus, git change, capability event) keeps the last answer for the
    // same project/choice/base until the new one lands, so Send does not flicker disabled.
    let cancelled = false;
    void loadWorkspaceCreation(cwd, base, choice).then(
      (value) => {
        if (!cancelled) setResult({ cwd, choice, base, reload, ...value });
      },
      (error: unknown) => {
        if (!cancelled)
          setResult({
            cwd,
            choice,
            base,
            reload,
            error: error instanceof Error ? error.message : String(error),
            updateRequired: error instanceof WorkspaceCapabilityError,
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cwd, managedActive, choice, base, reload]);
  const current =
    managedActive &&
    result?.cwd === cwd &&
    result.choice === choice &&
    result.base === base
      ? result
      : undefined;
  return {
    // A warning means the policy was unreadable: behave as the current checkout.
    mode: choice ?? (current?.warning ? undefined : current?.policy?.defaultMode) ?? "current",
    base:
      base ||
      (current?.policy ? shortWorkspaceRef(current.policy.integrationBranchRef) : undefined),
    preview: current?.preview,
    error: current?.error,
    warning: current?.warning,
    updateRequired: current?.updateRequired ?? false,
    pending: managedActive && !current,
    refresh,
  };
}
