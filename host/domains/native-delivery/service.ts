import {
  NATIVE_DELIVERY_RPC_SCHEMAS,
  type NativeDeliveryMethod,
} from "../../../src/shared/model/host-contracts/native-delivery";
import {
  assertDomainAuthority,
  HostDomainAuthorizationError,
  type HostDomainContext,
} from "../context";

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
      const result = await context.nativeDelivery.call(method, params, (check) =>
        context.retainResultAuthority?.(check),
      );
      await assertDomainAuthority(context);
      return NATIVE_DELIVERY_RPC_SCHEMAS[method].result.parse(result);
    },
  };
}
