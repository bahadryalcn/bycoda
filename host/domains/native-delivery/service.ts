import {
  NATIVE_DELIVERY_RPC_SCHEMAS,
  type NativeDeliveryMethod,
} from "../../../src/shared/model/host-contracts/native-delivery";
import { monotonicNow } from "../../../src/shared/lib/time/timestamps";
import {
  assertDomainAuthority,
  HostDomainAuthorizationError,
  type HostDomainContext,
} from "../context";

/**
 * Longest a delivery may wait, counted from the transport's receipt of the request, to be
 * durably admitted. It stays under the desktop caller's own deadline, so an original is never
 * admitted for a caller that already gave up. Admission only: once admitted, the effect and its
 * record are never cut by it.
 */
export const NATIVE_DELIVERY_ADMISSION_MS = 20_000;

export function createNativeDeliveryService() {
  return {
    async call(
      method: NativeDeliveryMethod,
      raw: Record<string, unknown>,
      context: HostDomainContext,
    ) {
      await assertDomainAuthority(context);
      if (!context.nativeDelivery) throw new HostDomainAuthorizationError();
      const params = NATIVE_DELIVERY_RPC_SCHEMAS[method].params.parse(raw);
      const result = await context.nativeDelivery.call(
        method,
        params,
        (check) => context.retainResultAuthority?.(check),
        { admitBefore: (context.ingressAt ?? monotonicNow()) + NATIVE_DELIVERY_ADMISSION_MS },
      );
      await assertDomainAuthority(context);
      return NATIVE_DELIVERY_RPC_SCHEMAS[method].result.parse(result);
    },
  };
}
