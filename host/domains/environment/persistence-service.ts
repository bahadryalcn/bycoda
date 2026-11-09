import {
  HostPersistenceParamsSchema,
  HostPersistenceStatusSchema,
  type HostPersistenceStatus,
} from "../../../src/shared/model/host-contracts/persistence";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export interface HostPersistenceServicePorts {
  status(): HostPersistenceStatus | Promise<HostPersistenceStatus>;
  /** Composition must hold this authorization across the real storage probe. */
  recover(authorized: () => Promise<boolean>): Promise<void>;
}

export function createHostPersistenceService(ports: HostPersistenceServicePorts) {
  let recovering = false;
  const params = (raw: unknown, options: { legacy?: boolean }) => {
    if (options.legacy && raw && typeof raw === "object" && !Array.isArray(raw)) return;
    HostPersistenceParamsSchema.parse(raw);
  };
  const read = async () => HostPersistenceStatusSchema.parse(await ports.status());
  return {
    async status(
      raw: unknown,
      context: HostDomainContext,
      options: { legacy?: boolean } = {},
    ): Promise<HostPersistenceStatus> {
      await assertDomainAuthority(context);
      params(raw, options);
      const result = await read();
      await assertDomainAuthority(context);
      return result;
    },
    async recover(
      raw: unknown,
      context: HostDomainContext,
      options: { legacy?: boolean } = {},
    ): Promise<HostPersistenceStatus> {
      await assertDomainAuthority(context);
      params(raw, options);
      if (recovering) throw new Error("Persistence recovery is already in progress");
      recovering = true;
      try {
        const before = await read();
        await assertDomainAuthority(context);
        if (before.state === "recovery-required" || before.reason === "corrupt")
          throw new Error("Persistence requires restart or staged recovery");
        if (before.state === "recovering")
          throw new Error("Persistence recovery is already in progress");
        await ports.recover(async () => {
          await assertDomainAuthority(context);
          return true;
        });
        await assertDomainAuthority(context);
        const result = await read();
        await assertDomainAuthority(context);
        return result;
      } finally {
        // Cancellation/revocation must not release this while a probe is still running.
        recovering = false;
      }
    },
  };
}
