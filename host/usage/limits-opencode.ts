import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LimitsFetch } from "./limits-fetch";
import {
  MONTHLY_MINUTES,
  SESSION_MINUTES,
  WEEKLY_MINUTES,
  resetTimestamp,
  type NamedWindow,
  type ParsedLimits,
} from "./limits-parse";

/** OpenCode Go 5h / weekly / monthly usage via the local Go API key; the key never leaves this process. */

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const REQUEST_MS = 10_000;
const MAX_BODY_BYTES = 256 * 1024;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const env = (name: string) => process.env[name]?.trim() || null;

/** `percent` is percent used, as on the OpenCode dashboard; windows with an unknown status are dropped. */
export function parseOpencodeGoUsage(body: unknown): ParsedLimits {
  const root = record(body);
  const usage = record(root?.usage) ?? root;
  const windows: NamedWindow[] = [];
  for (const [field, key, minutes] of [
    ["rolling", "session", SESSION_MINUTES],
    ["weekly", "weekly", WEEKLY_MINUTES],
    ["monthly", "monthly", MONTHLY_MINUTES],
  ] as const) {
    const source = record(usage?.[field]);
    if (!source || (source.status !== "ok" && source.status !== "rate-limited")) continue;
    const raw = source.percent ?? source.usedPercent;
    const used =
      typeof raw === "number" || (typeof raw === "string" && raw.trim()) ? Number(raw) : NaN;
    if (!Number.isFinite(used)) continue;
    windows.push({
      key,
      kind: key,
      model: null,
      window: {
        usedPercent: Math.min(100, Math.max(0, used)),
        windowMinutes: minutes,
        resetsAt: resetTimestamp(source.resetsAt) ?? resetTimestamp(source.resets_at),
      },
    });
  }
  return { windows, resetCredits: null };
}

/** JSON with comments and trailing commas, as OpenCode's own config allows. */
export function parseJsonc(raw: string): unknown {
  try {
    return JSON.parse(raw.trim());
  } catch {
    // fall through to the lenient pass
  }
  let out = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      out += ch;
      if (ch === "\\") out += raw[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2);
      i = end < 0 ? raw.length : end + 1;
    } else out += ch;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

const goKey = (auth: unknown): string | null => {
  const key = record(record(auth)?.["opencode-go"])?.key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
};

function configKey(config: unknown): string | null {
  const providers = record(record(config)?.provider);
  for (const id of ["opencode-go", "opencode"]) {
    const value = record(record(providers?.[id])?.options)?.apiKey;
    if (typeof value !== "string" || !value.trim()) continue;
    const ref = /^\{env:(.+)\}$/.exec(value.trim());
    if (!ref) return value.trim();
    const resolved = env(ref[1]);
    if (resolved) return resolved;
  }
  return null;
}

async function readJsonc(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8").catch(() => null);
  return raw ? parseJsonc(raw) : null;
}

/** Same precedence as OpenCode: injected auth blob, explicit config key, then stored credentials. */
export async function readOpencodeGoKey(): Promise<string | null> {
  const blob = env("OPENCODE_AUTH_CONTENT");
  if (blob) {
    const parsed = parseJsonc(blob);
    if (record(parsed)) return goKey(parsed);
  }
  const inline = env("OPENCODE_CONFIG_CONTENT");
  const fromInline = inline ? configKey(parseJsonc(inline)) : null;
  if (fromInline) return fromInline;
  const home = homedir();
  const xdgConfig = env("XDG_CONFIG_HOME");
  const configPaths = [
    env("OPENCODE_CONFIG"),
    ...[xdgConfig && join(xdgConfig, "opencode"), join(home, ".config", "opencode")].flatMap(
      (dir) => (dir ? [join(dir, "opencode.jsonc"), join(dir, "opencode.json")] : []),
    ),
  ];
  for (const path of configPaths) {
    const key = path ? configKey(await readJsonc(path)) : null;
    if (key) return key;
  }
  const dataDir =
    env("OPENCODE_DATA_DIR") ??
    join(
      env("XDG_DATA_HOME") ?? join(home, ".local", "share"),
      env("OPENCODE_APPNAME") ?? "opencode",
    );
  for (const path of [
    join(dataDir, "auth.json"),
    join(home, "Library", "Application Support", "opencode", "auth.json"),
  ]) {
    const key = goKey(await readJsonc(path));
    if (key) return key;
  }
  return null;
}

export async function fetchOpencodeLimits(
  readKey: () => Promise<string | null> = readOpencodeGoKey,
  request: typeof fetch = fetch,
): Promise<LimitsFetch> {
  const key = await readKey().catch(() => null);
  if (!key) return { status: "unavailable", error: "OpenCode Go not connected" };
  try {
    const response = await request(USAGE_URL, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    // A valid key without a Go subscription is "not applicable", not a failure.
    if (response.status === 401 || response.status === 403)
      return {
        status: "unavailable",
        error: "OpenCode Go usage is unavailable for this key",
      };
    if (!response.ok)
      return {
        status: "error",
        error: `OpenCode Go usage request failed (${response.status})`,
      };
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES)
      return {
        status: "error",
        error: "OpenCode Go usage response was too large",
      };
    const limits = parseOpencodeGoUsage(JSON.parse(text));
    return limits.windows.length
      ? { status: "ok", limits }
      : { status: "error", error: "OpenCode Go usage response was unexpected" };
  } catch {
    return { status: "error", error: "OpenCode Go usage request failed" };
  }
}
