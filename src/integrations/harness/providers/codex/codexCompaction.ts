/** Per-thread override; never writes the owner's Codex profile. */
export function codexAutoCompactConfig(
  settings: Readonly<Record<string, string>> | undefined,
): Record<string, number> | undefined {
  const raw = settings?.autoCompactWindow;
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const tokens = Number(raw);
  if (!Number.isSafeInteger(tokens) || tokens < 50_000 || tokens > 1_000_000) return undefined;
  return { model_auto_compact_token_limit: tokens };
}
