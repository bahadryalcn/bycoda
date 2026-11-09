import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleConversationRpc(
  dependencies: Pick<ServerBindings, "nativeServicesService">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "conversation.desktop.take":

    case "conversation.desktop.finish":

    case "conversation.desktop.authorize":

    case "conversation.bridge.describe":

    case "conversation.access.issue":

    case "runtimeLogs.terminals.demand":
    case "runtimeLogs.terminals.append":

    case "runtimeLogs.bridge.describe":

    case "runtimeLogs.access.issue": {
      request.result = await dependencies.nativeServicesService.legacy(
        request.input.method as Parameters<typeof dependencies.nativeServicesService.legacy>[0],
        request.params,
        request.domainContext,
      );
      break;
    }
  }
}
