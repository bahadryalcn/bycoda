import type { AccountThreads } from "./messageThreads";
import type { MessagingAccount } from "./messagingTypes";
import type { ThreadPageState } from "./threadMessages";

/**
 * Renderer copies of messaging data: last-good thread lists per account and the newest page of
 * each thread. Every entry belongs to one account, so a removed, disconnected or re-identified
 * account is dropped in one step. A read captures its account's generation when it starts; a
 * reply that finds the generation moved on is discarded, so a late response cannot put the old
 * account's data back.
 */
const MAX_CACHED_THREADS = 50;

/** Last-good threads per account id. */
export const threadListCache = new Map<string, AccountThreads>();
/** Newest page per thread, keyed by `threadKey`; least recently used first. */
export const threadPageCache = new Map<string, ThreadPageState>();

const generations = new Map<string, number>();
/** Identity of each connected account the caches were last synced with. */
const identities = new Map<string, string>();
const listeners = new Set<(accountId: string) => void>();

function accountOfThread(key: string): string {
  return (JSON.parse(key) as [string, string])[0];
}

/** Changes whenever the account's id, provider, verified identity or stored credentials change. */
export function accountIdentity(account: MessagingAccount): string {
  return JSON.stringify([account.id, account.provider, account.identity, account.updatedAt]);
}

export function accountGeneration(accountId: string): number {
  return generations.get(accountId) ?? 0;
}

/** Whether the account is currently synced as connected; a dropped account is not. */
export function isAccountLive(accountId: string): boolean {
  return identities.has(accountId);
}

/** Views subscribe to drops so the data they hold leaves the screen with the cache. */
export function subscribeMessagingCaches(listener: (accountId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rememberThreadPage(key: string, page: ThreadPageState): void {
  threadPageCache.delete(key);
  threadPageCache.set(key, page);
  while (threadPageCache.size > MAX_CACHED_THREADS) {
    const oldest = threadPageCache.keys().next().value;
    if (oldest === undefined) break;
    threadPageCache.delete(oldest);
  }
}

/** Forgets everything cached for the account and fences its in-flight reads. */
export function dropMessagingAccount(accountId: string): void {
  generations.set(accountId, accountGeneration(accountId) + 1);
  identities.delete(accountId);
  threadListCache.delete(accountId);
  for (const key of [...threadPageCache.keys()]) {
    if (accountOfThread(key) === accountId) threadPageCache.delete(key);
  }
  for (const listener of [...listeners]) listener(accountId);
}

/** Forgets every account, used when a group lock engages. */
export function dropAllMessagingCaches(): void {
  const ids = new Set<string>([
    ...identities.keys(),
    ...threadListCache.keys(),
    ...[...threadPageCache.keys()].map(accountOfThread),
  ]);
  for (const id of ids) dropMessagingAccount(id);
}

/**
 * Keeps the caches only for connected accounts whose identity is unchanged. An account that is
 * no longer listed as connected, or whose identity changed, is dropped first.
 */
export function syncMessagingAccounts(accounts: readonly MessagingAccount[]): void {
  const live = new Map(
    accounts
      .filter((account) => account.connected)
      .map((account) => [account.id, accountIdentity(account)]),
  );
  const known = new Set<string>([
    ...identities.keys(),
    ...threadListCache.keys(),
    ...[...threadPageCache.keys()].map(accountOfThread),
  ]);
  for (const id of known) {
    if (live.get(id) !== identities.get(id)) dropMessagingAccount(id);
  }
  for (const [id, identity] of live) identities.set(id, identity);
}
