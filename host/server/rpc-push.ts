import { parsePushRegistration, pushText } from "../push/push-store";
import type { ServerBindings } from "./bindings";
import type { OwnerRpcRequest } from "./owner-rpc-context";

/** Phone push registration. Every method acts only on the caller's own pairing. */
export async function handlePushRpc(
  dependencies: Pick<ServerBindings, "pushDevices" | "pushNotifications">,
  request: OwnerRpcRequest,
): Promise<void> {
  switch (request.input.method) {
    case "push.register":
      await dependencies.pushDevices.register(
        request.tokenHash,
        parsePushRegistration(request.params),
      );
      request.result = { registered: true };
      break;
    case "push.unregister":
      request.result = {
        unregistered: await dependencies.pushDevices.unregister(request.tokenHash),
      };
      break;
    case "push.test":
      request.result = {
        sent: await dependencies.pushNotifications.test(
          request.tokenHash,
          pushText(request.params.body, "text"),
        ),
      };
      break;
  }
}
