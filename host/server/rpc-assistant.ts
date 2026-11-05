import { assistantDomain } from "../domains/assistant/service";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
export async function handleAssistantRpc(
  dependencies: Pick<ServerBindings, "assistant" | "engine">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "assistant.request":
      request.result = await assistantDomain(dependencies.assistant, dependencies.engine.store)(
        request.params,
        request.domainContext,
      );
      break;
  }
}
