import { useCallback, useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
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

/** Read-only observation. Creation always resolves the ref again on the owning Host. */
export async function loadWorkspaceCreation(
  cwd: string,
  selectedBase?: string,
  choice?: WorkspaceMode,
): Promise<{ policy?: WorkspacePolicy; preview?: WorkspaceCreationPreview }> {
  // Legacy Hosts have no project policy and retain their current-checkout behavior.
  // A failed policy read on a capable Host remains an error, never a fallback.
  const capabilities = await getWorkspaceCapabilities({ cwd });
  if (!capabilities.includes("workspaces.policy.v1")) {
    if (choice === "worktree") await requireWorkspaceCapability("workspaces.managed.v1", { cwd });
    else return {};
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
  if ((choice ?? resolved.policy.defaultMode) === "current") return { policy: resolved.policy };
  await requireWorkspaceCapability("workspaces.managed.v1", context);
  const baseRef = selectedBase || resolved.policy.integrationBranchRef;
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
  return { policy: resolved.policy, preview: { baseRef, baseCommit, excludedPaths } };
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
    setResult(undefined);
    if (!managedActive || !cwd || cwd === "~") return;
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
    result.base === base &&
    result.reload === reload
      ? result
      : undefined;
  return {
    mode: choice ?? current?.policy?.defaultMode ?? "current",
    base:
      base ||
      (current?.policy ? shortWorkspaceRef(current.policy.integrationBranchRef) : undefined),
    preview: current?.preview,
    error: current?.error,
    updateRequired: current?.updateRequired ?? false,
    pending: managedActive && !current,
    refresh,
  };
}
