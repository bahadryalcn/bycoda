import { errorText } from "../../../shared/lib/errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { TimeoutError, withTimeout } from "../../../shared/lib/withTimeout";
import { gitHistory, isGitWatched, subscribeGitChanged } from "../../../platform/tauri/fs";
import { parseRemotePath, remotePath } from "../../connections/public/remoteProjects";
import { subscribeRemoteCapabilities } from "../../connections/model/connections";
import { subscribeRemoteRecovered } from "../../connections/model/remoteHealth";
import { invalidateMachineSnapshot } from "../../automations/model/machineSnapshot";
import type { WorkspaceMode } from "../../sessions";
import { isProjectlessCwd } from "../../sessions/public/projectless";
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
  /** The new worktree starts from the base's fetched upstream (`workspaces.creation.v2`). */
  baseFromRemote?: boolean;
  /** Display name of the base, e.g. "main" or "From main (remote)"; absent on hand-built previews. */
  baseLabel?: string;
};

/** "main", or "From main (remote)" when the worktree starts from the fetched upstream. */
export const workspaceBaseLabel = (baseRef: string, baseFromRemote: boolean) =>
  baseFromRemote
    ? t("From {p0} (remote)", { p0: shortWorkspaceRef(baseRef) })
    : shortWorkspaceRef(baseRef);
export const shortWorkspaceRef = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, "");

/** Bound for the policy reads that gate Send; a slow Host must not block a new draft. */
export const WORKSPACE_POLICY_READ_TIMEOUT_MS = 1500;
const EXPLICIT_WORKTREE_READ_TIMEOUT_MS = 10_000;

export type WorkspaceCreationResult = {
  policy?: WorkspacePolicy;
  preview?: WorkspaceCreationPreview;
  /** Set when the policy could not be read and the current checkout is used instead. */
  warning?: string;
  /** Checkout whose Git index backs `preview.excludedPaths`, so a count refresh can re-read only it. */
  sourceCwd?: string;
};

type GitIndexCount = { files: { relative: string }[]; conflicts?: { relative: string }[] };
const countExcludedPaths = (index: GitIndexCount) =>
  new Set([
    ...index.files.map((file) => file.relative),
    ...(index.conflicts ?? []).map((file) => file.relative),
  ]).size;

/** Quiet period after the last working-tree change before the dirty-file count is re-read. */
const EXCLUDED_COUNT_DEBOUNCE_MS = 500;

/** Read-only observation. Creation always resolves the ref again on the owning Host. */
export async function loadWorkspaceCreation(
  cwd: string,
  selectedBase?: string,
  choice?: WorkspaceMode,
  baseFromRemote = false,
): Promise<WorkspaceCreationResult> {
  // Only an explicit worktree choice is a hard error; anything else falls back to the
  // current checkout with a warning so an unavailable Host never blocks Send.
  const explicit = choice === "worktree";
  const timeoutMs = explicit ? EXPLICIT_WORKTREE_READ_TIMEOUT_MS : WORKSPACE_POLICY_READ_TIMEOUT_MS;
  const fallback = (error: unknown): WorkspaceCreationResult => {
    console.warn("[workspaces] policy read unavailable; using the current checkout", error);
    return { warning: errorText(error) };
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
      readWorkspacePreview(cwd, selectedBase, read.policy, baseFromRemote),
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
  // A policy that resolves to the current checkout needs no worktree preview chain.
  if ((choice ?? resolved.policy.defaultMode) === "current")
    return { done: { policy: resolved.policy } };
  await requireWorkspaceCapability("workspaces.managed.v1", context);
  return { policy: resolved.policy };
}

async function readWorkspacePreview(
  cwd: string,
  selectedBase: string | undefined,
  policy: WorkspacePolicy,
  baseFromRemote: boolean,
): Promise<WorkspaceCreationResult> {
  const baseRef = selectedBase || policy.integrationBranchRef;
  const trees = await listWorktrees(cwd, { light: true });
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
  const excludedPaths = countExcludedPaths(index);
  return {
    policy,
    preview: {
      baseRef,
      baseCommit,
      excludedPaths,
      baseFromRemote,
      baseLabel: workspaceBaseLabel(baseRef, baseFromRemote),
    },
    sourceCwd,
  };
}

export function useWorkspaceCreation(
  cwd: string,
  active: boolean,
  choice?: WorkspaceMode,
  base?: string,
  baseFromRemote = false,
) {
  const hasProject = Boolean(cwd) && !isProjectlessCwd(cwd);
  const managedActive = active && hasProject && choice !== "current";
  const [result, setResult] = useState<{
    cwd: string;
    choice?: WorkspaceMode;
    base?: string;
    baseFromRemote?: boolean;
    policy?: WorkspacePolicy;
    preview?: WorkspaceCreationPreview;
    error?: string;
    warning?: string;
    updateRequired?: boolean;
  }>();
  // The running load for the current cwd/choice/base. A plain refresh never cancels it: it marks the
  // load dirty and one more read runs after it settles, so a busy checkout cannot starve the result.
  // A `supersede` refresh (Host recovered, capabilities changed) makes the running answer stale.
  const requestRef = useRef<(supersede?: boolean) => void>(undefined);
  const refresh = useCallback(() => requestRef.current?.(), []);
  const supersede = useCallback(() => requestRef.current?.(true), []);
  // Working-tree changes only move the dirty-file count; this re-reads just that, never the full chain.
  const countRef = useRef<() => void>(undefined);
  const refreshCount = useCallback(() => countRef.current?.(), []);
  useEffect(() => {
    if (!managedActive) return;
    // A watched checkout reports ref changes itself; focus only catches up on an unwatched one.
    const onFocus = () => {
      if (!isGitWatched(cwd)) refresh();
    };
    window.addEventListener("focus", onFocus);
    // The preview reads refs; working-tree churn must not restart it.
    const unsubscribe = subscribeGitChanged(refresh, { cwd, refsOnly: true });
    // Index-only changes (edits, staging) refresh the cheap dirty-file count; every other change
    // kind already arrived through the refs subscription above.
    const unsubscribeIndex = subscribeGitChanged(
      (change) => {
        if (change?.scope === "index") refreshCount();
      },
      { cwd },
    );
    const unsubscribeRecovered = subscribeRemoteRecovered((environmentId) => {
      const remote = parseRemotePath(cwd);
      if (!remote || !environmentId || remote.environmentId === environmentId) supersede();
    });
    const unsubscribeCapabilities = subscribeRemoteCapabilities(() => {
      // Descriptors can change without a disconnect. The snapshot cache must
      // forget its previous answer before the hook asks for the new policy.
      invalidateMachineSnapshot();
      supersede();
    });
    return () => {
      window.removeEventListener("focus", onFocus);
      unsubscribe();
      unsubscribeIndex();
      unsubscribeRecovered();
      unsubscribeCapabilities();
    };
  }, [managedActive, cwd, refresh, refreshCount, supersede]);
  useEffect(() => {
    if (!managedActive) {
      requestRef.current = undefined;
      countRef.current = undefined;
      setResult(undefined);
      return;
    }
    // A refresh keeps the last answer for the same project/choice/base until the new one
    // lands, so Send does not flicker disabled; only a changed key discards it.
    let cancelled = false;
    let running = false;
    let dirty = false;
    let generation = 0;
    let sourceCwd: string | undefined;
    let countTimer: ReturnType<typeof setTimeout> | undefined;
    let countRunning = false;
    let countDirty = false;
    const readCount = () => {
      countTimer = undefined;
      // The full load reads the index itself; a change during either read is re-counted afterwards.
      if (!sourceCwd || running || countRunning) {
        countDirty = true;
        return;
      }
      countRunning = true;
      countDirty = false;
      const loadGeneration = generation;
      fetchGitIndex(sourceCwd, { full: true })
        .then(
          (index) => {
            // A newer load owns the preview now; this count would be older than its own read.
            if (cancelled || running || loadGeneration !== generation) return;
            const excludedPaths = countExcludedPaths(index);
            setResult((previous) =>
              previous?.preview &&
              previous.cwd === cwd &&
              previous.choice === choice &&
              previous.base === base &&
              previous.baseFromRemote === baseFromRemote &&
              previous.preview.excludedPaths !== excludedPaths
                ? { ...previous, preview: { ...previous.preview, excludedPaths } }
                : previous,
            );
          },
          (error: unknown) => console.warn("[workspaces] dirty-file count unavailable", error),
        )
        .finally(() => {
          countRunning = false;
          if (!cancelled && countDirty) scheduleCount();
        });
    };
    const scheduleCount = () => {
      clearTimeout(countTimer);
      countTimer = setTimeout(readCount, EXCLUDED_COUNT_DEBOUNCE_MS);
    };
    const run = (replace = false) => {
      if (running && !replace) {
        dirty = true;
        return;
      }
      running = true;
      dirty = false;
      const mine = ++generation;
      loadWorkspaceCreation(cwd, base, choice, baseFromRemote)
        .then(
          ({ sourceCwd: source, ...value }) => {
            if (cancelled || mine !== generation) return;
            sourceCwd = source;
            setResult({ cwd, choice, base, baseFromRemote, ...value });
          },
          (error: unknown) => {
            if (cancelled || mine !== generation) return;
            sourceCwd = undefined;
            setResult({
              cwd,
              choice,
              base,
              baseFromRemote,
              error: errorText(error),
              updateRequired: error instanceof WorkspaceCapabilityError,
            });
          },
        )
        .finally(() => {
          if (mine !== generation) return;
          running = false;
          if (cancelled) return;
          if (dirty) run();
          else if (countDirty) scheduleCount();
        });
    };
    requestRef.current = run;
    countRef.current = scheduleCount;
    run();
    return () => {
      cancelled = true;
      clearTimeout(countTimer);
      if (countRef.current === scheduleCount) countRef.current = undefined;
      if (requestRef.current === run) requestRef.current = undefined;
    };
  }, [cwd, managedActive, choice, base, baseFromRemote]);
  const current =
    managedActive &&
    result?.cwd === cwd &&
    result.choice === choice &&
    result.base === base &&
    result.baseFromRemote === baseFromRemote
      ? result
      : undefined;
  return {
    // A warning means the policy was unreadable: behave as the current checkout.
    mode: hasProject
      ? (choice ?? (current?.warning ? undefined : current?.policy?.defaultMode) ?? "current")
      : "current",
    base: hasProject
      ? base ||
        (current?.policy ? shortWorkspaceRef(current.policy.integrationBranchRef) : undefined)
      : undefined,
    preview: current?.preview,
    error: current?.error,
    warning: current?.warning,
    updateRequired: current?.updateRequired ?? false,
    pending: managedActive && !current,
    refresh,
  };
}
