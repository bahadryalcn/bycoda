import { type DevServerAction, type DevServerBridgeAction } from "../domains/dev-servers/service";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleDevelopmentRpc(
  dependencies: Pick<ServerBindings, "devServersService">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "devServers.list":

    case "devServers.details":

    case "devServers.start":

    case "devServers.stop":

    case "devServers.kill":

    case "devServers.restart":

    case "devServers.logs":

    case "devServers.openExternal":

    case "devServers.bridgeCheck":

    case "devServers.bridgeOpen":

    case "devServers.bridgeRead":

    case "devServers.bridgeWrite":

    case "devServers.bridgeClose": {
      const action = request.input.method.slice("devServers.".length) as
        | DevServerAction
        | DevServerBridgeAction;
      request.result = await dependencies.devServersService.execute(
        action,
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;
    }
  }
}
