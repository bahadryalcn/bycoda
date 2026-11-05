import { createHash } from "node:crypto";
import { readHostBuildIdentity } from "../build-identity";
import { HostDomainAuthorizationError, type HostDomainContext } from "../domains/context";
import { hasShellPhysicalOwner } from "../execution/shell-ownership";
import {
  createManagedWorkspaceRuntime,
  inManagedWorkspace,
} from "../managed/managed-workspace-runtime";
import { assertNativeDeliveryEffect } from "../native-delivery/native-delivery-epochs";
import { bindNativeWorkspaceOwner } from "../ports/native-workspaces";
import type { ServerBindings } from "./bindings";
export function createWorkspacesRuntime(
  dependencies: Pick<ServerBindings, "engine" | "desktop" | "runLeases" | "terminals" | "tasks">,
) {
  const inWorkspace = inManagedWorkspace;
  const managed = createManagedWorkspaceRuntime(dependencies.engine.store, dependencies.engine, {
    probe: async (workspace) => {
      const activities: import("../workspaces/workspace-contracts").WorkspaceActivity[] = [];
      const add = (
        kind: import("../workspaces/workspace-contracts").WorkspaceActivity["kind"],
        ownerId: string,
      ) =>
        activities.push({
          id: `probe:${kind}:${ownerId}`,
          workspaceId: workspace.id,
          kind,
          ownerId,
          startedAt: Date.now(),
        });
      if (
        workspace.owner.kind === "session" &&
        (dependencies.desktop.live.busyClient(workspace.owner.id) ||
          dependencies.runLeases.holder(workspace.owner.id))
      )
        add("provider", workspace.owner.id);
      for (const terminal of dependencies.terminals.runningInWorkspace(workspace.path))
        add("shell", terminal.id);
      for (const summary of await dependencies.engine.store.startupStates(workspace.id)) {
        if (
          summary.workspaceId !== workspace.id &&
          !(summary.worktreeCwd && inWorkspace(summary.worktreeCwd, workspace.path))
        )
          continue;
        if (
          summary.running ||
          dependencies.desktop.live.busyClient(summary.id) ||
          dependencies.runLeases.holder(summary.id)
        )
          add("provider", summary.id);
        if (summary.shellRunning) add("shell", summary.id);
      }
      return activities;
    },
    artifactPending: async (workspaceId, completedDeliveryOperationId) =>
      !completedDeliveryOperationId &&
      (await dependencies.tasks.list()).some(
        (task) =>
          task.workspaceId === workspaceId &&
          (task.artifactDeliveryPending === true || !!task.artifactDeliveryActivityId),
      ),
    canReconcileActivity: async (entry) => {
      if (await hasShellPhysicalOwner(dependencies.engine.store, "session", entry.ownerId))
        return false;
      // Only rows from a previous Host process reach here; the workspace probe
      // still refuses while a real process uses the directory.
      if (
        !["provider", "shell", "devServer"].includes(entry.kind) ||
        dependencies.engine.desktopRefreshBlocked(entry.ownerId) ||
        dependencies.desktop.live.busyClient(entry.ownerId) ||
        dependencies.runLeases.holder(entry.ownerId)
      )
        return false;
      const summary = (await dependencies.engine.store.startupStates()).find(
        (value) => value.id === entry.ownerId,
      );
      if (summary?.running || summary?.shellRunning) return false;
      if (!summary || !(await dependencies.engine.store.sessionAuthority(entry.ownerId)))
        console.warn(
          `Retiring stale workspace activity ${entry.id} (${entry.kind}): its previous owner ${entry.ownerId} has no live session record.`,
        );
      return true;
    },
  });
  const managedWorkspaces = managed.registry;
  const workspacePolicy = managed.policy;
  const featureClaims = managed.claims;
  const buildIdentity = readHostBuildIdentity();
  const startWorkspaceActivity = async (
    cwd: string,
    kind: import("../workspaces/workspace-contracts").WorkspaceActivity["kind"],
    ownerId: string,
  ) => {
    const entries: { id: string; workspaceId: string }[] = [];
    // The runtime relaxes only stale rewind journals when exact rewind is off.
    const gated =
      kind === "mutation" ||
      kind === "operation" ||
      kind === "provider" ||
      kind === "shell" ||
      kind === "devServer" ||
      kind === "editor";
    try {
      for (const workspace of await managed.list()) {
        if (!inWorkspace(cwd, workspace.path)) continue;
        if (gated) await managed.assertWritable(workspace.id);
        const entry = await managed.activity.start({ workspaceId: workspace.id, kind, ownerId });
        entries.push({ id: entry.id, workspaceId: workspace.id });
        await recordWorkspaceActivity(() => managedWorkspaces.touchActivity(workspace.id));
      }
      return async () => {
        for (const entry of entries) {
          await managed.activity.stop(entry.id);
          await recordWorkspaceActivity(() => managedWorkspaces.touchActivity(entry.workspaceId));
        }
      };
    } catch (error) {
      for (const entry of entries) await managed.activity.stop(entry.id);
      throw error;
    }
  };
  dependencies.terminals.setActivityGate((cwd, terminalId) =>
    startWorkspaceActivity(cwd, "shell", terminalId),
  );
  const workspaceOwnerDeviceId = async (token: string) => {
    const current = (await dependencies.engine.store.pairedDevices(token)).devices.find(
      (device) => device.isCurrent,
    );
    if (!current) throw new Error("Owner device authorization was revoked");
    return current.id;
  };
  const withWorkspaceOwner = async <T>(
    token: string,
    action: (
      owner: import("../workspaces/workspace-service-contracts").WorkspaceOwnerAuthorization,
    ) => Promise<T>,
  ) => managed.withOwner(await workspaceOwnerDeviceId(token), action);
  const requestWorkspaceOwner =
    (token: string): NonNullable<HostDomainContext["workspaceOwner"]> =>
    (action) =>
      withWorkspaceOwner(token, async (owner) => {
        const result = await action(
          bindNativeWorkspaceOwner(managed, owner, () =>
            assertNativeDeliveryEffect(
              dependencies.engine.store,
              createHash("sha256").update(token).digest("hex"),
              "buffer",
            ),
          ),
        );
        if (
          createHash("sha256")
            .update(await workspaceOwnerDeviceId(token))
            .digest("hex") !== owner.ownerId
        )
          throw new HostDomainAuthorizationError();
        return result;
      });
  const recordWorkspaceActivity = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch {
      console.warn("Managed workspace activity metadata could not be recorded");
    }
  };
  const touchSessionWorkspace = (id: string) =>
    recordWorkspaceActivity(() => managedWorkspaces.touchOwnerActivity({ kind: "session", id }));
  const workspaceForOwnerRpc = async (workspaceId: unknown) => {
    if (typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 200)
      throw new Error("Invalid workspace identity");
    const value = await managedWorkspaces.get({ workspaceId });
    if (value) {
      await dependencies.engine.store.project(value.projectId);
      if (value.environmentId !== dependencies.engine.store.environmentId)
        throw new Error("Workspace belongs to another execution host");
    }
    return value;
  };
  return {
    inWorkspace,
    managed,
    managedWorkspaces,
    workspacePolicy,
    featureClaims,
    buildIdentity,
    startWorkspaceActivity,
    workspaceOwnerDeviceId,
    withWorkspaceOwner,
    requestWorkspaceOwner,
    recordWorkspaceActivity,
    touchSessionWorkspace,
    workspaceForOwnerRpc,
  };
}
