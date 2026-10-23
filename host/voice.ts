/** Only short-lived credentials leave the authenticated host. */
export async function createVoiceClientSecret(
  apiKey = process.env.XAI_API_KEY,
  request: typeof fetch = fetch,
): Promise<{ value: string; expires_at: number }> {
  if (!apiKey?.trim()) throw new Error("Set XAI_API_KEY on bycoda Host to use Grok Voice.");
  const response = await request("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: 60 } }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Grok Voice authentication failed (${response.status}).`);
  const result = (await response.json()) as { value?: unknown; expires_at?: unknown };
  if (typeof result.value !== "string" || typeof result.expires_at !== "number")
    throw new Error("Grok Voice returned an invalid temporary credential.");
  return { value: result.value, expires_at: result.expires_at };
}
