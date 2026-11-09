import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { providerLaunch } from "../process";
import { providerAccountEnvironment } from "../providers/provider-accounts";
import { readClaudeKeychain, type KeychainRunner } from "./limits-keychain";
import { parseClaudeUsage, parseCodexLimits, type ParsedLimits } from "./limits-parse";

/** Reads one account's provider quota. The Claude token and Codex session never leave this process. */

export type LimitsFetch =
  | { status: "ok"; limits: ParsedLimits }
  | { status: "unavailable" | "error"; error: string };

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
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
  // On macOS the Keychain is the primary store (like the desktop); the credentials file is the fallback.
  const stored = await readClaudeKeychain(selected, keychain).catch(() => null);
  const raw =
    (stored && claudeCredentials(stored) ? stored : null) ??
    (await readFile(join(dir, ".credentials.json"), "utf8").catch(() => null));
  const credentials = raw ? claudeCredentials(raw) : null;
  if (!credentials)
    return {
      status: "unavailable",
      error: "Claude not signed in on this computer",
    };
  // Claude Code owns token renewal; refreshing here could race it and spend the refresh token.
  if (credentials.expiresAt !== null && now >= credentials.expiresAt)
    return {
      status: "error",
      error: "Claude usage will update when this account is used again",
    };
  try {
    const response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.0",
      },
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    if (!response.ok)
      return {
        status: "error",
        error:
          response.status === 401
            ? "Claude sign-in expired"
            : response.status === 403
              ? "Claude usage is unavailable for this account"
              : `Claude usage request failed (${response.status})`,
      };
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES)
      return { status: "error", error: "Claude usage response was too large" };
    const limits = parseClaudeUsage(JSON.parse(text));
    return limits.windows.length
      ? { status: "ok", limits }
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
            const text = String(message.error.message ?? "");
            return finish(
              /not signed in|authentication required|not authenticated/i.test(text)
                ? { status: "unavailable", error: "Codex not signed in" }
                : { status: "error", error: "Codex usage unavailable" },
            );
          }
          const limits = parseCodexLimits(message.result);
          return finish(
            limits.windows.length || limits.resetCredits !== null
              ? { status: "ok", limits }
              : { status: "unavailable", error: "No Codex usage data" },
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
