import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { userInfo } from "node:os";

/** Claude Code keeps its OAuth blob in the macOS Keychain; this reads it the way the desktop does. */

export type KeychainRunner = (args: string[], timeoutMs: number) => Promise<string | null>;

const LEGACY_SERVICE = "Claude Code-credentials";
const FALLBACK_USER = "claude-code-user";
const KEYCHAIN_MS = 5_000;

/** Runs `security`; any failure (missing item, denied, timeout) is a silent null. The secret is only returned. */
export const runSecurity: KeychainRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    try {
      execFile(
        "security",
        args,
        { timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true },
        (error, stdout) => resolve(error ? null : String(stdout).trim() || null),
      );
    } catch {
      resolve(null);
    }
  });

/** Claude Code suffixes the service with the first 8 hex of sha256 over the NFC config dir it was pointed at. */
export function claudeKeychainService(configDir: string | null): string {
  if (!configDir) return LEGACY_SERVICE;
  const digest = createHash("sha256").update(configDir.normalize("NFC")).digest("hex");
  return `${LEGACY_SERVICE}-${digest.slice(0, 8)}`;
}

function keychainUser(): string {
  let user = process.env.USER || process.env.USERNAME || "";
  if (!user) {
    try {
      user = userInfo().username;
    } catch {
      user = "";
    }
  }
  return user && /^[A-Za-z0-9._-]+$/.test(user) ? user : FALLBACK_USER;
}

/** The raw credentials JSON for a profile, or null off macOS or when no Keychain item matches. */
export async function readClaudeKeychain(
  configDir: string | null,
  options: { platform?: string; run?: KeychainRunner } = {},
): Promise<string | null> {
  if ((options.platform ?? process.platform) !== "darwin") return null;
  const run = options.run ?? runSecurity;
  const service = claudeKeychainService(configDir);
  const attempts = [[], ["-a", keychainUser()], ["-a", FALLBACK_USER]];
  for (const account of attempts) {
    const secret = await run(
      ["find-generic-password", "-s", service, ...account, "-w"],
      KEYCHAIN_MS,
    );
    if (secret) return secret;
  }
  return null;
}
