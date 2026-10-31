import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

export type RealtimeProvider = "xai" | "openai";
export type RealtimeSecret = { value: string; expires_at: number; model: string; url: string };

/** Current low-latency speech-to-speech models. `grok-voice-latest` tracks xAI's
 * recommended voice model; OpenAI pins its newest realtime release. */
export const REALTIME_MODELS: Record<RealtimeProvider, string> = {
  xai: "grok-voice-latest",
  openai: "gpt-realtime-2.1",
};
const PROVIDER = {
  xai: {
    name: "Grok Voice",
    env: "XAI_API_KEY",
    secrets: "https://api.x.ai/v1/realtime/client_secrets",
    socket: "wss://api.x.ai/v1/realtime",
    signIn: "Sign in to Grok Build (grok login) or set XAI_API_KEY on bycoda Host.",
  },
  openai: {
    name: "OpenAI Realtime",
    env: "OPENAI_API_KEY",
    secrets: "https://api.openai.com/v1/realtime/client_secrets",
    socket: "wss://api.openai.com/v1/realtime",
    signIn: "Sign in to Codex or set OPENAI_API_KEY on bycoda Host.",
  },
} as const;

type SecretDeps = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  read?: (path: string) => Promise<string>;
  request?: typeof fetch;
  now?: () => number;
};

async function readJson(read: (path: string) => Promise<string>, path: string) {
  try {
    return JSON.parse(await read(path)) as unknown;
  } catch {
    return undefined;
  }
}
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** The provider's own CLI keeps ownership of its login; this only reads the
 * current token to mint a 60-second voice credential. */
async function providerCredential(provider: RealtimeProvider, deps: Required<SecretDeps>) {
  const fromEnv = deps.env[PROVIDER[provider].env]?.trim();
  if (fromEnv) return fromEnv;
  if (provider === "xai") {
    const auth = record(await readJson(deps.read, join(deps.home, ".grok", "auth.json")));
    const entry =
      auth &&
      Object.values(auth)
        .map(record)
        .find((item) => item?.key);
    if (typeof entry?.key !== "string" || !entry.key.trim()) return undefined;
    const expires = typeof entry.expires_at === "string" ? Date.parse(entry.expires_at) : NaN;
    if (Number.isFinite(expires) && expires <= deps.now())
      throw new Error("Open Grok Build once to refresh its sign-in, then start voice again.");
    return entry.key.trim();
  }
  const codexHome = deps.env.CODEX_HOME?.trim() || join(deps.home, ".codex");
  const auth = record(await readJson(deps.read, join(codexHome, "auth.json")));
  if (typeof auth?.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim())
    return auth.OPENAI_API_KEY.trim();
  const token = record(auth?.tokens)?.access_token;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

/** Mints a short-lived realtime credential with the env key or the signed-in
 * Grok Build / Codex login. Never returns or reports the long-lived credential. */
export async function createRealtimeSecret(
  provider: unknown,
  deps: SecretDeps = {},
): Promise<RealtimeSecret> {
  if (provider !== "xai" && provider !== "openai") throw new Error("Invalid voice provider.");
  const full: Required<SecretDeps> = {
    env: deps.env ?? process.env,
    home: deps.home ?? homedir(),
    read: deps.read ?? ((path) => readFile(path, "utf8")),
    request: deps.request ?? fetch,
    now: deps.now ?? Date.now,
  };
  const info = PROVIDER[provider];
  const credential = await providerCredential(provider, full);
  if (!credential) throw new Error(`${info.name} is not signed in. ${info.signIn}`);
  const model = REALTIME_MODELS[provider];
  let response: Response;
  try {
    response = await full.request(info.secrets, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        provider === "xai"
          ? { expires_after: { seconds: 60 } }
          : {
              expires_after: { anchor: "created_at", seconds: 60 },
              session: { type: "realtime", model },
            },
      ),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error(`${info.name} could not be reached. Check the internet connection.`);
  }
  // Upstream bodies can echo credentials; report only the status.
  if (response.status === 401 || response.status === 403)
    throw new Error(`${info.name} sign-in was rejected (${response.status}). ${info.signIn}`);
  if (!response.ok) throw new Error(`${info.name} is unavailable (${response.status}).`);
  const result = record(await response.json().catch(() => undefined));
  if (typeof result?.value !== "string" || typeof result.expires_at !== "number")
    throw new Error(`${info.name} returned an invalid temporary credential.`);
  return {
    value: result.value,
    expires_at: result.expires_at,
    model,
    url: `${info.socket}?model=${encodeURIComponent(model)}`,
  };
}
