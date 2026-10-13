import type { HarnessId } from "../../sessions/model/session";

const LEGACY_ACCOUNTS_KEY = "bycoda.providerAccounts.v1";
const ACCOUNTS_KEY = "bycoda.providerAccounts.v2";
const CHANGE_EVENT = "bycoda-provider-accounts-changed";

export const DEFAULT_PROVIDER_ACCOUNT_ID = "default";
const DEFAULT_PROVIDER_ACCOUNT_LABEL = "Default account";

/** Legacy sessions predate persisted account ids and belong to the default profile. */
export function sameProviderAccountId(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return (left ?? DEFAULT_PROVIDER_ACCOUNT_ID) === (right ?? DEFAULT_PROVIDER_ACCOUNT_ID);
}

/** Providers whose CLIs support isolated, locally named account profiles. */
export const PROVIDER_ACCOUNT_PROVIDERS = [
  "claude",
  "codex",
] as const satisfies readonly HarnessId[];

export type ProviderAccountProvider = (typeof PROVIDER_ACCOUNT_PROVIDERS)[number];

export function supportsProviderAccounts(provider: HarnessId): provider is ProviderAccountProvider {
  return PROVIDER_ACCOUNT_PROVIDERS.some((candidate) => candidate === provider);
}

/**
 * Fixed palette for telling accounts apart. Values match the tab-group palette
 * so they read on both light and dark themes.
 */
export const PROVIDER_ACCOUNT_COLORS = [
  { id: "blue", label: "Blue", value: "hsl(211 92% 62%)" },
  { id: "coral", label: "Coral", value: "hsl(12 80% 58%)" },
  { id: "amber", label: "Amber", value: "hsl(45 90% 55%)" },
  { id: "green", label: "Green", value: "hsl(142 55% 50%)" },
  { id: "pink", label: "Pink", value: "hsl(330 70% 62%)" },
  { id: "purple", label: "Purple", value: "hsl(280 55% 62%)" },
  { id: "teal", label: "Teal", value: "hsl(175 55% 48%)" },
  { id: "slate", label: "Slate", value: "hsl(210 8% 58%)" },
  { id: "orange", label: "Orange", value: "hsl(25 95% 60%)" },
] as const;

// Keep automatic colors stable for existing accounts when adding new swatches.
const AUTOMATIC_ACCOUNT_COLORS = PROVIDER_ACCOUNT_COLORS.filter((color) => color.id !== "orange");

export type ProviderAccountColor = (typeof PROVIDER_ACCOUNT_COLORS)[number]["id"];

export type ProviderAccount = {
  id: string;
  provider: ProviderAccountProvider;
  label: string;
  isDefault?: boolean;
  /** Palette token; unset accounts get a stable colour derived from the id. */
  color?: ProviderAccountColor;
};

function validAccountColor(value: unknown): value is ProviderAccountColor {
  return PROVIDER_ACCOUNT_COLORS.some((color) => color.id === value);
}

/** Palette entry for an account: its own pick, else stable by provider and id. */
export function providerAccountColor(
  account: Pick<ProviderAccount, "id" | "provider" | "color">,
): (typeof PROVIDER_ACCOUNT_COLORS)[number] {
  const picked = PROVIDER_ACCOUNT_COLORS.find((color) => color.id === account.color);
  if (picked) return picked;
  const key = `${account.provider}:${account.id}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AUTOMATIC_ACCOUNT_COLORS[hash % AUTOMATIC_ACCOUNT_COLORS.length];
}

/** CSS colour for an account's dot. */
export function providerAccountColorValue(
  account: Pick<ProviderAccount, "id" | "provider" | "color">,
): string {
  return providerAccountColor(account).value;
}

type StoredAccounts = Partial<Record<ProviderAccountProvider, ProviderAccount[]>>;

export function providerAccounts(provider: ProviderAccountProvider): ProviderAccount[] {
  const managed = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  const stored = readRecord<StoredAccounts>(LEGACY_ACCOUNTS_KEY);
  const authoritative = Array.isArray(managed[provider]);
  const seen = new Set<string>();
  if (authoritative) stored[provider] = managed[provider];
  const accounts = Array.isArray(stored[provider]) ? stored[provider] : [];
  let defaultLabel = DEFAULT_PROVIDER_ACCOUNT_LABEL;
  let foundDefault = false;
  const profiles = accounts.flatMap((account) => {
    const id = validAccountId(account?.id) ? account.id : "";
    const label = cleanLabel(account?.label);
    if (!authoritative && id === DEFAULT_PROVIDER_ACCOUNT_ID) {
      if (label && !foundDefault) {
        defaultLabel = label;
        foundDefault = true;
      }
      return [];
    }
    if (!id || !label || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [
      {
        id,
        provider,
        label,
        ...(authoritative && account.isDefault ? { isDefault: true } : {}),
        ...(authoritative && validAccountColor(account.color) ? { color: account.color } : {}),
      },
    ];
  });
  if (authoritative) {
    const defaultId = profiles.find((account) => account.isDefault)?.id ?? profiles[0]?.id;
    return profiles.map(({ isDefault: _default, ...account }) =>
      account.id === defaultId ? { ...account, isDefault: true } : account,
    );
  }
  return [
    {
      id: DEFAULT_PROVIDER_ACCOUNT_ID,
      provider,
      label: defaultLabel,
      isDefault: true,
    },
    ...profiles,
  ];
}

export function newProviderAccount(
  provider: ProviderAccountProvider,
  label: string,
): ProviderAccount {
  return {
    id: `account-${crypto.randomUUID()}`,
    provider,
    label: cleanLabel(label) || `Account ${providerAccounts(provider).length + 1}`,
  };
}

export function saveProviderAccount(account: ProviderAccount): void {
  if (account.id === DEFAULT_PROVIDER_ACCOUNT_ID || !validAccountId(account.id)) {
    return;
  }
  const label = cleanLabel(account.label);
  if (!label) return;
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  const accounts = providerAccounts(account.provider);
  const color = account.color ?? accounts.find((entry) => entry.id === account.id)?.color;
  const next = accounts.filter((entry) => entry.id !== account.id);
  stored[account.provider] = serializeProviderAccounts([
    ...next,
    {
      id: account.id,
      provider: account.provider,
      label,
      ...(color ? { color } : {}),
      ...(next.length === 0 || accounts.find((entry) => entry.id === account.id)?.isDefault
        ? { isDefault: true }
        : {}),
    },
  ]);
  writeJson(ACCOUNTS_KEY, stored);
  announceChange();
}

/** Add a reference to an existing CLI profile without signing in or moving sessions. */
export function saveTerminalProviderAccount(account: ProviderAccount): void {
  if (!validAccountId(account.id) || !cleanLabel(account.label))
    throw new Error("Invalid terminal account");
  const accounts = providerAccounts(account.provider);
  if (accounts.some((entry) => entry.id === account.id)) return;
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  stored[account.provider] = serializeProviderAccounts([
    ...accounts,
    { ...account, isDefault: accounts.length === 0 },
  ]);
  writeJson(ACCOUNTS_KEY, stored);
  announceChange();
}

export function isTerminalProviderAccount(accountId: string): boolean {
  return accountId === DEFAULT_PROVIDER_ACCOUNT_ID || accountId.startsWith("terminal-");
}

export function renameProviderAccount(
  provider: ProviderAccountProvider,
  accountId: string,
  label: string,
): ProviderAccount | null {
  if (!validAccountId(accountId)) return null;
  const nextLabel = cleanLabel(label);
  if (!nextLabel) return null;
  const accounts = providerAccounts(provider);
  const target = accounts.find((account) => account.id === accountId);
  if (!target) return null;
  const renamed = { ...target, label: nextLabel };
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  stored[provider] = serializeProviderAccounts(
    accounts.map((account) => (account.id === accountId ? renamed : account)),
  );
  writeJson(ACCOUNTS_KEY, stored);
  announceChange();
  return renamed;
}

/** Remove account metadata after native credential cleanup has succeeded. */
export function removeProviderAccount(
  provider: ProviderAccountProvider,
  accountId: string,
): boolean {
  if (!validAccountId(accountId)) {
    return false;
  }
  const accounts = providerAccounts(provider);
  if (!accounts.some((account) => account.id === accountId)) return false;
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  stored[provider] = serializeProviderAccounts(
    accounts.filter((account) => account.id !== accountId),
  );
  writeJson(ACCOUNTS_KEY, stored);
  announceChange();
  return true;
}

function serializeProviderAccounts(accounts: ProviderAccount[]): ProviderAccount[] {
  return accounts.flatMap((account) => {
    const label = cleanLabel(account.label);
    if (!label) return [];
    return [
      {
        id: account.id,
        provider: account.provider,
        label,
        ...(account.isDefault ? { isDefault: true } : {}),
        ...(validAccountColor(account.color) ? { color: account.color } : {}),
      },
    ];
  });
}

/**
 * Pick (or clear, with undefined) an account's colour. Works for the implicit
 * default too: like any other edit, it materializes the list into the
 * authoritative store with the default entry kept as-is.
 */
export function setProviderAccountColor(
  provider: ProviderAccountProvider,
  accountId: string,
  color: ProviderAccountColor | undefined,
): boolean {
  if (color !== undefined && !validAccountColor(color)) return false;
  const accounts = providerAccounts(provider);
  if (!accounts.some((account) => account.id === accountId)) return false;
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  stored[provider] = serializeProviderAccounts(
    accounts.map((account) => {
      if (account.id !== accountId) return account;
      const { color: _previous, ...rest } = account;
      return color ? { ...rest, color } : rest;
    }),
  );
  writeJson(ACCOUNTS_KEY, stored);
  announceChange();
  return true;
}

/** Change the fallback for new sessions without moving credentials or existing sessions. */
export function setDefaultProviderAccount(
  provider: ProviderAccountProvider,
  accountId: string,
): void {
  const accounts = providerAccounts(provider);
  if (!accounts.some((account) => account.id === accountId))
    throw new Error("Account no longer exists");
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  stored[provider] = serializeProviderAccounts(
    accounts.map(({ isDefault: _default, ...account }) =>
      account.id === accountId ? { ...account, isDefault: true } : account,
    ),
  );
  writeJson(ACCOUNTS_KEY, stored);
  announceChange();
}

export function providerAccountExists(
  provider: ProviderAccountProvider,
  accountId: string | undefined,
): boolean {
  return providerAccounts(provider).some(
    (account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID),
  );
}

/**
 * Account a session without an explicit choice runs under. Choices live on the
 * session itself, so changing the default never moves an existing conversation.
 */
export function defaultProviderAccountId(provider: ProviderAccountProvider): string {
  return (
    providerAccounts(provider).find((account) => account.isDefault)?.id ??
    DEFAULT_PROVIDER_ACCOUNT_ID
  );
}

/**
 * Account a session runs under: its own pin, else the provider default. A
 * session that already has a provider thread but no pin predates account ids
 * and belongs to the legacy default profile.
 */
export function sessionProviderAccountId(
  provider: ProviderAccountProvider,
  session: { providerAccountId?: string; providerSessionId?: string },
): string {
  return (
    session.providerAccountId ??
    (session.providerSessionId ? DEFAULT_PROVIDER_ACCOUNT_ID : defaultProviderAccountId(provider))
  );
}

export function providerAccountLabel(
  provider: ProviderAccountProvider,
  accountId: string | undefined,
): string {
  return (
    providerAccounts(provider).find(
      (account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID),
    )?.label ??
    (accountId && accountId !== DEFAULT_PROVIDER_ACCOUNT_ID ? "Removed account" : "Default account")
  );
}

export function subscribeProviderAccounts(listener: () => void): () => void {
  const local = () => listener();
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === ACCOUNTS_KEY || event.key === LEGACY_ACCOUNTS_KEY)
      listener();
  };
  window.addEventListener(CHANGE_EVENT, local);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    window.removeEventListener("storage", storage);
  };
}

function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 48) : "";
}

function validAccountId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 80 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function readRecord<T>(key: string): T {
  const value = readJson<unknown>(key, {});
  return isRecord(value) ? (value as T) : ({} as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Saving provider accounts failed", error);
    // The settings owner shows this failure; never announce an unsaved change.
    throw error;
  }
}

function announceChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
