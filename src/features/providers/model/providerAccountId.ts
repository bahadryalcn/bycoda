/** Account profile names are local identifiers, never paths or credentials. */
export function parseProviderAccountId(value: unknown, provider: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    (provider !== "claude" && provider !== "codex") ||
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(value)
  )
    throw new Error("Invalid provider account ID");
  return value;
}
