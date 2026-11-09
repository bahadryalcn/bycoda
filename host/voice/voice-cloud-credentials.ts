import type { SocialCredentialStore } from "../social/social-credentials";

export type VoiceCloudProvider = "elevenlabs" | "openrouter";
export type VoiceCloudStatus = Record<VoiceCloudProvider, boolean>;

const ENV: Record<VoiceCloudProvider, string> = {
  elevenlabs: "ELEVENLABS_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Cloud voice API keys (ElevenLabs reply voice, OpenRouter dictation) in the encrypted OS vault (`OsSocialCredentials`, in its
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

  async status(): Promise<VoiceCloudStatus> {
    const has = async (provider: VoiceCloudProvider) =>
      Boolean(await this.get(provider).catch(() => undefined));
    return { elevenlabs: await has("elevenlabs"), openrouter: await has("openrouter") };
  }

  /** Verifies a new key with its provider before storing it; `null` removes it. */
  async setKey(provider: unknown, key: unknown): Promise<VoiceCloudStatus> {
    if (provider !== "elevenlabs" && provider !== "openrouter")
      throw new Error("Unsupported voice provider.");
    if (key === null) {
      await this.store.delete(provider);
      return this.status();
    }
    const value = typeof key === "string" ? key.trim() : "";
    if (provider === "openrouter") {
      await this.verifyOpenRouter(value);
      await this.store.set(provider, { accessToken: value });
      return this.status();
    }
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

  private async verifyOpenRouter(value: string) {
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(value)) throw new Error("Invalid OpenRouter API key.");
    let response: Response;
    try {
      // Reads only this key's own limits; it confirms the key reaches OpenRouter.
      response = await this.request("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${value}` },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new Error("OpenRouter could not be reached. Check the connection and try again.");
    }
    if (response.status === 401 || response.status === 403)
      throw new Error("OpenRouter rejected this API key.");
    if (!response.ok)
      throw new Error(`OpenRouter could not verify the API key (${response.status}).`);
  }
}
