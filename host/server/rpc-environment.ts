import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleEnvironmentRpc(
  dependencies: Pick<ServerBindings, "environmentService" | "persistenceService">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "environment.describe":
      request.result = await dependencies.environmentService.describe(request.params);
      break;

    case "environment.persistence.status":
      request.result = await dependencies.persistenceService.status(
        request.params,
        request.domainContext,
        { legacy: true },
      );
      break;

    case "environment.persistence.recover":
      request.result = await dependencies.persistenceService.recover(
        request.params,
        request.domainContext,
        {
          legacy: true,
        },
      );
      break;
  }
}
