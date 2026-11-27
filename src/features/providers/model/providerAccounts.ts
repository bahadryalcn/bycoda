// The React-free core keeps this model usable from the headless Host bundle.
import { t } from "../../../shared/i18n/core";
import { createWindowStore } from "../../../shared/lib/store";
import { themePalette } from "../../../shared/theme/palette";
import type { HarnessId } from "../../sessions/model/session";
import { PROVIDER_ACCOUNT_PROVIDERS } from "./providerAccountId";

const LEGACY_ACCOUNTS_KEY = "bycoda.providerAccounts.v1";
const ACCOUNTS_KEY = "bycoda.providerAccounts.v2";
const SHARED_CLI_ACCOUNTS_KEY = "bycoda.sharedCliAccounts.v1";
const CHANGE_EVENT = "bycoda-provider-accounts-changed";
const ACCOUNT_STORAGE_KEYS = [ACCOUNTS_KEY, LEGACY_ACCOUNTS_KEY, SHARED_CLI_ACCOUNTS_KEY] as const;
const accountStore = createWindowStore({
  event: CHANGE_EVENT,
  storageKeys: ACCOUNT_STORAGE_KEYS,
});

export const DEFAULT_PROVIDER_ACCOUNT_ID = "default";
const DEFAULT_PROVIDER_ACCOUNT_LABEL = "Default account";

/** Legacy sessions predate persisted account ids and belong to the default profile. */
export function sameProviderAccountId(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return (left ?? DEFAULT_PROVIDER_ACCOUNT_ID) === (right ?? DEFAULT_PROVIDER_ACCOUNT_ID);
}

export { PROVIDER_ACCOUNT_PROVIDERS };

export type ProviderAccountProvider = (typeof PROVIDER_ACCOUNT_PROVIDERS)[number];

export function supportsProviderAccounts(provider: HarnessId): provider is ProviderAccountProvider {
  return PROVIDER_ACCOUNT_PROVIDERS.some((candidate) => candidate === provider);
}

/**
 * Providers whose CLI keeps one sign-in per machine. They get the same named
 * account card, but no profiles: the account is never selectable per session.
 */
export const SHARED_CLI_ACCOUNT_PROVIDERS = [
  "opencode",
  "antigravity",
] as const satisfies readonly HarnessId[];

export type SharedCliAccountProvider = (typeof SHARED_CLI_ACCOUNT_PROVIDERS)[number];

export function isSharedCliAccountProvider(
  provider: HarnessId,
): provider is SharedCliAccountProvider {
  return SHARED_CLI_ACCOUNT_PROVIDERS.some((candidate) => candidate === provider);
}

export type SharedCliAccount = {
  id: typeof DEFAULT_PROVIDER_ACCOUNT_ID;
  provider: SharedCliAccountProvider;
  /** Owner label; empty until named, so callers show the provider's name. */
  label: string;
  kind?: "personal" | "work";
  color?: ProviderAccountColor;
};

/**
 * Fixed palette for telling accounts apart. Values match the tab-group palette
 * so they read on both light and dark themes.
 */
export const PROVIDER_ACCOUNT_COLORS = [
  { id: "blue", label: "Blue", value: themePalette.hsl_211_92pct_62pct },
  { id: "coral", label: "Coral", value: themePalette.hsl_12_80pct_58pct },
  { id: "amber", label: "Amber", value: themePalette.hsl_45_90pct_55pct },
  { id: "green", label: "Green", value: themePalette.hsl_142_55pct_50pct },
  { id: "pink", label: "Pink", value: themePalette.hsl_330_70pct_62pct },
  { id: "purple", label: "Purple", value: themePalette.hsl_280_55pct_62pct },
  { id: "teal", label: "Teal", value: themePalette.hsl_175_55pct_48pct },
  { id: "slate", label: "Slate", value: themePalette.hsl_210_8pct_58pct },
  { id: "orange", label: "Orange", value: themePalette.hsl_25_95pct_60pct },
] as const;

// Keep automatic colors stable for existing accounts when adding new swatches.
const AUTOMATIC_ACCOUNT_COLORS = PROVIDER_ACCOUNT_COLORS.filter((color) => color.id !== "orange");

export type ProviderAccountColor = (typeof PROVIDER_ACCOUNT_COLORS)[number]["id"];

export type ProviderAccount = {
  id: string;
  provider: ProviderAccountProvider;
  label: string;
  isDefault?: boolean;
  /** Explicit type. Legacy data without a type resolves to Personal. */
  kind?: "personal" | "work";
  /** Palette token; unset accounts get a stable colour derived from the id. */
  color?: ProviderAccountColor;
};

/** Local name, colour and kind of a shared CLI sign-in. */
export function sharedCliAccount(provider: SharedCliAccountProvider): SharedCliAccount {
  const stored = readRecord<Record<string, unknown>>(SHARED_CLI_ACCOUNTS_KEY)[provider];
  const entry = isRecord(stored) ? stored : {};
  return {
    id: DEFAULT_PROVIDER_ACCOUNT_ID,
    provider,
    label: cleanLabel(entry.label),
    kind: entry.kind === "work" ? "work" : "personal",
    ...(validAccountColor(entry.color) ? { color: entry.color } : {}),
  };
}

export function saveSharedCliAccount(
  account: Pick<SharedCliAccount, "provider"> &
    Partial<Pick<SharedCliAccount, "label" | "kind" | "color">>,
): void {
  const stored = readRecord<Record<string, unknown>>(SHARED_CLI_ACCOUNTS_KEY);
  const previous = sharedCliAccount(account.provider);
  const label = "label" in account ? cleanLabel(account.label) : previous.label;
  const kind = account.kind ?? previous.kind;
  const color = "color" in account ? account.color : previous.color;
  stored[account.provider] = {
    ...(label ? { label } : {}),
    kind: kind ?? "personal",
    ...(color ? { color } : {}),
  };
  writeJson(SHARED_CLI_ACCOUNTS_KEY, stored);
  announceChange();
}

function validAccountColor(value: unknown): value is ProviderAccountColor {
  return PROVIDER_ACCOUNT_COLORS.some((color) => color.id === value);
}

/** Palette entry for an account: its own pick, else stable by provider and id. */
export function providerAccountColor(
  account: Pick<ProviderAccount, "id" | "color"> & { provider: HarnessId },
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
  account: Pick<ProviderAccount, "id" | "color"> & { provider: HarnessId },
): string {
  return providerAccountColor(account).value;
}

type StoredAccounts = Partial<Record<ProviderAccountProvider, ProviderAccount[]>>;

/**
 * Raw stored account records. Equal values mean `providerAccounts` would return the same
 * content, so readers can skip parsing while nothing was written. Reading is not parsing.
 */
export function providerAccountsStorageVersion(): readonly (string | null)[] {
  try {
    return ACCOUNT_STORAGE_KEYS.map((key) => localStorage.getItem(key));
  } catch {
    return [];
  }
}

/**
 * Primitive snapshot for `useSyncExternalStore`: changes exactly when a stored account record
 * does, and costs string reads only, never a parse or a serialisation of every account.
 */
export function providerAccountsStorageRevision(): string {
  return providerAccountsStorageVersion()
    .map((value) => value ?? "\u0000")
    .join("\u0001");
}

export function providerAccounts(provider: ProviderAccountProvider): ProviderAccount[] {
  const managed = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  const stored = readRecord<StoredAccounts>(LEGACY_ACCOUNTS_KEY);
  const authoritative = Array.isArray(managed[provider]);
  const seen = new Set<string>();
  if (authoritative) stored[provider] = managed[provider];
  const accounts = Array.isArray(stored[provider]) ? stored[provider] : [];
  let defaultLabel = DEFAULT_PROVIDER_ACCOUNT_LABEL;
  let defaultKind: ProviderAccount["kind"];
  let foundDefault = false;
  const profiles = accounts.flatMap((account) => {
    const id = validAccountId(account?.id) ? account.id : "";
    const label = cleanLabel(account?.label);
    if (!authoritative && id === DEFAULT_PROVIDER_ACCOUNT_ID) {
      if (label && !foundDefault) {
        defaultLabel = label;
        if (account.kind === "personal" || account.kind === "work") defaultKind = account.kind;
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
        ...(account.kind === "personal" || account.kind === "work" ? { kind: account.kind } : {}),
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
      ...(defaultKind ? { kind: defaultKind } : {}),
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
  const previous = accounts.find((entry) => entry.id === account.id);
  const color = account.color ?? previous?.color;
  const kind = account.kind ?? previous?.kind;
  const next = accounts.filter((entry) => entry.id !== account.id);
  stored[account.provider] = serializeProviderAccounts([
    ...next,
    {
      id: account.id,
      provider: account.provider,
      label,
      ...(color ? { color } : {}),
      ...(kind ? { kind } : {}),
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

/** Edit display metadata atomically; credential identity and session pins stay untouched. */
export function editProviderAccount(
  provider: ProviderAccountProvider,
  accountId: string,
  metadata: { label: string; color?: ProviderAccountColor; kind?: "personal" | "work" },
): boolean {
  const label = cleanLabel(metadata.label);
  if (!label || (metadata.color !== undefined && !validAccountColor(metadata.color))) return false;
  if (metadata.kind !== undefined && metadata.kind !== "personal" && metadata.kind !== "work")
    return false;
  const accounts = providerAccounts(provider);
  if (!accounts.some((account) => account.id === accountId)) return false;
  const stored = readRecord<StoredAccounts>(ACCOUNTS_KEY);
  stored[provider] = serializeProviderAccounts(
    accounts.map((account) =>
      account.id === accountId
        ? { ...account, label, color: metadata.color, kind: metadata.kind ?? account.kind }
        : account,
    ),
  );
  writeJson(ACCOUNTS_KEY, stored);
  announceChange();
  return true;
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
        ...(account.kind === "personal" || account.kind === "work" ? { kind: account.kind } : {}),
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
  return providerAccountExistsIn(providerAccounts(provider), accountId);
}

/** `providerAccountExists` over an account list the caller already holds (see `useProviderAccounts`). */
export function providerAccountExistsIn(
  accounts: readonly ProviderAccount[],
  accountId: string | undefined,
): boolean {
  return accounts.some((account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID));
}

/**
 * Account a session without an explicit choice runs under. Choices live on the
 * session itself, so changing the default never moves an existing conversation.
 */
export function defaultProviderAccountId(provider: ProviderAccountProvider): string {
  return defaultProviderAccountIdIn(providerAccounts(provider));
}

/** `defaultProviderAccountId` over an account list the caller already holds. */
export function defaultProviderAccountIdIn(
  accounts: readonly Pick<ProviderAccount, "id" | "isDefault">[],
): string {
  return accounts.find((account) => account.isDefault)?.id ?? DEFAULT_PROVIDER_ACCOUNT_ID;
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
  return sessionProviderAccountIdIn(providerAccounts(provider), session);
}

/** `sessionProviderAccountId` over an account list the caller already holds. */
export function sessionProviderAccountIdIn(
  accounts: readonly ProviderAccount[],
  session: { providerAccountId?: string; providerSessionId?: string },
): string {
  return (
    session.providerAccountId ??
    (session.providerSessionId ? DEFAULT_PROVIDER_ACCOUNT_ID : defaultProviderAccountIdIn(accounts))
  );
}

export function providerAccountLabel(
  provider: ProviderAccountProvider,
  accountId: string | undefined,
): string {
  return providerAccountLabelIn(providerAccounts(provider), accountId, t);
}

/** `providerAccountLabel` over an account list and translator the caller already holds. */
export function providerAccountLabelIn(
  accounts: readonly ProviderAccount[],
  accountId: string | undefined,
  translate: (message: string, values?: Record<string, unknown>) => string,
): string {
  return (
    accounts.find((account) => account.id === (accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID))?.label ??
    (accountId && accountId !== DEFAULT_PROVIDER_ACCOUNT_ID
      ? translate("Removed account")
      : translate("Default account"))
  );
}

const GENERATED_ACCOUNT_LABEL = /^account-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * The one name every surface shows for an account. A stored label that is empty or only the
 * generated account id is not a name: it falls back to the sign-in email, else "Account N"
 * (N is the account's place among its provider's accounts). Stored data is never rewritten.
 */
export function accountDisplayLabel(
  account: Pick<ProviderAccount, "id" | "provider" | "label">,
  accounts: readonly Pick<ProviderAccount, "id" | "provider">[] = [],
  email?: string | null,
): string {
  const label = cleanLabel(account.label);
  if (label === DEFAULT_PROVIDER_ACCOUNT_LABEL) return t("Default account");
  if (label && label !== account.id && !GENERATED_ACCOUNT_LABEL.test(label)) return label;
  const address = email?.trim();
  if (address) return address;
  const peers = accounts.filter((entry) => entry.provider === account.provider);
  const index = peers.findIndex((entry) => entry.id === account.id);
  return t("Account {p0}", { p0: (index < 0 ? peers.length : index) + 1 });
}

export function subscribeProviderAccounts(listener: () => void): () => void {
  return accountStore.subscribe(() => listener());
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
