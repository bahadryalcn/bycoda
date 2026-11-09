import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { hostDegradedSince } from "./support";
export async function handleResourcesRpc(
  dependencies: Pick<ServerBindings, "diagnostics" | "mcpHub">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "resources.read":
      request.result = {
        ...dependencies.diagnostics.read(request.token),
        mcpHub: await dependencies.mcpHub.status(),
        health:
          hostDegradedSince === undefined
            ? { state: "unknown" }
            : { state: "degraded", since: hostDegradedSince, reason: "unhandled-rejection" },
      };
      break;
  }
}
