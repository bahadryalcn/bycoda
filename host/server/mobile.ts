import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { McpHttp } from "../mcp/mcp-http";
import { createMobileAccessService } from "../mobile/mobile-access";
import { MobileLanAccess } from "../mobile/mobile-lan";
import { MobilePairing } from "../mobile/mobile-pairing";
import { createMobileRoutes } from "../mobile/mobile-routes";
import { MobileTlsAuthority } from "../security/mobile-tls";
import { ExternalTunnels } from "../tunnels/tunnels";
import type { ServerBindings } from "./bindings";
export function createMobileRuntime(
  dependencies: Pick<
    ServerBindings,
    | "engine"
    | "server"
    | "featureDirectory"
    | "tunnelsOverride"
    | "mcpHub"
    | "social"
    | "conversationAccess"
    | "conversationDelegation"
    | "runtimeLogAccess"
    | "runtimeLogs"
    | "refreshLogSources"
    | "conversationWorkspace"
    | "projectSessionList"
    | "localSessionReference"
  >,
) {
  const mobilePairing = new MobilePairing({
    environmentId: dependencies.engine.store.environmentId,
    hasDeviceHash: async (hash) =>
      !!(await dependencies.engine.store.db
        .prepare("SELECT id FROM devices WHERE hash=?")
        .get(hash)),
    deviceProofKeys: async () =>
      (await dependencies.engine.store.db.prepare("SELECT hash FROM devices").all()).map((device) =>
        String(device.hash),
      ),
    proofOrigins: async () => {
      const address = dependencies.server.address();
      const local =
        address && typeof address !== "string"
          ? [
              `http://127.0.0.1:${address.port}`,
              `http://localhost:${address.port}`,
              `http://[::1]:${address.port}`,
            ]
          : [];
      return [...local, ...(await proofRoutes()).map((route) => route.endpoint)];
    },
    issueDevice: async (name) => await dependencies.engine.store.issueDevice(name),
    transaction: async (action) => await dependencies.engine.store.transaction(action),
  });
  const mobileAccess = createMobileAccessService((): number => {
    const address = dependencies.server.address();
    if (!address || typeof address === "string" || address.port <= 0)
      throw new Error("Host is not listening.");
    return address.port;
  });
  const mobileIngressSecret = `${randomUUID()}${randomUUID()}`;
  const mobileLan = new MobileLanAccess(
    join(dependencies.featureDirectory, "mobile-lan.json"),
    dependencies.engine.store.environmentId,
    () => {
      const address = dependencies.server.address();
      if (!address || typeof address === "string") throw new Error("Host is not listening.");
      return address.port;
    },
    undefined,
    undefined,
    {
      ingressSecret: mobileIngressSecret,
      tlsAuthority: new MobileTlsAuthority(
        join(dependencies.featureDirectory, "mobile-tls.json"),
        dependencies.engine.store.environmentId,
      ),
    },
  );
  const tunnels =
    dependencies.tunnelsOverride ??
    new ExternalTunnels(
      join(dependencies.featureDirectory, "tunnels"),
      dependencies.engine.store.environmentId,
      () => {
        const address = dependencies.server.address();
        if (!address || typeof address === "string") throw new Error("Host is not listening.");
        return `http://127.0.0.1:${address.port}`;
      },
    );
  const proofRoutes = createMobileRoutes({
    lan: () => mobileLan.status(),
    tailscale: () => mobileAccess.status(),
    tunnel: () => tunnels.publicHostUrl(),
  });
  async function mcpBridgeMetadata(scope: "conversation" | "runtime-logs" | "social") {
    const address = dependencies.server.address();
    const local = address && typeof address !== "string" && address.address === "127.0.0.1";
    const mcpUrl =
      local && !(scope === "social" && (await dependencies.social.isDelegated?.()))
        ? `http://127.0.0.1:${address.port}/mcp/${scope}`
        : undefined;
    return {
      command: process.execPath,
      args: [process.argv[1]],
      ...(mcpUrl ? { mcpUrl } : {}),
      // The describe call has no session, so only global hub servers are published here.
      ...(scope === "conversation" && mcpUrl ? await dependencies.mcpHub.externalMcp(mcpUrl) : {}),
    };
  }
  const mcpHttp = new McpHttp({
    store: dependencies.engine.store,
    social: dependencies.social,
    conversationAccess: dependencies.conversationAccess,
    agentRole: (sessionId) => dependencies.conversationDelegation.agentRole(sessionId),
    runtimeLogAccess: dependencies.runtimeLogAccess,
    runtimeLogs: dependencies.runtimeLogs,
    refreshLogSources: dependencies.refreshLogSources,
    conversationWorkspace: dependencies.conversationWorkspace,
    projectSessions: dependencies.projectSessionList,
    sessionReference: dependencies.localSessionReference,
    hub: dependencies.mcpHub,
  });
  return {
    mobilePairing,
    mobileAccess,
    mobileIngressSecret,
    mobileLan,
    tunnels,
    mcpBridgeMetadata,
    mcpHttp,
  };
}
