import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { withHostGitMutation } from "../git/git-mutations";
import {
  createExtraWorktree,
  equivalentBase,
  fetchRemoteBase,
  managedWorkspaceRoot,
  type ExtraWorktreeRecord,
} from "../git/git-worktrees";
import { markManagedWorkspaceBranch } from "./workspace-branch-naming";
import type {
  ManagedWorkspace,
  WorkspaceCreationStage,
  WorkspaceCreationStageId,
} from "../workspaces/workspace-contracts";
import type { WorkspaceCreationProgressRegistry } from "../workspaces/workspace-service-contracts";

/** Siblings are created at most this many at a time. */
const EXTRA_PARALLELISM = 4;

export class WorkspaceCreationCancelled extends Error {
  readonly code = "WORKSPACE_CREATION_CANCELLED";
  constructor() {
    super("Workspace creation was cancelled");
  }
}

/** A timeout or kill leaves Git's outcome unknown: the operation is recovered, never rolled back. */
export function outcomeUnknown(error: unknown): boolean {
  const failure = error as { killed?: boolean; code?: unknown; message?: unknown };
  return (
    failure?.killed === true ||
    failure?.code === "ETIMEDOUT" ||
    /timed out/i.test(String(failure?.message ?? ""))
  );
}

/** The client-visible state of one `workspaces.prepare` call; a no-op without a progress id. */
export interface CreationRun {
  readonly signal: AbortSignal | undefined;
  /** Repositories in this creation, the primary included. */
  total: number;
  /** Git was reached, so a definite failure may have left something to remove. */
  gitReached: boolean;
  check(): void;
  stage(id: WorkspaceCreationStageId, status: WorkspaceCreationStage["status"]): void;
  /** Checkout percent of repository `index` (0 = primary). */
  checkout(index: number, percent: number): void;
  /**
   * The single atomic claim of success: false when a cancel won first (the caller must roll back
   * and reject). After a true result a late cancel is a no-op. Always true without a progress id.
   */
  seal(): boolean;
  finish(phase: "failed"): void;
}

export function createCreationRun(
  progress: WorkspaceCreationProgressRegistry,
  progressId: string | undefined,
): CreationRun {
  const signal = progressId ? progress.create(progressId).signal : undefined;
  const update = (stages: WorkspaceCreationStage[], phase?: "done" | "failed") => {
    if (!progressId) return;
    try {
      progress.update(progressId, { stages, ...(phase ? { phase } : {}) });
    } catch {
      // The entry expired or was swept; creation itself must not fail because of reporting.
    }
  };
  const percents: number[] = [];
  let reported = -1;
  return {
    signal,
    total: 1,
    gitReached: false,
    check() {
      if (signal?.aborted) throw new WorkspaceCreationCancelled();
    },
    stage(id, status) {
      update([{ id, status }]);
    },
    checkout(index, percent) {
      const total = this.total;
      percents[index] = percent;
      let sum = 0;
      for (let i = 0; i < total; i++) sum += percents[i] ?? 0;
      const overall = Math.floor(sum / total);
      const finished = percents.filter((value) => value >= 100).length;
      const key = overall * 100 + finished;
      if (key === reported) return;
      reported = key;
      update([
        {
          id: "checkout",
          status: "running",
          percent: overall,
          repositoryIndex: Math.min(total, finished + 1),
          repositoryCount: total,
        },
      ]);
    },
    seal() {
      if (!progressId) return true;
      try {
        return progress.complete(progressId, [
          { id: "checkout", status: "done", percent: 100 },
          { id: "submodules", status: "skipped" },
          { id: "setup", status: "skipped" },
        ]);
      } catch {
        // The entry expired or was swept; nobody can cancel it any more.
        return true;
      }
    },
    finish() {
      update([], "failed");
    },
  };
}

export type ExtraRepository = { requested: string; directory: string };

/** Each extra repository gets a sibling worktree on the primary's branch; the journal records them first. */
export async function createExtraWorktrees(input: {
  repositories: ExtraRepository[];
  workspace: ManagedWorkspace;
  configuredRoot: string | null;
  fromRemote: boolean;
  run: CreationRun;
  journal: ExtraWorktreeRecord[];
  persist?: (record: ExtraWorktreeRecord) => Promise<void>;
}): Promise<Record<string, string>> {
  const { workspace, run, repositories } = input;
  const branch = workspace.branchRef.replace(/^refs\/heads\//, "");
  const baseBranch = /^[a-f0-9]{40,64}$/i.test(workspace.baseRef)
    ? null
    : workspace.baseRef.replace(/^refs\/heads\//, "");
  const inner = new AbortController();
  const signal = run.signal ? AbortSignal.any([run.signal, inner.signal]) : inner.signal;
  const created = new Map<string, string>();
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < repositories.length) {
      const index = next++;
      const repository = repositories[index];
      try {
        run.check();
        const root = await managedWorkspaceRoot(repository.directory, input.configuredRoot);
        const directory = basename(workspace.path);
        // A shared configured root holds every repository's sibling, so the name must differ.
        const name = input.configuredRoot
          ? `${directory}-${basename(repository.directory)}-${createHash("sha1").update(repository.directory).digest("hex").slice(0, 6)}`
          : directory;
        const base = await equivalentBase(repository.directory, baseBranch);
        let commit = base.commit;
        if (input.fromRemote && base.branch) {
          const fetchBranch = base.branch;
          // The fetch lane of this repository's own mutation gate, like the primary's fetch.
          commit =
            (await withHostGitMutation(
              repository.directory,
              () => fetchRemoteBase(repository.directory, fetchBranch, signal),
              undefined,
              "fetch",
            )) ?? commit;
        }
        const path = join(root, name);
        await createExtraWorktree({
          repository: repository.directory,
          path,
          branch,
          base: commit,
          journal: input.journal,
          persist: input.persist,
          observer: { signal },
        });
        await markManagedWorkspaceBranch(repository.directory, branch, workspace.id, "sibling");
        run.checkout(index + 1, 100);
        created.set(repository.requested, path);
      } catch (error) {
        failure ??= { error };
        inner.abort();
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(EXTRA_PARALLELISM, repositories.length) }, worker),
  );
  if (failure) throw run.signal?.aborted ? new WorkspaceCreationCancelled() : failure.error;
  // Request order, whichever sibling finished first.
  return Object.fromEntries(
    repositories.map((entry) => [entry.requested, created.get(entry.requested)!]),
  );
}
