import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { providerLaunch } from "../process";
import { providerAccountEnvironment } from "../providers/provider-accounts";
import { readClaudeKeychain, type KeychainRunner } from "./limits-keychain";
import { parseClaudeUsage, parseCodexLimits, type ParsedLimits } from "./limits-parse";
import {
  parseClaudeOAuthUsage,
  parseCodexRateLimits,
  type ProviderRateLimits,
} from "../../src/shared/model/provider-quota";

/** Reads one account's provider quota. The Claude token and Codex session never leave this process. */

export type LimitsFetch =
  | { status: "ok"; limits: ParsedLimits; desktop?: ProviderRateLimits }
  | {
      status: "unavailable" | "error";
      error: string;
      retryAfterMs?: number;
      reason?: "signedOut" | "cliMissing";
      renewalPending?: boolean;
    };

/** A provider can give Retry-After as seconds or an HTTP date. */
export function quotaRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const delay = /^\d+$/.test(value.trim()) ? Number(value) * 1_000 : Date.parse(value) - now;
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1";
const REQUEST_MS = 10_000;
const CODEX_MS = 15_000;
const MAX_BODY_BYTES = 256 * 1024;

type Credentials = { token: string; expiresAt: number | null };

/** Claude Code's `.credentials.json` for an account profile directory (or the default profile). */
export function claudeCredentials(raw: string): Credentials | null {
  try {
    const blob = JSON.parse(raw.trim()) as Record<string, unknown>;
    const oauth = (blob.claudeAiOauth ?? blob) as Record<string, unknown>;
    const token = typeof oauth.accessToken === "string" ? oauth.accessToken.trim() : "";
    if (!token) return null;
    const expires = Number(oauth.expiresAt);
    return {
      token,
      expiresAt: Number.isFinite(expires) && expires > 0 ? expires : null,
    };
  } catch {
    return null;
  }
}

export async function fetchClaudeLimits(
  configDir: string | null,
  now = Date.now(),
  keychain: { platform?: string; run?: KeychainRunner } = {},
): Promise<LimitsFetch> {
  const selected = configDir ?? process.env.CLAUDE_CONFIG_DIR ?? null;
  const dir = selected ?? join(homedir(), ".claude");
  const readCredentials = async () => {
    // On macOS the Keychain is primary and the credentials file is the fallback.
    const stored = await readClaudeKeychain(selected, keychain).catch(() => null);
    const fromKeychain = stored ? claudeCredentials(stored) : null;
    if (fromKeychain) return fromKeychain;
    const raw = await readFile(join(dir, ".credentials.json"), "utf8").catch(() => null);
    return raw ? claudeCredentials(raw) : null;
  };
  const credentials = await readCredentials();
  if (!credentials)
    return {
      status: "unavailable",
      error: "Claude not signed in on this computer",
      reason: "signedOut",
    };
  // Claude Code owns token renewal; refreshing here could race it and spend the refresh token.
  if (credentials.expiresAt !== null && now >= credentials.expiresAt)
    return {
      status: "error",
      error: "Claude usage will update when this account is used again",
      renewalPending: true,
    };
  try {
    const response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-cli/2.1.322 (external, cli)",
      },
      signal: AbortSignal.timeout(REQUEST_MS),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        status: "error",
        ...(response.status === 429
          ? {
              retryAfterMs: quotaRetryAfterMs(response.headers.get("Retry-After"), now),
            }
          : {}),
        ...(response.status === 401 ? { reason: "signedOut" as const } : {}),
        error:
          response.status === 401
            ? "Claude sign-in expired"
            : response.status === 403
              ? "Claude usage is unavailable for this account"
              : `Claude usage request failed (${response.status})`,
      };
    }
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES)
      return { status: "error", error: "Claude usage response was too large" };
    const limits = parseClaudeUsage(JSON.parse(text));
    const desktop = parseClaudeOAuthUsage(text);
    limits.resetCredits = desktop.resetCredits?.availableCount ?? null;
    const current = await readCredentials();
    if (current?.token !== credentials.token || current.expiresAt !== credentials.expiresAt)
      return { status: "unavailable", error: "Claude account changed during the usage read" };
    return limits.windows.length || desktop.resetCredits
      ? { status: "ok", limits, desktop }
      : { status: "error", error: "Claude usage response was unexpected" };
  } catch {
    return { status: "error", error: "Claude usage request failed" };
  }
}

/** One short-lived `codex app-server` asked for `account/rateLimits/read` under the account's profile. */
export async function fetchCodexLimits(
  accountId: string,
  resolveCodex: () => Promise<{ path: string }>,
): Promise<LimitsFetch> {
  let launch: { command: string; args: string[] };
  let env: NodeJS.ProcessEnv = process.env;
  try {
    const path = (await resolveCodex()).path;
    launch = await providerLaunch(path, ["app-server"]);
    const account = await providerAccountEnvironment({
      provider: "codex",
      id: accountId,
    });
    if (account) {
      env = { ...process.env, ...account.set };
      for (const key of account.remove) delete env[key];
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      status: "unavailable",
      error: /not available on the host/.test(message) ? message : "Codex CLI not found",
    };
  }
  return await new Promise<LimitsFetch>((resolve) => {
    const child = spawn(launch.command, launch.args, {
      env,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let buffer = "";
    let done = false;
    const finish = (value: LimitsFetch) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(
      () => finish({ status: "error", error: "Codex usage probe timed out" }),
      CODEX_MS,
    );
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on("error", () => finish({ status: "unavailable", error: "Codex CLI not found" }));
    child.on("exit", () => finish({ status: "error", error: "Codex usage probe exited" }));
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 4 * MAX_BODY_BYTES)
        return finish({
          status: "error",
          error: "Codex usage response was too large",
        });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message: {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1 && !message.error) {
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read", params: {} });
        } else if (message.id === 2) {
          if (message.error) {
            send({ id: 3, method: "account/read", params: { refreshToken: false } });
            continue;
          }
          const limits = parseCodexLimits(message.result);
          return finish(
            limits.windows.length || limits.resetCredits !== null
              ? { status: "ok", limits, desktop: parseCodexRateLimits(message.result) }
              : { status: "unavailable", error: "No Codex usage data" },
          );
        } else if (message.id === 3) {
          const auth = message.result as
            | { requiresOpenaiAuth?: unknown; account?: unknown }
            | null
            | undefined;
          return finish(
            auth?.requiresOpenaiAuth === true && !auth.account
              ? { status: "unavailable", error: "Codex not signed in", reason: "signedOut" }
              : { status: "error", error: "Codex usage unavailable" },
          );
        } else if (message.id === 1) {
          return finish({ status: "error", error: "Codex usage unavailable" });
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "bycoda", title: "bycoda", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
    });
  });
}
