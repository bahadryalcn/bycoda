import { useSyncExternalStore } from "react";
import { replaceEqualDeep } from "@tanstack/react-query";
import { recordRateLimitHistory } from "./rateLimitHistory";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "./rateLimits";
import {
  fetchClaudeRateLimits,
  fetchCodexRateLimits,
  fetchOpencodeGoRateLimits,
} from "./rateLimitsFetch";

const snapshots = new Map<string, ProviderRateLimits>();
const pending = new Map<string, Promise<ProviderRateLimits>>();
const queuedRefreshes = new Map<string, Promise<ProviderRateLimits>>();
const generations = new Map<string, symbol>();
const listeners = new Set<() => void>();
let allSnapshots: Record<string, ProviderRateLimits> = {};

function keyFor(provider: RateLimitProvider, accountId: string): string {
  return `${provider}:${accountId}`;
}

function publish(key: string, value: ProviderRateLimits): ProviderRateLimits {
  recordRateLimitHistory(key, value);
  const previous = snapshots.get(key);
  value = replaceEqualDeep(previous, value);
  if (previous === value) return value;
  snapshots.set(key, value);
  allSnapshots = { ...allSnapshots, [key]: value };
  for (const listener of listeners) listener();
  return value;
}

export function subscribeRateLimits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAllRateLimits(): Record<string, ProviderRateLimits> {
  return allSnapshots;
}

export function getCachedRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
): ProviderRateLimits {
  return snapshots.get(keyFor(provider, accountId)) ?? idle[provider];
}

const idle: Record<RateLimitProvider, ProviderRateLimits> = {
  claude: idleRateLimits("claude"),
  codex: idleRateLimits("codex"),
  opencode: idleRateLimits("opencode"),
};

export function useCachedRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
): ProviderRateLimits {
  return useSyncExternalStore(
    subscribeRateLimits,
    () => getCachedRateLimits(provider, accountId),
    () => getCachedRateLimits(provider, accountId),
  );
}

export function setCachedRateLimits(
  provider: RateLimitProvider,
  accountId: string,
  value: ProviderRateLimits,
): void {
  publish(keyFor(provider, accountId), value);
}

/** Fetch an account once per window lifetime, or again on explicit refresh. */
export function loadRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
  force = false,
  canRetry: () => boolean = () => true,
  background = false,
  oneShot = false,
): Promise<ProviderRateLimits> {
  const key = keyFor(provider, accountId);
  const running = pending.get(key);
  if (running) {
    if (oneShot) return running;
    if (!force) return running;
    const queued = queuedRefreshes.get(key);
    if (queued) return queued;
    const generation = generations.get(key);
    const next = running.then((result) =>
      generations.get(key) === generation
        ? loadRateLimits(provider, accountId, true, canRetry, background)
        : result,
    );
    queuedRefreshes.set(key, next);
    void next.finally(() => {
      if (queuedRefreshes.get(key) === next) queuedRefreshes.delete(key);
    });
    return next;
  }
  const cached = snapshots.get(key);
  if (cached && !force) return Promise.resolve(cached);

  cancelRetry(key);
  const generation = Symbol(key);
  generations.set(key, generation);
  if (!oneShot && (!background || !cached)) publish(key, fetchingRateLimits(provider, cached));
  const run = (async () => {
    let result: ProviderRateLimits;
    try {
      result =
        provider === "claude"
          ? await fetchClaudeRateLimits(accountId, oneShot)
          : provider === "codex"
            ? await fetchCodexRateLimits(accountId)
            : await fetchOpencodeGoRateLimits();
    } catch (error) {
      result = errorRateLimits(provider, error instanceof Error ? error.message : String(error));
    } finally {
      if (generations.get(key) === generation) pending.delete(key);
    }
    if (generations.get(key) !== generation) return result;
    if (oneShot && !canRetry()) return result;
    if (result.status === "error") {
      const renewalPending = result.renewalPending === true;
      // A failed request (a 429, a dropped connection) says nothing about the
      // usage itself: the last windows stay, dated when they were read.
      if (cached && hasWindows(cached)) {
        result = {
          ...errorRateLimits(provider, result.error ?? "", cached),
          updatedAt: cached.updatedAt,
          ...(renewalPending ? { renewalPending } : {}),
        };
      }
      if (!oneShot) scheduleRetry(provider, accountId, canRetry, background, renewalPending);
    } else {
      retryAttempts.delete(key);
    }
    return publish(key, result);
  })();
  pending.set(key, run);
  return run;
}

/** An explicit bounded observation; never queues a replay or schedules background retries. */
export function refreshClaudeQuotaOnce(accountId: string, canPublish: () => boolean) {
  return loadRateLimits("claude", accountId, true, canPublish, false, true);
}

/**
 * The cached limits when they were read within `maxAgeMs`, else a new read.
 * For callers that need current numbers but must share the footer's requests
 * instead of adding their own: the providers rate-limit this endpoint.
 */
export function loadFreshRateLimits(
  provider: RateLimitProvider,
  accountId = "default",
  maxAgeMs: number,
): Promise<ProviderRateLimits> {
  const cached = snapshots.get(keyFor(provider, accountId));
  const fresh = cached?.status === "ok" && Date.now() - cached.updatedAt < maxAgeMs;
  return loadRateLimits(provider, accountId, !fresh);
}

function hasWindows(limits: ProviderRateLimits): boolean {
  return Boolean(limits.session || limits.weekly || limits.monthly || limits.resetCredits);
}

/** Waits between automatic retries of a failed read; the last one repeats. */
const RETRY_DELAYS_MS = [60_000, 3 * 60_000, 10 * 60_000, 15 * 60_000];
/**
 * Re-read interval while a Claude token awaits CLI renewal. That read only
 * checks the local credential, so usage appears soon after the CLI renews it.
 */
const RENEWAL_CHECK_MS = 15_000;
const retryAttempts = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelRetry(key: string): void {
  const timer = retryTimers.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  retryTimers.delete(key);
}

function scheduleRetry(
  provider: RateLimitProvider,
  accountId: string,
  canRetry: () => boolean,
  background: boolean,
  renewalPending = false,
): void {
  const key = keyFor(provider, accountId);
  const attempt = retryAttempts.get(key) ?? 0;
  // A local renewal check does not count towards the network backoff.
  if (!renewalPending) retryAttempts.set(key, attempt + 1);
  cancelRetry(key);
  retryTimers.set(
    key,
    setTimeout(
      () => {
        retryTimers.delete(key);
        // The account may have been removed while waiting.
        if (snapshots.has(key)) {
          // Renewal checks repeat quietly instead of flashing a loading state.
          if (canRetry())
            void loadRateLimits(provider, accountId, true, canRetry, background || renewalPending);
          else scheduleRetry(provider, accountId, canRetry, background, renewalPending);
        }
      },
      renewalPending
        ? RENEWAL_CHECK_MS
        : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)],
    ),
  );
}

/** Also used when an account is removed and by tests that need a clean cache. */
export function clearCachedRateLimits(provider?: RateLimitProvider, accountId?: string): void {
  if (provider && accountId) {
    const key = keyFor(provider, accountId);
    cancelRetry(key);
    retryAttempts.delete(key);
    generations.delete(key);
    pending.delete(key);
    queuedRefreshes.delete(key);
    snapshots.delete(key);
    const { [key]: _removed, ...rest } = allSnapshots;
    allSnapshots = rest;
  } else {
    for (const key of [...retryTimers.keys()]) cancelRetry(key);
    retryAttempts.clear();
    generations.clear();
    pending.clear();
    queuedRefreshes.clear();
    snapshots.clear();
    allSnapshots = {};
  }
  for (const listener of listeners) listener();
}
