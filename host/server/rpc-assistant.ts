import { assistantDomain } from "../domains/assistant/service";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";
import { ownerDeviceActivity } from "../desktop/desktop-voice-activity";
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
    // The owner is using bycoda on another device; availability here reads Here.
    case "assistant.ownerActive":
      ownerDeviceActivity.record();
      dependencies.assistant.refreshPresenceSoon();
      request.result = { ok: true };
      break;
  }
}
