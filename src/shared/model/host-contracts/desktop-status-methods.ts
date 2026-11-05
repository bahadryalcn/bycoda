import type { HostRpcMethodDefinition } from "./methods";
import type { NativeServiceMethod } from "./native-services";

/** Read-only indicator methods share the native-service transport. */
export function desktopStatusMethods(
  operation: (method: NativeServiceMethod) => HostRpcMethodDefinition,
) {
  return {
    "native.services.desktop.status": operation("native.services.desktop.status"),
    "native.services.desktop.status.wait": operation("native.services.desktop.status.wait"),
  };
}
