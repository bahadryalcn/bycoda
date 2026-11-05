import type { SocialCredentialStore } from "../social/social-credentials";

export type VoiceCloudProvider = "elevenlabs";

const ENV: Record<VoiceCloudProvider, string> = { elevenlabs: "ELEVENLABS_API_KEY" };

/**
 * Cloud voice API keys in the encrypted OS vault (`OsSocialCredentials`, in its
 * own directory). An environment variable wins when set. Keys never leave the
 * Host: callers get only a yes/no status, and only the synthesizer reads a key.
 */
export class VoiceCloudCredentials {
  constructor(
    private readonly store: SocialCredentialStore,
    private readonly request: typeof fetch = fetch,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async get(provider: VoiceCloudProvider): Promise<string | undefined> {
    const fromEnv = this.env[ENV[provider]]?.trim();
    if (fromEnv) return fromEnv;
    return (await this.store.get(provider))?.accessToken || undefined;
  }

  async status(): Promise<{ elevenlabs: boolean }> {
    return { elevenlabs: Boolean(await this.get("elevenlabs").catch(() => undefined)) };
  }

  /** Verifies a new key with ElevenLabs before storing it; `null` removes it. */
  async setKey(provider: unknown, key: unknown): Promise<{ elevenlabs: boolean }> {
    if (provider !== "elevenlabs") throw new Error("Unsupported voice provider.");
    if (key === null) {
      await this.store.delete(provider);
      return this.status();
    }
    const value = typeof key === "string" ? key.trim() : "";
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(value)) throw new Error("Invalid ElevenLabs API key.");
    let response: Response;
    try {
      // Cheapest authenticated read; it also confirms the key reaches ElevenLabs.
      response = await this.request("https://api.elevenlabs.io/v1/voices?page_size=1", {
        headers: { "xi-api-key": value },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new Error("ElevenLabs could not be reached. Check the connection and try again.");
    }
    if (response.status === 401 || response.status === 403) {
      // A restricted key may lack "voices" access yet still allow speech.
      const body = (await response.json().catch(() => undefined)) as
        | { detail?: { status?: unknown } }
        | undefined;
      if (body?.detail?.status !== "missing_permissions")
        throw new Error("ElevenLabs rejected this API key.");
    } else if (!response.ok)
      throw new Error(`ElevenLabs could not verify the API key (${response.status}).`);
    await this.store.set(provider, { accessToken: value });
    return this.status();
  }
}
