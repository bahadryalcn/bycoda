import { readFile, readdir, realpath, stat, symlink, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { desktopDatabasePaths } from "../desktop/desktopSessions";
import { providerAccountColorValue } from "../../src/features/providers/model/providerAccounts";

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
export type HostProviderAccountCatalog = Partial<
  Record<
    "codex" | "claude",
    {
      id: string;
      label: string;
      color: string;
      kind?: "personal" | "work";
      derivedKind?: "personal" | "work";
    }[]
  >
>;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_CATALOG_ACCOUNTS = 128;

/** Same stable automatic colour the desktop shows for an account the owner has not recoloured. */
function accountColor(provider: "codex" | "claude", id: string): string {
  return providerAccountColorValue({ provider, id });
}

/** Safe Host-machine inventory only. No credential contents, auth output, email,
 * external profile path or renderer-side account metadata is read or returned. */
export async function hostProviderAccounts(
  roots: string[] = desktopDatabasePaths().map(dirname),
): Promise<HostProviderAccountCatalog> {
  const catalog: HostProviderAccountCatalog = {};
  for (const provider of ["codex", "claude"] as const) {
    const ids = new Set<string>();
    for (const root of [...new Set(roots)].slice(0, 16)) {
      const entries = await readdir(join(root, "provider-accounts", provider), {
        withFileTypes: true,
      }).catch(() => []);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (ids.size >= MAX_CATALOG_ACCOUNTS) break;
        if (
          entry.name !== DEFAULT_ACCOUNT_ID &&
          !entry.name.startsWith(TERMINAL_PREFIX) &&
          ACCOUNT_ID.test(entry.name) &&
          (await isDirectory(join(root, "provider-accounts", provider, entry.name)))
        )
          ids.add(entry.name);
      }
      const registry = join(root, "terminal-profiles.json");
      const registrySize = (await stat(registry).catch(() => null))?.size;
      if (registrySize !== undefined && registrySize <= 256 * 1024) {
        const raw = await readFile(registry, "utf8").catch(() => null);
        try {
          const value: unknown = raw ? JSON.parse(raw) : null;
          if (value && typeof value === "object" && !Array.isArray(value)) {
            for (const key of Object.keys(value).sort()) {
              if (ids.size >= MAX_CATALOG_ACCOUNTS) break;
              const id = key.startsWith(`${provider}:`) ? key.slice(provider.length + 1) : "";
              const path = (value as Record<string, unknown>)[key];
              if (
                id.startsWith(TERMINAL_PREFIX) &&
                ACCOUNT_ID.test(id) &&
                typeof path === "string" &&
                (await isDirectory(path))
              )
                ids.add(id);
            }
          }
        } catch {
          /* Malformed registry grants no account selection. */
        }
      }
    }
    catalog[provider] = [
      {
        id: DEFAULT_ACCOUNT_ID,
        label: "Host default",
        color: accountColor(provider, DEFAULT_ACCOUNT_ID),
      },
      ...[...ids].sort().map((id, index) => ({
        id,
        label: `${PROFILES[provider].label} account ${index + 1}`,
        color: accountColor(provider, id),
      })),
    ];
  }
  return catalog;
}

/** Read-only validation before a configure transaction mutates its session. */
export async function assertHostProviderAccount(
  provider: string,
  id: string,
  roots?: string[],
): Promise<string | undefined> {
  if ((provider !== "codex" && provider !== "claude") || !ACCOUNT_ID.test(id))
    throw new Error("Invalid provider account ID");
  if (id === DEFAULT_ACCOUNT_ID) return undefined;
  // Use the exact same resolution as actual provider CLI launch, without the
  // environment preparation's agent-link writes or any credential inspection.
  // Catalog truncation does not make an already known real profile invalid.
  if (!(await providerAccountDir(provider, id, roots)))
    throw new Error("Provider account is not available on this Host");
  return id;
}

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
  const [a, b] = await Promise.all([
    realpath(shared).catch(() => shared),
    realpath(dir).catch(() => dir),
  ]);
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
