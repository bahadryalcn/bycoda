import type { ModelRoutingScope } from "../../src/shared/model/host-contracts/model-routing";
import { isProfileProvider, type HostProviderAccountCatalog } from "../providers/provider-accounts";

/** An existing provider account uses its saved kind, with Personal for legacy profiles. */
export function providerAccountKind(
  accounts: HostProviderAccountCatalog,
  harness: string,
  providerAccountId: string | undefined,
): ModelRoutingScope | undefined {
  if (!isProfileProvider(harness)) return undefined;
  const account = accounts[harness]?.find((item) => item.id === (providerAccountId ?? "default"));
  return account && (account.kind ?? "personal");
}
