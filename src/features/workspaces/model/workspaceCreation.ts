import { useCallback, useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { gitHistory, subscribeGitChanged } from "../../../platform/tauri/fs";
import { parseRemotePath, remotePath } from "../../connections/model/remoteProjects";
import type { WorkspaceMode } from "../../sessions/model/session";
import { fetchGitIndex } from "../../source-control/model/gitIndexStore";
import { listWorktrees } from "../../source-control/model/worktrees";
import type { WorkspacePolicy } from "./contracts";
import {
  requireWorkspaceCapability,
  resolveWorkspaceContext,
  workspaceRequest,
} from "./workspaceClient";

export type WorkspaceCreationPreview = {
  baseRef: string;
  baseCommit: string;
  excludedPaths: number;
};
export const shortWorkspaceRef = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, "");

/** Read-only observation. Creation always resolves the ref again on the owning Host. */
export async function loadWorkspaceCreation(cwd: string, selectedBase?: string) {
  const context = await resolveWorkspaceContext(cwd);
  await requireWorkspaceCapability("workspaces.managed.v1", context);
  const { resolved } = await workspaceRequest(
    "projects.workspacePolicy.get",
    {
      projectId: context.projectId,
      environmentId: context.environmentId,
    },
    context,
  );
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
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{
    cwd: string;
    base?: string;
    policy?: WorkspacePolicy;
    preview?: WorkspaceCreationPreview;
    error?: string;
  }>();
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    if (!active) return;
    window.addEventListener("focus", refresh);
    const unsubscribe = subscribeGitChanged(refresh, { cwd });
    return () => {
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [active, cwd, refresh]);
  useEffect(() => {
    if (!active || !cwd || cwd === "~") return;
    let cancelled = false;
    setResult(undefined);
    void loadWorkspaceCreation(cwd, base).then(
      (value) => {
        if (!cancelled) setResult({ cwd, base, ...value });
      },
      (error: unknown) => {
        if (!cancelled)
          setResult({ cwd, base, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cwd, active, base, reload]);
  const current = result?.cwd === cwd && result.base === base ? result : undefined;
  return {
    mode: choice ?? current?.policy?.defaultMode ?? "worktree",
    base:
      base ||
      (current?.policy ? shortWorkspaceRef(current.policy.integrationBranchRef) : undefined),
    preview: current?.preview,
    error: current?.error,
    pending: active && !current,
    refresh,
  };
}
