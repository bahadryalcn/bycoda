import { execFileAsync as exec } from "../../src/shared/lib/processExecution.node";
import { homedir } from "node:os";
import { providerLaunch } from "../process";
import { providerAccountEnvironment } from "./provider-accounts";

/** Return only a status, never the CLI output (Codex may include API-key details). */
export function parseProviderAuthStatus(
  provider: string,
  success: boolean,
  stdout: string,
  stderr: string,
): "signedIn" | "signedOut" | "unknown" {
  if (provider === "claude") {
    try {
      const loggedIn = JSON.parse(stdout)?.loggedIn;
      if (loggedIn === true && success) return "signedIn";
      if (loggedIn === false) return "signedOut";
    } catch {
      /* Old CLI or operational error, not a sign-out. */
    }
  }
  if (provider === "codex") {
    const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((line) => line.trim());
    if (lines.some((line) => /^Not logged in$/i.test(line))) return "signedOut";
    if (success && lines.some((line) => line.startsWith("Logged in using "))) return "signedIn";
  }
  return "unknown";
}

/** How long a signed-in answer is reused; a sign-out shows on the next run's own failure. */
export const SIGNED_IN_REUSE_MS = 2 * 60_000;
const signedIn = new Map<string, number>();
const probing = new Map<string, ReturnType<typeof providerAuthStatus>>();

/**
 * `providerAuthStatus` for the app's repeated sign-in checks. Each check starts the provider
 * CLI, and process creation blocks the Host event loop (one took 530 ms on Windows), so a
 * signed-in answer is reused for SIGNED_IN_REUSE_MS and concurrent checks share one process.
 * Signed-out and unknown answers are never reused, so a fresh login shows on the next check.
 */
export function reusedProviderAuthStatus(
  provider: string,
  command: string,
  accountId?: string,
): ReturnType<typeof providerAuthStatus> {
  const key = `${provider}\0${command}\0${accountId ?? ""}`;
  const at = signedIn.get(key);
  if (at !== undefined && Date.now() - at < SIGNED_IN_REUSE_MS) return Promise.resolve("signedIn");
  let flight = probing.get(key);
  if (!flight) {
    flight = providerAuthStatus(provider, command, accountId).then((status) => {
      if (status === "signedIn") signedIn.set(key, Date.now());
      else signedIn.delete(key);
      return status;
    });
    probing.set(key, flight);
    void flight
      .finally(() => {
        if (probing.get(key) === flight) probing.delete(key);
      })
      .catch(() => {});
  }
  return flight;
}

export async function providerAuthStatus(provider: string, command: string, accountId?: string) {
  if (provider !== "claude" && provider !== "codex") return "unknown";
  const args = provider === "claude" ? ["auth", "status", "--json"] : ["login", "status"];
  const profile = await providerAccountEnvironment({ provider, id: accountId });
  const env = { ...process.env, ...profile?.set };
  for (const name of profile?.remove ?? []) delete env[name];
  const launch = await providerLaunch(command, args);
  try {
    const { stdout, stderr } = await exec(launch.command, launch.args, {
      cwd: homedir(),
      env,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    return parseProviderAuthStatus(provider, true, String(stdout), String(stderr));
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; killed?: boolean; code?: unknown };
    if (result.killed || typeof result.code !== "number") return "unknown";
    return parseProviderAuthStatus(
      provider,
      false,
      String(result.stdout ?? ""),
      String(result.stderr ?? ""),
    );
  }
}
