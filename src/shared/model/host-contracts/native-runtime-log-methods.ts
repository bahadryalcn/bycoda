import type { HostRpcMethodDefinition } from "./methods";
import type { NativeServiceMethod } from "./native-services";

/** Runtime log operations share the native-service policy and schema. */
export function nativeRuntimeLogMethods(
  operation: (method: NativeServiceMethod) => HostRpcMethodDefinition,
) {
  return {
    "native.services.runtimeLogs.bridge.describe": operation(
      "native.services.runtimeLogs.bridge.describe",
    ),
    "native.services.runtimeLogs.access.issue": operation(
      "native.services.runtimeLogs.access.issue",
    ),
    "native.services.runtimeLogs.terminals.demand": operation(
      "native.services.runtimeLogs.terminals.demand",
    ),
    "native.services.runtimeLogs.terminals.append": operation(
      "native.services.runtimeLogs.terminals.append",
    ),
  };
}
