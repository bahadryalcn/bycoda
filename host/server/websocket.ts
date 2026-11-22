import { createHash } from "node:crypto";
import { attachDevServerTunnel, TUNNEL_CAPABILITY } from "../dev-servers/dev-server-tunnel";
import { hostBulkDependencies } from "../transport/http/bulk";
import { attachHostWebSocketTransport } from "../transport/ws/server";
import { requestingDeviceName } from "../desktop/remoteActivity";
import { memoized } from "../desktop/requester-name";
import type { ServerBindings } from "./bindings";
import { createTailnetServeHosts } from "../mobile/tailnet-serve-hosts";
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
    | "mobileAccess"
  >,
) {
  const tailnetHosts = createTailnetServeHosts(() => dependencies.mobileAccess.status());
  // Any status or enable the owner flow already read (Settings enabling Serve) is
  // visible to the Host check at once instead of after the next 60 s probe.
  dependencies.mobileAccess.observe(tailnetHosts.observe);
  // The first probe at creation runs before the Host listens and cannot know its port;
  // probe again as soon as the Host listens so the name is known right after boot.
  if (dependencies.server.listening) tailnetHosts.refresh();
  else dependencies.server.once("listening", tailnetHosts.refresh);
  const websocket = attachHostWebSocketTransport({
    // Phones away from home reach /ws through this Host's own Tailscale Serve name;
    // the proxy connects from loopback and the bearer credential still authenticates.
    allowedHosts: tailnetHosts.current,
    retryUnknownHost: tailnetHosts.retryUnknownHost,
    server: dependencies.server,
    environmentId: dependencies.engine.store.environmentId,
    mobileIngressSecret: dependencies.mobileIngressSecret,
    methods: dependencies.domainDispatcher.methods,
    capabilities: [
      TUNNEL_CAPABILITY,
      "browser.sessionScopes.v1",
      "browser.ownerPresentationScopes.v1",
      "transport.ws.models.v1",
      "transport.ws.devices.v1",
      "transport.ws.devices.preview.mobile.v1",
      "transport.ws.voice.v1",
      // The phone's background voice socket has no HTTP fallback: without this its spoken
      // message ("assistant.request") is refused as incompatible before it is ever sent.
      "assistant.v1",
      "native.services.v1",
      "native.workspaces.v1",
      "native.services.delivery.v1",
      "native.services.workspace.format.bounded.v1",
      "native.services.delivery.ack.v1",
      "native.services.delivery.admission.v1",
      "native.delivery.epochs.v2",
      "native.delivery.epochs.gaps.v1",
      "transport.ws.workspaces.cleanup.v1",
      "transport.ws.sessions.v2",
      "sessions.references.v1",
      "sessions.approvalOccurrence.v1",
      "sessions.desktopControlReceipts.v1",
      "transport.ws.queue.v2",
      "transport.ws.files.v2",
      "transport.ws.terminals.v2",
      "transport.ws.terminals.command.v1",
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
          requesterName: memoized(() => requestingDeviceName(dependencies.engine.store, token)),
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
  // The tunnel shares the Host listener and its lifecycle: closing the websocket runtime
  // also closes every open dev-server tunnel.
  const tunnel = attachDevServerTunnel({
    server: dependencies.server,
    allowedHosts: tailnetHosts.current,
    mobileIngressSecret: dependencies.mobileIngressSecret,
    authenticate: async (token) =>
      await dependencies.engine.store.db.outsideScope(async () =>
        (await dependencies.engine.store.authenticated(token))
          ? {
              id: createHash("sha256").update(token).digest("hex"),
              authorized: async () => await dependencies.engine.store.authenticated(token),
            }
          : null,
      ),
    endpoint: async (params) => await dependencies.devServerAccess.endpoint(params),
  });
  return {
    websocket: {
      ...websocket,
      close: async () => {
        await tunnel.close();
        await websocket.close();
      },
    },
  };
}
