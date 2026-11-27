import { readFile, readdir, realpath, stat, symlink, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { desktopDatabasePathsFresh } from "../desktop/desktopSessions";
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
  grok: {
    label: "Grok Build",
    shared: ["GROK_HOME", ".grok"],
    set: ["GROK_HOME"],
    remove: ["XAI_API_KEY", "GROK_DEPLOYMENT_KEY"],
  },
} as const;

type ProfileProvider = keyof typeof PROFILES;
const PROFILE_PROVIDERS = Object.keys(PROFILES) as ProfileProvider[];

export function isProfileProvider(provider: unknown): provider is ProfileProvider {
  return typeof provider === "string" && Object.hasOwn(PROFILES, provider);
}

export type ProviderAccountEnvironment = {
  set: Record<string, string>;
  remove: string[];
};
export type HostProviderAccountCatalog = Partial<
  Record<
    ProfileProvider,
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
function accountColor(provider: ProfileProvider, id: string): string {
  return providerAccountColorValue({ provider, id });
}

/** Safe Host-machine inventory only. An account is listed only with signed-in
 * evidence, checked as a boolean. No credential contents, auth output, email,
 * external profile path or renderer-side account metadata is returned or logged. */
export async function hostProviderAccounts(
  givenRoots?: string[],
): Promise<HostProviderAccountCatalog> {
  const roots = givenRoots ?? (await desktopDatabasePathsFresh()).map(dirname);
  const catalog: HostProviderAccountCatalog = {};
  for (const provider of PROFILE_PROVIDERS) {
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
          (await hasSignedInEvidence(
            provider,
            join(root, "provider-accounts", provider, entry.name),
          ))
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
                (await hasSignedInEvidence(provider, path))
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
  if (!isProfileProvider(provider) || !ACCOUNT_ID.test(id))
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

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

/** Claude keeps its macOS credential in Keychain, so its `.claude.json` identity is the evidence there. */
const MAX_CLAUDE_CONFIG_BYTES = 1024 * 1024;

/** Whether a profile directory holds a sign-in. Returns a boolean only; contents are never returned. */
async function hasSignedInEvidence(provider: ProfileProvider, dir: string): Promise<boolean> {
  if (!(await isDirectory(dir))) return false;
  if (provider === "claude") {
    if (await isFile(join(dir, ".credentials.json"))) return true;
    const config = join(dir, ".claude.json");
    const size = (await stat(config).catch(() => null))?.size;
    if (size === undefined || size > MAX_CLAUDE_CONFIG_BYTES) return false;
    const raw = await readFile(config, "utf8").catch(() => null);
    if (!raw) return false;
    try {
      const value: unknown = JSON.parse(raw);
      const account =
        value && typeof value === "object"
          ? (value as Record<string, unknown>).oauthAccount
          : undefined;
      if (!account || typeof account !== "object") return false;
      const email = (account as Record<string, unknown>).emailAddress;
      return typeof email === "string" && email.trim() !== "";
    } catch {
      return false;
    }
  }
  return isFile(join(dir, "auth.json"));
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
  givenRoots?: string[],
): Promise<string | null> {
  const roots = givenRoots ?? (await desktopDatabasePathsFresh()).map(dirname);
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
  if (!isProfileProvider(provider))
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
