import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { homedir } from "node:os";
import { providerLaunch } from "./process";
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
