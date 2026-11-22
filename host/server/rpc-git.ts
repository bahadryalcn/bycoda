import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { randomUUID } from "node:crypto";
import { assertDomainAuthority } from "../domains/context";
import { withHostGitMutation } from "../git/git-mutations";
import {
  inspectHostWorktreeRemoval,
  invalidateHostWorktrees,
  removeHostWorktreeDirectory,
} from "../git/git-worktrees";
import { inManagedWorkspace } from "../managed/managed-workspace-runtime";
import { fingerprintSource } from "../workspace-cleanup";
import { canonicalWorkspaceEntry, workspacePathKey } from "../workspaces/workspace-paths";
import { handleSessionsRpc } from "./rpc-sessions";

type GitRemovalBindings = Pick<
  ServerBindings,
  "engine" | "terminals" | "managed" | "withWorkspaceOwner" | "desktop" | "runLeases" | "providers"
> &
  Parameters<typeof handleSessionsRpc>[0];
const hiddenChangesBlocker = "Managed cleanup cannot preserve changes hidden from Git status.";
const reviews = new Map<
  string,
  {
    owner: string;
    projectId: string;
    requested: string;
    commonDir: string;
    state: string;
    expiresAt: number;
    managedStatusHidden: boolean;
    managedPreservationRequired: boolean;
    managed?: { workspaceId: string; expectedRevision: number; planToken: string };
  }
>();

async function worktreeRemoval(deps: GitRemovalBindings, request: OwnerRpcRequest) {
  const { projectId, path, token, force, keepSessions } = request.params;
  if (
    typeof projectId !== "string" ||
    typeof path !== "string" ||
    (force !== undefined && typeof force !== "boolean") ||
    (keepSessions !== undefined && typeof keepSessions !== "boolean")
  )
    throw new Error("Invalid worktree removal request.");
  const { cwd } = await deps.engine.store.project(projectId);
  const owner = request.tokenHash;
  const authorize = () => assertDomainAuthority(request.domainContext);
  const inspect = (allowMissing: boolean) =>
    inspectHostWorktreeRemoval(
      cwd,
      path,
      async (target) => {
        const [states, desktop] = await Promise.all([
          deps.engine.store.startupStates(),
          deps.desktop.listSnapshotAsync(cwd, projectId, deps.providers),
        ]);
        const native = desktop.sessions.filter((session) =>
          inManagedWorkspace(session.worktreeCwd || session.cwd || "", target),
        );
        const linked = states.filter((s) =>
          inManagedWorkspace(s.worktreeCwd || s.cwd || "", target),
        );
        const sessionIds = [
          ...new Set([...linked.map((s) => s.id), ...native.map((s) => s.id)]),
        ].sort();
        return {
          sessionIds,
          hasTerminals:
            linked.some((s) => s.shellRunning) ||
            deps.terminals.runningInWorkspace(target).length > 0,
          hasAgents:
            native.some((s) => s.status === "running") ||
            linked.some((s) => s.running || deps.engine.hasActiveRun(s.id)) ||
            sessionIds.some((id) => deps.desktop.live.busyClient(id) || deps.runLeases.holder(id)),
        };
      },
      fingerprintSource,
      allowMissing,
    );
  const managedAt = async (target: string) =>
    (await deps.managed.list()).find(
      (item) =>
        workspacePathKey(item.path) === workspacePathKey(target) &&
        item.directoryState !== "removed",
    );
  if (request.input.method === "git.worktreeRemovalReview") {
    return withHostGitMutation(cwd, async () => {
      await authorize();
      const current = await inspect(false);
      if (current.gone) throw new Error("The worktree directory is missing.");
      const { state, gone: _gone, hasReparsePoints, ...review } = current;
      const workspace = await managedAt(review.path);
      const managed = workspace
        ? await deps.managed.removal.plan({
            workspaceId: workspace.id,
            expectedRevision: workspace.revision,
          })
        : undefined;
      const id = randomUUID();
      const managedStatusHidden = !!(managed && review.status && !managed.preservationRequired);
      const expiresAt = Date.now() + 120_000;
      for (const [key, value] of reviews) if (value.expiresAt <= Date.now()) reviews.delete(key);
      if (reviews.size >= 256) throw new Error("Too many pending worktree reviews.");
      reviews.set(id, {
        owner,
        projectId,
        requested: path,
        commonDir: review.commonDir,
        state,
        expiresAt,
        managedStatusHidden,
        managedPreservationRequired: managed?.preservationRequired ?? false,
        managed:
          workspace && managed
            ? {
                workspaceId: workspace.id,
                expectedRevision: workspace.revision,
                planToken: managed.token,
              }
            : undefined,
      });
      return {
        ...review,
        status: review.status || (managed?.preservationRequired ? "ignored-private-inputs" : ""),
        blockers: [
          ...review.blockers,
          ...(managed?.blockers ?? []),
          ...(managedStatusHidden ? [hiddenChangesBlocker] : []),
          ...(!workspace && hasReparsePoints
            ? ["Reparse points require junction-safe managed cleanup."]
            : []),
        ],
        token: id,
        expiresAt,
      };
    });
  }
  return deps.engine.withIdleProject(projectId, () =>
    withHostGitMutation(cwd, async () => {
      await authorize();
      const expected = typeof token === "string" ? reviews.get(token) : undefined;
      if (
        !expected ||
        expected.owner !== owner ||
        expected.projectId !== projectId ||
        expected.requested !== path ||
        expected.expiresAt <= Date.now()
      )
        throw new Error("Worktree review expired or does not match. Review it again.");
      const target = await canonicalWorkspaceEntry(path);
      return deps.terminals.withWorktreeRemoval(target, async () => {
        const current = await inspect(true);
        if (
          current.commonDir !== expected.commonDir ||
          (!current.gone && current.state !== expected.state)
        )
          throw new Error("Worktree changed. Review it again before removing it.");
        const workspace = await managedAt(current.path);
        if (
          workspace?.id !== expected.managed?.workspaceId &&
          !(current.gone && !workspace && expected.managed)
        )
          throw new Error("Worktree ownership changed. Review it again.");
        if (current.gone) {
          // An absent directory needs no removal. Leave Git and managed registrations intact.
          invalidateHostWorktrees();
          reviews.delete(String(token));
          return { sessionIds: [], projectCwd: current.projectCwd };
        }
        if (expected.managedStatusHidden) throw new Error(hiddenChangesBlocker);
        if (current.blockers.length) throw new Error(current.blockers.join(" "));
        if (!workspace && current.hasReparsePoints)
          throw new Error("Reparse points require junction-safe managed cleanup.");
        if (current.hasTerminals || current.hasAgents)
          throw new Error("Stop active terminals and agents before removing the worktree.");
        if (current.unpushed) throw new Error("Worktree has unpublished commits.");
        if (current.ignoredEntryCount > 0 && force !== true)
          throw new Error("Confirm removal of ignored local files.");
        if ((current.status || expected.managedPreservationRequired) && !force)
          throw new Error("Worktree has uncommitted changes.");
        const mutate = async (assertLease: () => void) => {
          await authorize();
          assertLease();
          if (expected.managed) {
            const input = { ...expected.managed, idempotencyKey: String(token) };
            const receipt = await deps.withWorkspaceOwner(request.token, (authority) =>
              deps.managed.removal.apply(input, authority, assertLease),
            );
            if (receipt.directoryState !== "removed")
              throw new Error("Managed cleanup did not remove the worktree.");
            invalidateHostWorktrees();
          } else {
            await removeHostWorktreeDirectory(
              current.projectCwd,
              current.path,
              force === true && (!!current.status || current.ignoredEntryCount > 0),
            );
          }
        };
        await deps.desktop.live.withRemovalLease(
          randomUUID(),
          current.path,
          async (assertLease) => {
            const leased = await inspect(true);
            if (
              leased.gone ||
              leased.commonDir !== current.commonDir ||
              workspacePathKey(leased.path) !== workspacePathKey(current.path) ||
              leased.state !== current.state
            )
              throw new Error("Worktree changed. Review it again before removing it.");
            if (leased.hasTerminals || leased.hasAgents)
              throw new Error("Stop active terminals and agents before removing the worktree.");
            await mutate(assertLease);
          },
          async () => current.projectCwd,
        );
        if (keepSessions === false) {
          try {
            for (const sessionId of current.sessionIds) {
              await authorize();
              await handleSessionsRpc(deps, {
                ...request,
                input: { ...request.input, method: "sessions.delete" },
                params: { projectId, sessionId },
              });
            }
          } catch (cause) {
            throw new Error(
              "The worktree was removed, but some linked sessions could not be deleted.",
              { cause },
            );
          }
        }
        return {
          sessionIds: current.sessionIds,
          projectCwd: current.projectCwd,
        };
      });
    }),
  );
}
export async function handleGitRpc(
  dependencies: Pick<ServerBindings, "gitService"> & GitRemovalBindings,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "git.worktreeRemovalReview":
    case "git.worktreeRemove":
      request.result = await worktreeRemoval(dependencies, request);
      break;
    case "git.generateText":
      request.result = await dependencies.gitService.generateText(
        request.params,
        request.domainContext,
      );
      break;
    case "git.diff":
      request.result = await dependencies.gitService.diff(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "git.branches":
      request.result = await dependencies.gitService.branches(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.switch":
      request.result = await dependencies.gitService.switch(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "git.createBranch":
      request.result = await dependencies.gitService.createBranch(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.worktrees":
      request.result = await dependencies.gitService.worktrees(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.worktreeCreate":
      request.result = await dependencies.gitService.worktreeCreate(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.index":
      request.result = await dependencies.gitService.index(request.params, request.domainContext, {
        legacy: true,
      });
      break;

    case "git.fileDiff":
      request.result = await dependencies.gitService.fileDiff(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "git.action":
      request.result = await dependencies.gitService.action(request.params, request.domainContext, {
        legacy: true,
      });
      break;
  }
}
