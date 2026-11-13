import * as dto from "../../../src/shared/model/host-contracts/model-routing";
import type { ModelRoutingService } from "./ports";
import { assertDomainAuthority, type HostDomainContext } from "../context";

export function createModelRoutingDomainService(service: ModelRoutingService) {
  return {
    async get(raw: unknown, context: HostDomainContext) {
      dto.ModelRoutingGetParamsSchema.parse(raw);
      await assertDomainAuthority(context);
      const state = await service.get();
      await assertDomainAuthority(context);
      return { state };
    },
    async save(raw: unknown, context: HostDomainContext) {
      const input = dto.ModelRoutingSaveParamsSchema.parse(raw);
      await assertDomainAuthority(context);
      // Only authenticated device-owner transports register this domain; no conversation tool route.
      const state = await service.save(input.expectedVersion, input.draft, () =>
        assertDomainAuthority(context),
      );
      return { state };
    },
    async status(raw: unknown, context: HostDomainContext) {
      dto.ModelRoutingStatusParamsSchema.parse(raw);
      await assertDomainAuthority(context);
      const entries = await service.status();
      await assertDomainAuthority(context);
      return { entries };
    },
    async resolve(raw: unknown, context: HostDomainContext) {
      const input = dto.ModelRoutingResolveParamsSchema.parse(raw);
      await assertDomainAuthority(context);
      const resolution = await service.resolve(input);
      await assertDomainAuthority(context);
      return { resolution };
    },
  };
}
