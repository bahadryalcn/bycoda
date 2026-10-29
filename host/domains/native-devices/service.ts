import {
  DEVICE_OWNER_RPC_SCHEMAS,
  type DeviceOwnerMethod,
  deviceOwnerReadOnly,
} from "../../../src/shared/model/host-contracts/native-devices";
import {
  assertDomainAuthority,
  HostDomainAuthorizationError,
  HostDomainOutcomeError,
  type HostDomainContext,
} from "../context";

export function createNativeDevicesService() {
  return {
    async call(
      method: DeviceOwnerMethod,
      raw: Record<string, unknown>,
      context: HostDomainContext,
      options: { legacy?: boolean } = {},
    ) {
      await assertDomainAuthority(context);
      if (!context.nativeDevices) throw new HostDomainAuthorizationError();
      const params = options.legacy ? raw : DEVICE_OWNER_RPC_SCHEMAS[method].params.parse(raw);
      let admitted = false;
      try {
        const result = await context.nativeDevices.call(
          method,
          params,
          (check) => context.retainResultAuthority?.(check),
          () => {
            admitted = true;
            context.deviceEffectAdmitted?.();
          },
        );
        await assertDomainAuthority(context);
        return result;
      } catch (cause) {
        if (!deviceOwnerReadOnly(method))
          throw new HostDomainOutcomeError(
            cause instanceof Error ? cause.message : "Device operation could not be confirmed.",
            admitted ? "unknown" : "not-sent",
            { cause },
          );
        throw cause;
      }
    },
  };
}
