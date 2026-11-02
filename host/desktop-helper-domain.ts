import type { HostStore } from "./store";
import type { HostDesktopHelper } from "./desktop-helper";
import { assertDomainAuthority, type HostDomainContext } from "./domains/context";

export function desktopHelperDomain(helper: HostDesktopHelper, store: HostStore) {
  return async (raw: unknown, context: HostDomainContext) => {
    await assertDomainAuthority(context);
    if (!context.principalId) throw new Error("A captured owner is required for helper setup.");
    const result = await helper.request(raw, () =>
      store.db.outsideScope(() => context.authorized()),
    );
    await assertDomainAuthority(context);
    return result;
  };
}
