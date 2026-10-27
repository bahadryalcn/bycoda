import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import type { ManagedWorkspace } from "./workspace-contracts";
import type { StewardWorkspaceServices } from "./stewards";
import { invalidateHostWorktrees } from "./git-worktrees";
import type { WorkspaceRpcRequest } from "./workspace-rpc-contracts";
import type { HostEngine } from "./engine";
import { writerWorkspaceMode } from "./task-workspace-runtime";
import { GitTurnHistory } from "./turn-git-history";

/** Test execution adapter: real Git worktrees; in-memory lifecycle records with
 * session ownership mirrored into the Host store for reviewer identity checks. */
export function writerWorkspaces(root: string, projectCwd: (id: string) => Promise<string>) {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  const rows = new Map<string, ManagedWorkspace>();
  const prepared = new Map<string, string>();
  const prepare = vi.fn(async (request: WorkspaceRpcRequest<"workspaces.prepare">) => {
    const existing = rows.get(prepared.get(request.idempotencyKey) ?? "");
    if (existing) return { workspace: existing, operationId: request.idempotencyKey };
    const cwd = await projectCwd(request.projectId);
    if (realpathSync.native(cwd) !== realpathSync.native(git(cwd, "rev-parse", "--show-toplevel")))
      throw new Error("Managed workspaces require the Git repository root.");
    const id = `workspace-${rows.size + 1}`;
    const branchRef = `refs/heads/bycoda/${request.owner.kind === "session" ? "s" : "t"}/${id}`;
    const path = join(root, id);
    const baseRef = request.baseRef ?? "HEAD";
    const head = git(cwd, "rev-parse", `${baseRef}^{commit}`);
    git(cwd, "worktree", "add", "-b", branchRef.slice(11), path, head);
    invalidateHostWorktrees(cwd);
    const workspace: ManagedWorkspace = {
      id,
      repositoryId: realpathSync.native(
        git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"),
      ),
      projectId: request.projectId,
      environmentId: request.environmentId,
      owner: request.owner,
      path,
      branchRef,
      baseRef,
      baseCommit: head,
      targetBranchRef: request.choice?.integrationBranchRef ?? "refs/heads/main",
      state: "active",
      directoryState: "present",
      revision: 1,
      lastActivityAt: 0,
      pinned: false,
    };
    rows.set(id, workspace);
    prepared.set(request.idempotencyKey, id);
    return { workspace, operationId: request.idempotencyKey };
  });
  const get = vi.fn(
    async ({ workspaceId }: { workspaceId: string }) => rows.get(workspaceId) ?? null,
  );
  const transition = (state: ManagedWorkspace["state"]) =>
    vi.fn(
      async ({
        workspaceId,
        expectedRevision,
      }: {
        workspaceId: string;
        expectedRevision: number;
      }) => {
        const row = rows.get(workspaceId)!;
        if (row.revision !== expectedRevision) throw new Error("Workspace changed");
        const updated = { ...row, state, revision: row.revision + 1 };
        rows.set(workspaceId, updated);
        return updated;
      },
    );
  const finish = transition("finished");
  const close = transition("abandoned");
  const resume = vi.fn(
    async ({
      workspaceId,
      expectedRevision,
    }: {
      workspaceId: string;
      expectedRevision: number;
    }) => {
      const row = rows.get(workspaceId)!;
      if (row.revision !== expectedRevision) throw new Error("Workspace changed");
      if (row.directoryState === "removed") {
        const cwd = await projectCwd(row.projectId);
        git(cwd, "worktree", "add", row.path, row.branchRef.slice(11));
        invalidateHostWorktrees(cwd);
      }
      const updated = {
        ...row,
        state: "active" as const,
        directoryState: "present" as const,
        revision: row.revision + 1,
      };
      rows.set(workspaceId, updated);
      return updated;
    },
  );
  const start = vi.fn(async (input: Record<string, unknown>) => ({
    ...input,
    id: `activity-${String(input.ownerId)}`,
    startedAt: 0,
  }));
  const stop = vi.fn(async (_id: string) => {});
  const plan = vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
    const row = rows.get(workspaceId)!;
    return {
      token: workspaceId,
      blockers: [],
      dirty: Boolean(git(row.path, "status", "--porcelain")),
    };
  });
  const apply = vi.fn(async ({ workspaceId }: { workspaceId: string }) => {
    const row = rows.get(workspaceId)!;
    git(await projectCwd(row.projectId), "worktree", "remove", row.path);
    invalidateHostWorktrees(await projectCwd(row.projectId));
    rows.set(workspaceId, { ...row, directoryState: "removed", revision: row.revision + 1 });
    return { workspaceId };
  });
  const services = {
    environmentId: "test-host",
    registry: { prepare, get, finish, close, resume },
    activity: { start, stop },
    removal: { plan, apply },
  } as unknown as StewardWorkspaceServices;
  const required = async (id: string) => {
    const row = rows.get(id);
    if (!row || row.directoryState !== "present")
      throw new Error("Fixture managed workspace is unavailable");
    if (
      realpathSync.native(
        git(row.path, "rev-parse", "--path-format=absolute", "--git-common-dir"),
      ) !== row.repositoryId ||
      git(row.path, "symbolic-ref", "HEAD") !== row.branchRef
    )
      throw new Error("Fixture managed workspace identity changed");
    return row;
  };
  // Real retained Git snapshots make the orchestration fixture honor the same
  // accepted-turn protocol as production. Lifecycle orchestration above remains
  // in memory; mirroring session ownership below is not recovery/delivery proof.
  const history = new GitTurnHistory({
    root: join(root, "fixture-turn-history"),
    workspace: required,
  });
  const attachEngine = async (engine: HostEngine, options: { exactGitRewind?: boolean } = {}) => {
    await engine.ready;
    services.environmentId = engine.store.environmentId;
    engine.setManagedTurnHistoryAdapter({
      exactGitRewindEnabled: () => options.exactGitRewind === true,
      history,
      assertWritable: async (id) => {
        await required(id);
      },
      prepareWorkspaceForCreate: async (request) => {
        const mode =
          request.workspaceMode ??
          (await writerWorkspaceMode(engine.store, services, request.projectId));
        if (mode === "current") return null;
        const prepared = await prepare({
          projectId: request.projectId,
          environmentId: services.environmentId,
          owner: { kind: "session", id: request.sessionId },
          idempotencyKey: request.idempotencyKey,
          slug: "fixture-session",
          choice: { defaultMode: "worktree" },
        });
        if (!(await engine.store.managedWorkspace(prepared.workspace.id)))
          await engine.store.insertManagedWorkspace(prepared.workspace);
        return { workspaceId: prepared.workspace.id };
      },
      workspaceForCreate: async (request) => {
        const row = await required(request.workspaceId);
        if (
          row.projectId !== request.projectId ||
          (request.worktreeCwd &&
            realpathSync.native(request.worktreeCwd) !== realpathSync.native(row.path))
        )
          throw new Error("Fixture managed workspace belongs to another project or path");
        return {
          workspaceId: row.id,
          path: row.path,
          branchRef: row.branchRef,
          revision: row.revision,
          sessionId: row.owner.kind === "session" ? row.owner.id : undefined,
        };
      },
      workspaceForSession: async (value) => {
        const id = value.session.workspaceId;
        if (!id) {
          const path = value.session.worktreeCwd ?? value.session.cwd;
          if ([...rows.values()].some((row) => row.path === path))
            throw new Error("Fixture managed session requires authoritative workspace identity");
          return null;
        }
        const row = await required(id);
        if (
          row.projectId !== value.projectId ||
          (row.owner.kind === "session" && row.owner.id !== value.session.id) ||
          realpathSync.native(value.session.worktreeCwd ?? value.session.cwd) !==
            realpathSync.native(row.path)
        )
          throw new Error("Fixture managed session ownership changed");
        return { workspaceId: row.id, path: row.path };
      },
      startActivity: async (value, kind) => {
        if (!value.session.workspaceId) return async () => {};
        await required(value.session.workspaceId);
        const activity = await start({
          workspaceId: value.session.workspaceId,
          ownerId: value.session.id,
          kind,
        });
        return async () => {
          await stop(activity.id);
        };
      },
    });
    await engine.recoverManagedStartup();
  };
  return {
    ...services,
    get environmentId() {
      return services.environmentId;
    },
    get policy() {
      return services.policy;
    },
    set policy(value) {
      services.policy = value;
    },
    prepare,
    get,
    finish,
    close,
    resume,
    start,
    stop,
    plan,
    apply,
    rows,
    history,
    attachEngine,
  };
}
