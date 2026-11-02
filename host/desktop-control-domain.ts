import { DesktopControlRequestValidationSchema, DesktopControlResponseSchema } from "../src/shared/model/host-contracts/desktop-control";
import type { HostDesktopControl } from "./desktop-control-host";
import type { HostStore } from "./store";
import { assertDomainAuthority, type HostDomainContext } from "./domains/context";

export function desktopControlDomain(desktop: HostDesktopControl, store: HostStore) {
  return async (raw:unknown, context:HostDomainContext) => {
    await assertDomainAuthority(context);
    if (!context.principalId) throw new Error("Desktop control requires a verified owner identity.");
    const principal = {kind:"owner" as const,id:context.principalId};
    const input = DesktopControlRequestValidationSchema.parse(raw);
    return store.db.withAuthorization(async()=>context.authorized(),async()=>{
      const result = await desktop.request(input,principal);
      await assertDomainAuthority({authorized:context.authorized,principalId:context.principalId});
      return DesktopControlResponseSchema.parse(result);
    });
  };
}
