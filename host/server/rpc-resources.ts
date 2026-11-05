import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { hostDegradedSince } from "./support";
export async function handleResourcesRpc(
  dependencies: Pick<ServerBindings, "diagnostics">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "resources.read":
      request.result = {
        ...dependencies.diagnostics.read(request.token),
        health:
          hostDegradedSince === undefined
            ? { state: "unknown" }
            : { state: "degraded", since: hostDegradedSince, reason: "unhandled-rejection" },
      };
      break;
  }
}
