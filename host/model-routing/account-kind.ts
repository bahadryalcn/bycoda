import type { ModelRoutingScope } from "../../src/shared/model/host-contracts/model-routing";
import type { HostProviderAccountCatalog } from "../providers/provider-accounts";

const WORK_WORDS = new Set(["work", "iş", "is", "şirket", "company", "corp", "office", "job"]);
const PERSONAL_WORDS = new Set(["personal", "kişisel", "private", "home", "kendi"]);

/**
 * Scope a human account label implies, by whole words. A label matching both lists or neither
 * is undefined, so the account stays shared. Keep in step with the renderer's inferAccountKind.
 */
export function inferAccountKind(label: string): ModelRoutingScope | undefined {
  const words = label
    .toLocaleLowerCase("tr")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const work = words.some((word) => WORK_WORDS.has(word));
  const personal = words.some((word) => PERSONAL_WORDS.has(word));
  return work === personal ? undefined : work ? "work" : "personal";
}

/** Explicit kind, else the Host-derived one, else the label's. Default and unknown accounts are shared. */
export function providerAccountKind(
  accounts: HostProviderAccountCatalog,
  harness: string,
  providerAccountId: string | undefined,
): ModelRoutingScope | undefined {
  if (harness !== "claude" && harness !== "codex") return undefined;
  const account = accounts[harness]?.find((item) => item.id === providerAccountId);
  return account && (account.kind ?? account.derivedKind ?? inferAccountKind(account.label));
}
