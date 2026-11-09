import type { MessageThread, MessagingAccount, MessagingProvider } from "./messagingTypes";

/** Thread ids are only unique within one account. */
export function threadKey(thread: Pick<MessageThread, "accountId" | "id">): string {
  return JSON.stringify([thread.accountId, thread.id]);
}

/** Last-good threads of one account plus the error of its newest load, if it failed. */
export type AccountThreads = { threads: MessageThread[]; error: string | null; loaded: boolean };

export type AccountThreadsResult =
  | { ok: true; threads: MessageThread[] }
  | { ok: false; error: string };

/** A failed refresh keeps the previously loaded threads and records the error beside them. */
export function applyAccountResult(
  previous: AccountThreads | undefined,
  result: AccountThreadsResult,
): AccountThreads {
  if (result.ok) return { threads: result.threads, error: null, loaded: true };
  return {
    threads: previous?.threads ?? [],
    error: result.error,
    loaded: previous?.loaded ?? false,
  };
}

/** Threads of the given accounts, newest first; a stable key order breaks ties. */
export function mergeThreads(
  accounts: readonly MessagingAccount[],
  byAccount: Readonly<Record<string, AccountThreads | undefined>>,
): MessageThread[] {
  const seen = new Set<string>();
  const merged: MessageThread[] = [];
  for (const account of accounts)
    for (const thread of byAccount[account.id]?.threads ?? []) {
      // Native rows carry their account; trust the account we asked instead.
      const owned = thread.accountId === account.id ? thread : { ...thread, accountId: account.id };
      const key = threadKey(owned);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(owned);
    }
  return merged.sort((a, b) => {
    const delta = (b.updatedAt || 0) - (a.updatedAt || 0);
    if (delta !== 0) return delta;
    const ka = threadKey(a);
    const kb = threadKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export type AccountFailure = { account: MessagingAccount; error: string };

export function accountFailures(
  accounts: readonly MessagingAccount[],
  byAccount: Readonly<Record<string, AccountThreads | undefined>>,
): AccountFailure[] {
  const failures: AccountFailure[] = [];
  for (const account of accounts) {
    const error = byAccount[account.id]?.error;
    if (error) failures.push({ account, error });
  }
  return failures;
}

export type MessageFilters = {
  hiddenAccountIds: string[];
  hiddenProviders: MessagingProvider[];
};

export const DEFAULT_MESSAGE_FILTERS: MessageFilters = {
  hiddenAccountIds: [],
  hiddenProviders: [],
};

/** Drops hidden ids of accounts and providers that no longer exist. */
export function pruneMessageFilters(
  filters: MessageFilters,
  accounts: readonly MessagingAccount[],
): MessageFilters {
  const ids = new Set(accounts.map((account) => account.id));
  const providers = new Set(accounts.map((account) => account.provider));
  return {
    hiddenAccountIds: filters.hiddenAccountIds.filter((id) => ids.has(id)),
    hiddenProviders: filters.hiddenProviders.filter((provider) => providers.has(provider)),
  };
}

/** One count per narrowed dimension, as the shared filter trigger shows it. */
export function messageFilterCount(filters: MessageFilters): number {
  return (
    (filters.hiddenAccountIds.length > 0 ? 1 : 0) + (filters.hiddenProviders.length > 0 ? 1 : 0)
  );
}

export function toggleListValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

/** Applies the account/provider filters and a case-insensitive search over title, preview and participants. */
export function filterThreads(
  threads: readonly MessageThread[],
  filters: MessageFilters,
  search: string,
): MessageThread[] {
  const hiddenAccounts = new Set(filters.hiddenAccountIds);
  const hiddenProviders = new Set(filters.hiddenProviders);
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return threads.filter((thread) => {
    if (hiddenAccounts.has(thread.accountId) || hiddenProviders.has(thread.provider)) return false;
    if (terms.length === 0) return true;
    const haystack = [thread.title, thread.preview, ...thread.participants]
      .join("\n")
      .toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Moves a thread forward after a reply so the list reflects the sent message right away. */
export function patchAccountThread(
  state: AccountThreads | undefined,
  threadId: string,
  patch: Partial<Pick<MessageThread, "preview" | "updatedAt" | "unread">>,
): AccountThreads | undefined {
  if (!state) return state;
  return {
    ...state,
    threads: state.threads.map((thread) =>
      thread.id === threadId ? { ...thread, ...patch } : thread,
    ),
  };
}

// Local read marks for this app run; the server's read state is never changed.
const seenAt = new Map<string, number>();

export function markThreadSeen(thread: MessageThread): void {
  seenAt.set(threadKey(thread), thread.updatedAt);
}

export function threadUnread(thread: MessageThread): boolean {
  if (!thread.unread) return false;
  const seen = seenAt.get(threadKey(thread));
  return seen == null || seen < thread.updatedAt;
}

export function resetThreadSeenForTests(): void {
  seenAt.clear();
}

export const MESSAGING_PROVIDER_LABELS: Record<MessagingProvider, string> = {
  email: "Email",
  slack: "Slack",
  discord: "Discord",
  teams: "Microsoft Teams",
};
