import { basename, extname, isAbsolute, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  isRemoteProvider,
  type RemoteProvider,
} from "../../src/features/connections/model/protocol";
import { binaryNames, providerLaunch } from "../process";
import { resolveSessionCwd } from "./session-folder";

/** Provider binary resolution and the argument allowlists for direct CLI executions. */

const ALLOWED_EXEC_ARGS: readonly (readonly string[])[] = [
  ["--version"],
  ["--list-models"],
  ["models", "--verbose"],
  ["models", "--json"],
  ["models"],
  ["status", "--json"],
  ["agent", "list"],
];
// OpenCode 2.x runs as a background service; other providers' CLIs may give
// these subcommands unrelated meanings, so they stay OpenCode-only.
const OPENCODE_EXEC_ARGS: readonly (readonly string[])[] = [
  ["service", "status"],
  ["service", "start"],
  ["service", "get", "password"],
];

export function execArgsAllowed(provider: RemoteProvider, args: string[]): boolean {
  const matches = (allowed: readonly string[]) =>
    allowed.length === args.length && allowed.every((arg, index) => arg === args[index]);
  return (
    ALLOWED_EXEC_ARGS.some(matches) ||
    (provider === "opencode" && OPENCODE_EXEC_ARGS.some(matches)) ||
    (provider === "grok" &&
      args.length === 4 &&
      args[0] === "--no-auto-update" &&
      args[1] === "sessions" &&
      args[2] === "delete" &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args[3]))
  );
}

export function loopbackUrl(value: unknown): string {
  const url = new URL(String(value));
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("OpenCode HTTP is limited to localhost");
  return url.href;
}

/** Native process implementation for the headless execution proof. */
export const expandHome = (path: string) =>
  path === "~" || /^~[\\/]/.test(path) ? join(homedir(), path.slice(1)) : path;

/** A configured provider binary: absolute, existing and launchable. Paths that arrive from a
 * client must also be named like the provider, as the desktop requires. */
export async function configuredBinary(
  provider: RemoteProvider,
  value: string,
  requireProviderName: boolean,
): Promise<string> {
  const path = expandHome(value.trim());
  if (!path || !isAbsolute(path))
    throw new Error(`Configured ${provider} binary must be an absolute path`);
  if (!(await stat(path).catch(() => undefined))?.isFile())
    throw new Error(`Configured ${provider} binary was not found: ${path}`);
  const windows = process.platform === "win32";
  // Windows matches the file stem, like the desktop (agy_acp_server.par, agy.exe).
  const name = windows ? basename(path, extname(path)) : basename(path);
  if (
    requireProviderName &&
    provider !== "acp" &&
    !binaryNames[provider].some((expected) =>
      windows ? expected.toLowerCase() === name.toLowerCase() : expected === name,
    )
  )
    throw new Error(
      `Configured ${provider} binary must be named ${binaryNames[provider].join(" or ")}`,
    );
  await providerLaunch(path, []);
  return path;
}

/** Spawn reports a missing cwd as the executable being missing; name the folder instead. */
export async function workingDirectory(value: string): Promise<string> {
  const cwd = (await resolveSessionCwd(value)) ?? expandHome(value);
  if (!(await stat(cwd).catch(() => undefined))?.isDirectory())
    throw new Error(`Working directory does not exist on this host: ${cwd}`);
  return cwd;
}

/** Host-owned provider binary overrides from `<host dir>/provider-binaries.json`. */
export async function readProviderBinaryOverrides(
  directory: string,
): Promise<Partial<Record<RemoteProvider, string>>> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(directory, "provider-binaries.json"), "utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([provider, path]) =>
          isRemoteProvider(provider) && typeof path === "string" && path.trim().length > 0,
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error("Ignoring invalid provider-binaries.json:", error);
    return {};
  }
}
