import { createHash } from "node:crypto";
import type { WorkspaceRpcRequest } from "../workspaces/workspace-rpc-contracts";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleWorkspacesRpc(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "managedWorkspaces"
    | "workspaceForOwnerRpc"
    | "withWorkspaceOwner"
    | "managed"
    | "tasks"
    | "workspaceOwnerDeviceId"
    | "featureClaims"
  >,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    // These routes are owner transport only. Scoped agent credentials are
    // rejected above, so they cannot manufacture project-policy exceptions.
    case "workspaces.prepare": {
      await dependencies.engine.store.project(String(request.params.projectId ?? ""));
      if (request.params.environmentId !== dependencies.engine.store.environmentId)
        throw new Error("Workspace belongs to another execution host");
      request.result = await dependencies.managedWorkspaces.prepare(
        request.params as unknown as WorkspaceRpcRequest<"workspaces.prepare">,
      );
      break;
    }

    case "workspaces.list": {
      await dependencies.engine.store.project(String(request.params.projectId ?? ""));
      if (
        request.params.environmentId !== undefined &&
        request.params.environmentId !== dependencies.engine.store.environmentId
      )
        throw new Error("Workspace belongs to another execution host");
      request.result = await dependencies.managedWorkspaces.list({
        ...(request.params as unknown as WorkspaceRpcRequest<"workspaces.list">),
        environmentId: dependencies.engine.store.environmentId,
      });
      break;
    }

    case "workspaces.get":
      request.result = await dependencies.workspaceForOwnerRpc(request.params.workspaceId);
      break;

    case "workspaces.exactGitRewind.get":

    case "workspaces.exactGitRewind.set": {
      request.result = await dependencies.withWorkspaceOwner(request.token, async () => {
        if (request.input.method === "workspaces.exactGitRewind.set") {
          if (typeof request.params.enabled !== "boolean")
            throw new Error("Exact Git rewind must be a boolean");
          if (
            request.params.enabled &&
            (await dependencies.engine.store.startupStates()).some(
              (state) => state.workspaceId && (state.running || state.shellRunning),
            )
          )
            throw new Error("Wait for running worktree turns before enabling exact Git rewind");
          await dependencies.managed.exactGitRewind.save(request.params.enabled);
        }
        return { enabled: await dependencies.managed.exactGitRewind.read() };
      });
      break;
    }

    case "workspaces.pin": {
      if (!(await dependencies.workspaceForOwnerRpc(request.params.workspaceId)))
        throw new Error("Managed workspace not found");
      request.result = await dependencies.withWorkspaceOwner(request.token, (owner) =>
        dependencies.managedWorkspaces.pin(
          request.params as unknown as Parameters<typeof dependencies.managedWorkspaces.pin>[0],
          owner,
        ),
      );
      break;
    }

    case "workspaces.delivery.review":

    case "workspaces.delivery.merge":

    case "workspaces.delivery.publish": {
      const value = await dependencies.workspaceForOwnerRpc(request.params.workspaceId);
      if (!value) throw new Error("Managed workspace not found");
      const existing =
        request.input.method !== "workspaces.delivery.review" &&
        typeof request.params.idempotencyKey === "string"
          ? await dependencies.managedWorkspaces.findOperation({
              workspaceId: value.id,
              kind: "delivery",
              idempotencyKey: request.params.idempotencyKey,
            })
          : null;
      if (
        existing &&
        (existing.kind !== "delivery" ||
          existing.plan.token !== request.params.planToken ||
          existing.expectedRevision !== request.params.expectedRevision ||
          existing.plan.action !==
            (request.input.method === "workspaces.delivery.merge" ? "merge" : "publish"))
      )
        throw new Error("Idempotency key was used for a different delivery");
      await dependencies.managed.assertWritable(value.id, existing?.id);
      if (request.input.method === "workspaces.delivery.review")
        request.result =
          value.owner.kind === "task" && request.params.action === "merge"
            ? await dependencies.tasks.reviewDelivery(value.owner.id)
            : await dependencies.managed.delivery.review(
                request.params as unknown as WorkspaceRpcRequest<"workspaces.delivery.review">,
              );
      else
        request.result = await dependencies.withWorkspaceOwner(request.token, async (owner) => {
          if (
            existing?.kind === "delivery" &&
            existing.plan.action === "merge" &&
            existing.phase !== "complete"
          ) {
            const recovered = await dependencies.managed.delivery.recover(existing.id);
            if (recovered.phase !== "complete")
              throw new Error(
                "Delivery still requires reconciliation; inspect its recorded operation before retrying",
              );
          }
          if (request.input.method === "workspaces.delivery.publish") {
            const receipt = await dependencies.managed.delivery.publish(
              request.params as unknown as WorkspaceRpcRequest<"workspaces.delivery.publish">,
              owner,
            );
            await dependencies.tasks.reconcileDelivery(value.id);
            return receipt;
          }
          if (value.owner.kind === "task") {
            await dependencies.tasks.mergeDelivery(
              value.owner.id,
              request.params as unknown as WorkspaceRpcRequest<"workspaces.delivery.merge">,
              owner,
            );
            const operation = await dependencies.managedWorkspaces.findOperation({
              workspaceId: value.id,
              kind: "delivery",
              idempotencyKey: String(request.params.idempotencyKey),
            });
            if (operation?.kind !== "delivery" || !operation.merge)
              throw new Error("Task delivery receipt is unavailable");
            await dependencies.managed.retention.onLifecycle(value.id);
            return operation.merge;
          }
          const receipt = await dependencies.managed.delivery.merge(
            request.params as unknown as WorkspaceRpcRequest<"workspaces.delivery.merge">,
            owner,
          );
          await dependencies.tasks.reconcileDelivery(value.id);
          await dependencies.managed.retention.onLifecycle(value.id);
          return receipt;
        });
      break;
    }

    case "workspaces.storage.status":
      await dependencies.engine.store.project(String(request.params.projectId ?? ""));
      request.result = await dependencies.managed.storageStatus(
        request.params as unknown as WorkspaceRpcRequest<"workspaces.storage.status">,
      );
      break;

    case "workspaces.bootstrap.prepare":
      if (!(await dependencies.workspaceForOwnerRpc(request.params.workspaceId)))
        throw new Error("Managed workspace not found");
      request.result = await dependencies.managed.prepareBootstrap(
        request.params as unknown as Parameters<typeof dependencies.managed.prepareBootstrap>[0],
      );
      break;

    case "workspaces.bootstrap.status":

    case "workspaces.bootstrap.cancel": {
      const id = String(request.params.bootstrapId ?? "");
      const status = await dependencies.managed.bootstrap.status(id);
      if (!(await dependencies.workspaceForOwnerRpc(status.workspaceId)))
        throw new Error("Managed workspace not found");
      request.result =
        request.input.method === "workspaces.bootstrap.cancel"
          ? await dependencies.managed.bootstrap.cancel(id)
          : status;
      break;
    }

    case "workspaces.activities.start": {
      const value = await dependencies.workspaceForOwnerRpc(request.params.workspaceId);
      if (!value || request.params.kind !== "editor")
        throw new Error("Only owner editor activities may be registered");
      await dependencies.managed.assertWritable(value.id);
      const ownerId = createHash("sha256")
        .update(await dependencies.workspaceOwnerDeviceId(request.token))
        .digest("hex");
      request.result = await dependencies.managed.activity.start({
        workspaceId: value.id,
        kind: "editor",
        ownerId,
        dirtyBuffer: request.params.dirtyBuffer === true,
      });
      break;
    }

    case "workspaces.activities.stop": {
      const id = String(request.params.activityId ?? "");
      const value = await dependencies.workspaceForOwnerRpc(request.params.workspaceId);
      if (!value) throw new Error("Managed workspace not found");
      // Resolve exact current durable owner, not an unbounded duplicate
      // receipt cache. Disconnect never proves a dirty/native editor idle.
      const entry = (await dependencies.managed.activity.list(value.id)).find(
        (activity) => activity.id === id && activity.kind === "editor",
      );
      if (
        !entry ||
        entry.ownerId !==
          createHash("sha256")
            .update(await dependencies.workspaceOwnerDeviceId(request.token))
            .digest("hex")
      )
        throw new Error("Editor activity is not owned by this device");
      await dependencies.workspaceForOwnerRpc(entry.workspaceId);
      await dependencies.managed.activity.stop(id);
      request.result = { stopped: true };
      break;
    }

    case "workspaces.activities.list": {
      const value = await dependencies.workspaceForOwnerRpc(request.params.workspaceId);
      if (!value) throw new Error("Managed workspace not found");
      request.result = await dependencies.managed.activity.list(value.id);
      break;
    }

    case "workspaces.resume":

    case "workspaces.finish":

    case "workspaces.close": {
      if (!(await dependencies.workspaceForOwnerRpc(request.params.workspaceId)))
        throw new Error("Managed workspace not found");
      const action =
        request.input.method === "workspaces.resume"
          ? "resume"
          : request.input.method === "workspaces.finish"
            ? "finish"
            : "close";
      request.result = await dependencies.managedWorkspaces[action](
        request.params as unknown as WorkspaceRpcRequest<"workspaces.resume">,
      );
      await dependencies.managed.retention.onLifecycle(String(request.params.workspaceId));
      break;
    }

    case "workspaces.featureClaims.list":
      await dependencies.engine.store.project(String(request.params.projectId ?? ""));
      request.result = await dependencies.featureClaims.list(
        request.params as unknown as WorkspaceRpcRequest<"workspaces.featureClaims.list">,
      );
      break;

    case "workspaces.featureClaims.acquire":

    case "workspaces.featureClaims.release": {
      if (!(await dependencies.workspaceForOwnerRpc(request.params.workspaceId)))
        throw new Error("Managed workspace not found");
      await dependencies.managed.assertWritable(String(request.params.workspaceId));
      request.result =
        request.input.method === "workspaces.featureClaims.acquire"
          ? await dependencies.featureClaims.acquire(
              request.params as unknown as WorkspaceRpcRequest<"workspaces.featureClaims.acquire">,
            )
          : await dependencies.featureClaims.release(
              request.params as unknown as WorkspaceRpcRequest<"workspaces.featureClaims.release">,
            );
      break;
    }
  }
}
