import * as dto from "../../../src/shared/model/host-contracts/dev-servers";
import { assertDomainAuthority, type HostDomainContext } from "../context";

type Params = Record<string, unknown>;
type Authorize = () => Promise<void>;
export type DevServerAction =
  | "list"
  | "details"
  | "start"
  | "stop"
  | "kill"
  | "restart"
  | "logs"
  | "openExternal";
export type DevServerBridgeAction =
  | "bridgeCheck"
  | "bridgeOpen"
  | "bridgeRead"
  | "bridgeWrite"
  | "bridgeClose";
export type DevServerProject = { id: string; name: string; path: string };
export type WorkspaceDevServerRequest = {
  workspaceId: string;
  runId: string;
  kinds: Array<"vite" | "hmr" | "host" | "cdp">;
  command: string;
  cwd: string;
  projectId?: string;
  name?: string;
};
type OwnerResult =
  | dto.DevServersListResult
  | dto.DevServersDetailsResult
  | dto.DevServersStartResult
  | dto.DevServersStopResult
  | dto.DevServersLogsResult;
export interface DevServersContext extends HostDomainContext {
  /** Per-request native capability. Composition closes over the existing paired
   * credential owner; neither params nor a singleton supply that identity. */
  devServerAccess?(
    method: `devServers.${DevServerBridgeAction}`,
    params: Params,
    authorize: Authorize,
  ): Promise<dto.DevServersBridgeResult>;
}
export interface DevServersPorts {
  project(id: string): Promise<unknown>;
  projects(): Promise<Array<{ id: string; name: string; cwd: string }>>;
  workspace(id: unknown): Promise<{ id: string; projectId: string; path: string } | undefined>;
  assertWorkspaceWritable(id: string): Promise<void>;
  servers: {
    handle(
      method: string,
      params: Params,
      projects: DevServerProject[],
      authorize?: Authorize,
    ): Promise<OwnerResult>;
    startWorkspace(
      request: WorkspaceDevServerRequest,
      projects: DevServerProject[],
      authorize?: Authorize,
    ): Promise<{ lease: dto.DevServerWorkspaceLease; result: dto.DevServersStartResult }>;
  };
  /** Existing owning-Host browser opener, with authorization immediately before launch. */
  openExternal(
    url: string,
    context: HostDomainContext,
    authorize: Authorize,
  ): Promise<{ url: string }>;
}
const schemas = {
  list: dto.DevServersListParamsSchema,
  details: dto.DevServersTargetParamsSchema,
  start: dto.DevServersStartParamsSchema,
  stop: dto.DevServersTargetParamsSchema,
  kill: dto.DevServersTargetParamsSchema,
  restart: dto.DevServersRestartParamsSchema,
  logs: dto.DevServersTargetParamsSchema,
  openExternal: dto.DevServersOpenExternalParamsSchema,
  bridgeCheck: dto.DevServersBridgeEndpointParamsSchema,
  bridgeOpen: dto.DevServersBridgeEndpointParamsSchema,
  bridgeRead: dto.DevServersBridgeStreamParamsSchema,
  bridgeWrite: dto.DevServersBridgeWriteParamsSchema,
  bridgeClose: dto.DevServersBridgeStreamParamsSchema,
};

/** Routing and request grants only. The existing owner remains the sole process,
 * signal, port-lease, activity and private relay implementation. */
export function createDevServersService(ports: DevServersPorts) {
  const execute = async (
    action: DevServerAction | DevServerBridgeAction,
    raw: Params,
    context: DevServersContext,
    options: { legacy?: boolean } = {},
  ) => {
    const authorize = () => assertDomainAuthority(context);
    await authorize();
    // V1 intentionally keeps its tolerant fields and nested identity/config JSON.
    const params: Params = options.legacy ? raw : schemas[action].parse(raw);
    await ports.project(String(params.projectId ?? ""));
    await authorize();
    let result;
    if (action.startsWith("bridge")) {
      if (!context.devServerAccess)
        throw new Error("Private development server access is unavailable");
      result = await context.devServerAccess(
        `devServers.${action as DevServerBridgeAction}`,
        params,
        authorize,
      );
    } else {
      const projects = (await ports.projects()).map(({ id, name, cwd }) => ({
        id,
        name,
        path: cwd,
      }));
      await authorize();
      if (action === "openExternal") {
        const details = (await ports.servers.handle(
          "devServers.details",
          params,
          projects,
          authorize,
        )) as dto.DevServersDetailsResult;
        await authorize();
        const endpoint = details.server.endpoints.find(
          (entry) =>
            entry.port === params.port &&
            (params.address === undefined || entry.address === params.address),
        );
        if (!endpoint) throw new Error("The selected server is no longer listening on this port");
        result = await ports.openExternal(endpoint.url, context, authorize);
      } else if (action === "start" && params.workspaceId !== undefined) {
        const workspace = await ports.workspace(params.workspaceId);
        if (!workspace || workspace.projectId !== params.projectId)
          throw new Error("Managed workspace belongs to another project");
        await ports.assertWorkspaceWritable(workspace.id);
        await authorize();
        result = await ports.servers.startWorkspace(
          {
            workspaceId: workspace.id,
            runId: String(params.runId ?? ""),
            kinds: ["vite", "hmr", "host", "cdp"],
            command: String(params.command ?? ""),
            cwd: workspace.path,
            projectId: workspace.projectId,
            ...(typeof params.name === "string" ? { name: params.name } : {}),
          },
          projects,
          authorize,
        );
      } else
        result = await ports.servers.handle(`devServers.${action}`, params, projects, authorize);
    }
    await authorize();
    return result;
  };
  const operation =
    (action: DevServerAction | DevServerBridgeAction) =>
    (params: Params, context: DevServersContext, options?: { legacy?: boolean }) =>
      execute(action, params, context, options);
  return {
    execute,
    list: operation("list"),
    details: operation("details"),
    start: operation("start"),
    stop: operation("stop"),
    kill: operation("kill"),
    restart: operation("restart"),
    logs: operation("logs"),
    openExternal: operation("openExternal"),
    bridgeCheck: operation("bridgeCheck"),
    bridgeOpen: operation("bridgeOpen"),
    bridgeRead: operation("bridgeRead"),
    bridgeWrite: operation("bridgeWrite"),
    bridgeClose: operation("bridgeClose"),
  };
}
