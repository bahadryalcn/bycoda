import type { HostRpcMethodDefinition } from "./methods";
import type { NativeServiceMethod } from "./native-services";

/**
 * Owner-RPC inventory for the Social native services; the caller passes its native-service builder
 * in, as decisionModelsMethods does, so this module never imports methods at runtime.
 */
export function socialNativeMethods(
  nativeService: (method: NativeServiceMethod) => HostRpcMethodDefinition,
) {
  return {
    "native.services.social.bridge.describe": nativeService(
      "native.services.social.bridge.describe",
    ),
    "native.services.social.access.issue": nativeService("native.services.social.access.issue"),
    "native.services.social.native.status": nativeService("native.services.social.native.status"),
    "native.services.social.native.enroll": nativeService("native.services.social.native.enroll"),
    "native.services.social.native.register": nativeService(
      "native.services.social.native.register",
    ),
    "native.services.social.native.authority": nativeService(
      "native.services.social.native.authority",
    ),
    "native.services.social.native.reset": nativeService("native.services.social.native.reset"),
  };
}
