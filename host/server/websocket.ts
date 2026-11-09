import { createHash } from "node:crypto";
import { hostBulkDependencies } from "../transport/http/bulk";
import { attachHostWebSocketTransport } from "../transport/ws/server";
import type { ServerBindings } from "./bindings";
export function createWebsocketRuntime(
  dependencies: Pick<
    ServerBindings,
    | "server"
    | "engine"
    | "mobileIngressSecret"
    | "domainDispatcher"
    | "subscriptionHub"
    | "bulkTransfers"
    | "devServerAccess"
    | "nativeDevicesOwner"
    | "nativeDeliveryOwner"
    | "nativeServicesOwner"
    | "requestWorkspaceOwner"
    | "withWorkspaceOwner"
    | "tasks"
    | "attachmentOwnership"
  >,
) {
  const websocket = attachHostWebSocketTransport({
    server: dependencies.server,
    environmentId: dependencies.engine.store.environmentId,
    mobileIngressSecret: dependencies.mobileIngressSecret,
    methods: dependencies.domainDispatcher.methods,
    capabilities: [
      "browser.sessionScopes.v1",
      "browser.ownerPresentationScopes.v1",
      "native.buffers.recovery.v1",
      "transport.ws.models.v1",
      "transport.ws.devices.v1",
      "transport.ws.devices.preview.mobile.v1",
      "native.services.v1",
      "native.workspaces.v1",
      "native.buffers.upload.v1",
      "native.buffers.delivery.v1",
      "native.services.delivery.v1",
      "native.services.workspace.format.bounded.v1",
      "native.buffers.delivery.ack.v1",
      "native.services.delivery.ack.v1",
      "native.delivery.epochs.v2",
      "transport.ws.workspaces.cleanup.v1",
      "transport.ws.sessions.v2",
      "sessions.references.v1",
      "sessions.approvalOccurrence.v1",
      "sessions.desktopControlReceipts.v1",
      "transport.ws.queue.v2",
      "transport.ws.files.v2",
      "transport.ws.terminals.v2",
      "transport.ws.git.v2",
      "transport.ws.notes.v2",
      "transport.ws.tasks.v2",
      "transport.ws.goals.v2",
      "transport.ws.devServers.v2",
      "transport.ws.sprints.v2",
      "transport.ws.automations.v2",
      "transport.ws.health.v2",
      "transport.ws.bulk.v2",
    ],
    subscriptions: dependencies.subscriptionHub,
    bulk: dependencies.bulkTransfers,
    bulkDependencies: async (method, params) => {
      const cwd =
        method === "notes.list" &&
        params.sessionId === undefined &&
        typeof params.projectId === "string"
          ? (await dependencies.engine.store.project(params.projectId)).cwd
          : undefined;
      return hostBulkDependencies(method, params, cwd);
    },
    authenticate: async (token) =>
      await dependencies.engine.store.db.outsideScope(async () => {
        if (!(await dependencies.engine.store.authenticated(token))) return null;
        return {
          id: createHash("sha256").update(token).digest("hex"),
          devServerAccess: (method, params, authorize) =>
            dependencies.devServerAccess.handle(method, params, token, authorize),
          nativeDevices: dependencies.nativeDevicesOwner(token),
          nativeDelivery: dependencies.nativeDeliveryOwner(token),
          nativeServices: dependencies.nativeServicesOwner(token),
          workspaceOwner: dependencies.requestWorkspaceOwner(token),
          retargetTask: (id, target, autoMerge) =>
            dependencies.withWorkspaceOwner(token, (owner) =>
              dependencies.tasks.retarget(id, target, autoMerge, owner),
            ),
          // Domain transactions already own the serialized database scope. Re-entering
          // outsideScope here would queue authorization behind the transaction itself.
          authorized: async () => await dependencies.engine.store.authenticated(token),
          exposeQueueAttachments: (ids, params) =>
            dependencies.engine.store.db.withAuthorization(
              () => dependencies.engine.store.authenticated(token),
              () => dependencies.attachmentOwnership.expose(token, ids, params),
            ),
        };
      }),
    dispatch: async (method, params, context) =>
      await dependencies.engine.store.db.outsideScope(
        async () => await dependencies.domainDispatcher.dispatch(method, params, context),
      ),
  });
  return { websocket };
}
