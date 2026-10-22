import { readFile, realpath, stat, symlink, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { desktopDatabasePaths } from "./desktopSessions";

// Mirrors the desktop app's account profiles (src-tauri/src/harness.rs
// `provider_account_path`/`apply_provider_account` and
// src-tauri/src/provider_terminal_profiles.rs). A conversation's provider
// thread lives in its account's profile, so the host must run the CLI there.
const DEFAULT_ACCOUNT_ID = "default";
const TERMINAL_PREFIX = "terminal-";
const PROFILES = {
  claude: {
    label: "Claude",
    shared: ["CLAUDE_CONFIG_DIR", ".claude"],
    // Claude scopes its config and its macOS Keychain credential to these
    // exact strings; the desktop sets both to the same profile directory.
    set: ["CLAUDE_CONFIG_DIR", "CLAUDE_SECURESTORAGE_CONFIG_DIR"],
    remove: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  },
  codex: {
    label: "Codex",
    shared: ["CODEX_HOME", ".codex"],
    set: ["CODEX_HOME"],
    remove: ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"],
  },
} as const;

export type ProviderAccountEnvironment = {
  set: Record<string, string>;
  remove: string[];
};

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

async function terminalProfile(root: string, provider: string, id: string) {
  const raw = await readFile(join(root, "terminal-profiles.json"), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const path = (JSON.parse(raw) as Record<string, unknown>)[`${provider}:${id}`];
    return typeof path === "string" && (await isDirectory(path)) ? path : null;
  } catch {
    return null;
  }
}

/** The profile directory the desktop app uses for this account, if present here. */
export async function providerAccountDir(
  provider: string,
  accountId: string,
  roots: string[] = desktopDatabasePaths().map(dirname),
): Promise<string | null> {
  for (const root of roots) {
    const dir = accountId.startsWith(TERMINAL_PREFIX)
      ? await terminalProfile(root, provider, accountId)
      : join(root, "provider-accounts", provider, accountId);
    if (dir && (await isDirectory(dir))) return dir;
  }
  return null;
}

/** Added accounts get a link to the user's shared custom agents, as on the desktop. */
async function linkSharedAgents(shared: string, dir: string): Promise<void> {
  const source = join(shared, "agents");
  const link = join(dir, "agents");
  if (!(await isDirectory(source)) || (await lstat(link).catch(() => null))) return;
  const [a, b] = await Promise.all([realpath(shared).catch(() => shared), realpath(dir).catch(() => dir)]);
  if (a === b) return;
  await symlink(source, link, process.platform === "win32" ? "junction" : "dir").catch((error) =>
    console.warn(`[host] could not share ${source} with ${link}:`, error),
  );
}

/**
 * Environment changes that run a provider CLI under a desktop account
 * profile; `null` for the default profile. Throws instead of silently falling
 * back to another account, whose history would not contain the conversation.
 */
export async function providerAccountEnvironment(
  account: { provider?: string; id?: string } | undefined,
  env: NodeJS.ProcessEnv = process.env,
  roots?: string[],
): Promise<ProviderAccountEnvironment | null> {
  const id = account?.id;
  if (!id || id === DEFAULT_ACCOUNT_ID) return null;
  const provider = account?.provider;
  if (provider !== "claude" && provider !== "codex")
    throw new Error("Provider account profiles are not supported for this provider");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid provider account id");
  const profile = PROFILES[provider];
  const dir = await providerAccountDir(provider, id, roots);
  if (!dir)
    throw new Error(
      `This conversation's ${profile.label} account is not available on the host computer. Add it in bycoda's Accounts settings there, or choose another account.`,
    );
  if (!id.startsWith(TERMINAL_PREFIX)) {
    const [variable, folder] = profile.shared;
    await linkSharedAgents(env[variable] || join(homedir(), folder), dir);
  }
  return {
    set: Object.fromEntries(profile.set.map((key) => [key, dir])),
    remove: [...profile.remove],
  };
}
