import { errorText } from "../../../shared/lib/errors";
import { createStore } from "../../../shared/lib/store";
import { useSyncExternalStore } from "react";
import { focusManager, replaceEqualDeep } from "@tanstack/react-query";
import { recordRateLimitHistory } from "./rateLimitHistory";
import { fetchGrokRateLimits } from "./grokRateLimitsFetch";
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
const listeners = createStore();
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
  listeners.notify();
  return value;
}

export function subscribeRateLimits(listener: () => void): () => void {
  return listeners.subscribe(listener);
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
  grok: idleRateLimits("grok"),
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
            : provider === "grok"
              ? await fetchGrokRateLimits(accountId)
              : await fetchOpencodeGoRateLimits();
    } catch (error) {
      result = errorRateLimits(provider, errorText(error));
    } finally {
      if (generations.get(key) === generation) pending.delete(key);
    }
    if (generations.get(key) !== generation) return result;
    if (oneShot && !canRetry()) return result;
    // Only an unbroken run of renewal checks counts towards the cap.
    if (result.renewalPending !== true) renewalChecks.delete(key);
    if (result.status === "error") {
      const renewalPending = result.renewalPending === true;
      // A failed request (a 429, a dropped connection) says nothing about the
      // usage itself: the last windows stay, dated when they were read.
      if (cached && hasWindows(cached)) {
        result = {
          ...errorRateLimits(provider, result.error ?? "", cached, result.reason),
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
/** Renewal checks per account before it falls back to the network backoff. */
const MAX_RENEWAL_CHECKS = 10;
const retryAttempts = new Map<string, number>();
const renewalChecks = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Retries that came due while the window was hidden; the next focus resumes them. */
const pausedRetries = new Map<string, () => void>();

function cancelRetry(key: string): void {
  pausedRetries.delete(key);
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
  const checks = renewalChecks.get(key) ?? 0;
  const renewing = renewalPending && checks < MAX_RENEWAL_CHECKS;
  // A local renewal check does not count towards the network backoff.
  if (renewing) renewalChecks.set(key, checks + 1);
  const attempt = retryAttempts.get(key) ?? 0;
  if (!renewing) retryAttempts.set(key, attempt + 1);
  cancelRetry(key);
  retryTimers.set(
    key,
    setTimeout(
      () => {
        retryTimers.delete(key);
        // The account may have been removed while waiting.
        if (!snapshots.has(key)) return;
        const resume = () => {
          // Renewal checks repeat quietly instead of flashing a loading state.
          void loadRateLimits(provider, accountId, true, canRetry, background || renewing);
        };
        // Hidden: stop polling and wait for focus instead of rescheduling.
        if (canRetry()) resume();
        else pausedRetries.set(key, resume);
      },
      renewing ? RENEWAL_CHECK_MS : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)],
    ),
  );
}

// Re-arm paused retries when the window regains focus; the account may have been removed meanwhile.
focusManager.subscribe(() => {
  if (!focusManager.isFocused()) return;
  for (const [key, resume] of [...pausedRetries]) {
    pausedRetries.delete(key);
    if (snapshots.has(key)) resume();
  }
});

/** Also used when an account is removed and by tests that need a clean cache. */
export function clearCachedRateLimits(provider?: RateLimitProvider, accountId?: string): void {
  if (provider && accountId) {
    const key = keyFor(provider, accountId);
    cancelRetry(key);
    retryAttempts.delete(key);
    renewalChecks.delete(key);
    generations.delete(key);
    pending.delete(key);
    queuedRefreshes.delete(key);
    snapshots.delete(key);
    const { [key]: _removed, ...rest } = allSnapshots;
    allSnapshots = rest;
  } else {
    for (const key of [...retryTimers.keys()]) cancelRetry(key);
    pausedRetries.clear();
    retryAttempts.clear();
    renewalChecks.clear();
    generations.clear();
    pending.clear();
    queuedRefreshes.clear();
    snapshots.clear();
    allSnapshots = {};
  }
  listeners.notify();
}
