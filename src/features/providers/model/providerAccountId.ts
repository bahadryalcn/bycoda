/** Providers whose CLIs support isolated, locally named account profiles. The Host
 * imports this module, so it stays free of UI state. */
export const PROVIDER_ACCOUNT_PROVIDERS = ["claude", "codex", "grok"] as const;

/** Account profile names are local identifiers, never paths or credentials. */
export function parseProviderAccountId(value: unknown, provider: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    !PROVIDER_ACCOUNT_PROVIDERS.some((candidate) => candidate === provider) ||
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(value)
  )
    throw new Error("Invalid provider account ID");
  return value;
}
