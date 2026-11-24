import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  idleRateLimits,
  parseResetTimestamp,
  quotaBillingProvider,
  SESSION_WINDOW_MINUTES,
  WEEKLY_WINDOW_MINUTES,
  type ProviderRateLimits,
  type QuotaSource,
  type RateLimitWindow,
} from "../../src/shared/model/provider-quota";
import { quotaRetryAfterMs, type LimitsFetch } from "./limits-fetch";
import type { NamedWindow } from "./limits-parse";

type PiSource = Extract<QuotaSource, `pi-${string}`>;
const MAX_BYTES = 256 * 1024;
const requestMs = 10_000;
const acpProviders = {
  "pi-anthropic": { key: "anthropic", endpoint: "https://api.anthropic.com/api/oauth/usage" },
  "pi-openai-codex": {
    key: "openai-codex",
    endpoint: "https://chatgpt.com/backend-api/wham/usage",
  },
} as const;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const header = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7e]+$/.test(value);

function authOverride(value: unknown): boolean {
  const source = record(value);
  return (
    !!source &&
    (["apiKey", "baseUrl", "headers", "authHeader"].some((key) => Object.hasOwn(source, key)) ||
      (Array.isArray(source.models) && source.models.some(authOverride)) ||
      Object.values(record(source.modelOverrides) ?? {}).some(authOverride))
  );
}

async function readJson(path: string): Promise<unknown> {
  const file = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!file) return null;
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_BYTES) throw new Error("Pi configuration is too large");
    return JSON.parse(buffer.toString("utf8", 0, length));
  } finally {
    await file.close();
  }
}

type Credential = { access: string; expires: number; accountId?: string };
async function readCredential(dir: string, source: PiSource): Promise<Credential | null> {
  const { key } = acpProviders[source];
  const models = record(await readJson(join(dir, "models.json")));
  if (authOverride(record(models?.providers)?.[key])) return null;
  const auth = record(record(await readJson(join(dir, "auth.json")))?.[key]);
  if (
    auth?.type !== "oauth" ||
    !header(auth.access) ||
    typeof auth.expires !== "number" ||
    !Number.isSafeInteger(auth.expires) ||
    auth.expires <= Date.now() ||
    (source === "pi-openai-codex" && !header(auth.accountId))
  )
    return null;
  return {
    access: auth.access,
    expires: auth.expires,
    ...(header(auth.accountId) ? { accountId: auth.accountId } : {}),
  };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Missing Pi quota response");
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) throw new Error("Pi usage response was too large");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function parsePiQuota(source: PiSource, payload: unknown): ProviderRateLimits {
  const output = { ...idleRateLimits(quotaBillingProvider(source)), status: "ok" as const };
  const root = record(payload);
  const anthropic = source === "pi-anthropic";
  const rawLimits = anthropic ? root : record(root?.rate_limit);
  const keys = anthropic ? ["five_hour", "seven_day"] : ["primary_window", "secondary_window"];
  for (const [index, key] of keys.entries()) {
    if (rawLimits?.[key] == null) continue;
    const window = record(rawLimits[key]);
    const usedPercent = anthropic ? window?.utilization : window?.used_percent;
    const minutes = anthropic
      ? index === 0
        ? SESSION_WINDOW_MINUTES
        : WEEKLY_WINDOW_MINUTES
      : typeof window?.limit_window_seconds === "number"
        ? window.limit_window_seconds / 60
        : NaN;
    const rawReset = anthropic ? window?.resets_at : window?.reset_at;
    const resetsAt =
      rawReset == null
        ? null
        : anthropic
          ? parseResetTimestamp(rawReset)
          : typeof rawReset === "number" && Number.isSafeInteger(rawReset * 1_000) && rawReset >= 0
            ? rawReset * 1_000
            : null;
    if (
      typeof usedPercent !== "number" ||
      !Number.isFinite(usedPercent) ||
      usedPercent < 0 ||
      usedPercent > 100 ||
      !Number.isSafeInteger(minutes) ||
      minutes <= 0 ||
      (rawReset != null && resetsAt === null)
    )
      throw new Error("Invalid Pi quota window");
    const slot = minutes >= WEEKLY_WINDOW_MINUTES ? "weekly" : "session";
    const reading: RateLimitWindow = { usedPercent, windowMinutes: minutes, resetsAt };
    if (!output[slot]) output[slot] = reading;
  }
  if (!output.session && !output.weekly) throw new Error("Missing Pi quota windows");
  return output;
}

/** Pi owns its OAuth tokens. This reads subscription usage using the saved profile. */
export async function fetchPiLimits(
  source: PiSource,
  configuredDir = process.env.PI_CODING_AGENT_DIR,
  request: typeof fetch = fetch,
): Promise<LimitsFetch> {
  const dir =
    configuredDir?.startsWith("~/") || configuredDir?.startsWith("~\\")
      ? join(homedir(), configuredDir.slice(2))
      : configuredDir || join(homedir(), ".pi", "agent");
  if (!isAbsolute(dir))
    return { status: "unavailable", error: "Pi usage needs an absolute configuration directory" };
  try {
    const credential = await readCredential(dir, source);
    if (!credential)
      return {
        status: "unavailable",
        error: "Sign in to a supported subscription through Pi to see usage",
      };
    const response = await request(acpProviders[source].endpoint, {
      headers: {
        Authorization: `Bearer ${credential.access}`,
        "User-Agent": "bycoda",
        ...(source === "pi-anthropic" ? { "anthropic-beta": "oauth-2025-04-20" } : {}),
        ...(source === "pi-openai-codex" && credential.accountId
          ? { "ChatGPT-Account-Id": credential.accountId }
          : {}),
      },
      signal: AbortSignal.timeout(requestMs),
      redirect: "error",
    });
    const payload = response.status === 200 ? await readResponse(response) : null;
    if (response.status !== 200) await response.body?.cancel().catch(() => undefined);
    const current = await readCredential(dir, source);
    if (
      !current ||
      current.access !== credential.access ||
      current.expires !== credential.expires ||
      current.accountId !== credential.accountId
    ) {
      return { status: "unavailable", error: "Pi credentials changed during the usage read" };
    }
    if (response.status === 401 || response.status === 403)
      return { status: "unavailable", error: "Usage is unavailable for this Pi account" };
    if (response.status !== 200)
      return {
        status: "error",
        error: "Could not fetch Pi usage",
        ...(response.status === 429
          ? { retryAfterMs: quotaRetryAfterMs(response.headers.get("Retry-After")) }
          : {}),
      };
    const desktop = parsePiQuota(source, payload);
    const windows: NamedWindow[] = (["session", "weekly"] as const).flatMap((kind) =>
      desktop[kind] ? [{ key: kind, kind, model: null, window: desktop[kind] }] : [],
    );
    return { status: "ok", limits: { windows, resetCredits: null }, desktop };
  } catch {
    return { status: "error", error: "Could not read Pi usage" };
  }
}
