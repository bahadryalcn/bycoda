import { errorText } from "../../../shared/lib/errors";
import { createStore } from "../../../shared/lib/store";
import { useSyncExternalStore } from "react";
import { focusManager, replaceEqualDeep } from "@tanstack/react-query";
import { recordRateLimitHistory } from "./rateLimitHistory";
import { fetchGrokRateLimits } from "./grokRateLimitsFetch";
import { fetchPiUsage } from "./piUsage";
import { readHostAccountQuota } from "./hostAccountQuota";
import { subscribeCodexQuotaObservations } from "../../../integrations/harness/providers/codex/codexQuotaObservations";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  mergeCodexQuotaWindows,
  QUOTA_POLL_MS,
  QUOTA_RETRY_MS,
  type ProviderRateLimits,
  type RateLimitProvider,
  type QuotaSource,
} from "./rateLimits";
import {
  fetchClaudeRateLimits,
  fetchCodexRateLimits,
  fetchOpencodeGoRateLimits,
} from "./rateLimitsFetch";

const snapshots = new Map<string, ProviderRateLimits>();
const pending = new Map<string, Promise<ProviderRateLimits>>();
const generations = new Map<string, symbol>();
const listeners = createStore();
let allSnapshots: Record<string, ProviderRateLimits> = {};

export { QUOTA_POLL_MS, type QuotaSource } from "./rateLimits";

function keyFor(provider: QuotaSource, accountId: string): string {
  return `${provider}:${accountId}`;
}

function publish(key: string, value: ProviderRateLimits): ProviderRateLimits {
  if (!key.startsWith("pi-")) recordRateLimitHistory(key, value);
  const previous = snapshots.get(key);
  value = replaceEqualDeep(previous, value);
  if (previous === value) return value;
  snapshots.set(key, value);
  allSnapshots = { ...allSnapshots, [key]: value };
  listeners.notify();
  return value;
}

subscribeCodexQuotaObservations((accountId, update) => {
  const key = keyFor("codex", accountId);
  const previous = snapshots.get(key);
  if (previous?.status === "ok") publish(key, mergeCodexQuotaWindows(previous, update));
});

export function subscribeRateLimits(listener: () => void): () => void {
  return listeners.subscribe(listener);
}

export function getAllRateLimits(): Record<string, ProviderRateLimits> {
  return allSnapshots;
}

export function getCachedRateLimits(
  provider: QuotaSource,
  accountId = "default",
): ProviderRateLimits {
  return snapshots.get(keyFor(provider, accountId)) ?? idle[provider];
}

const idle: Record<QuotaSource, ProviderRateLimits> = {
  claude: idleRateLimits("claude"),
  codex: idleRateLimits("codex"),
  opencode: idleRateLimits("opencode"),
  grok: idleRateLimits("grok"),
  "pi-anthropic": idleRateLimits("claude"),
  "pi-openai-codex": idleRateLimits("codex"),
};

export function useCachedRateLimits(
  provider: QuotaSource,
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
  provider: QuotaSource,
  accountId = "default",
  force = false,
  canRetry: () => boolean = () => true,
  background = false,
  oneShot = false,
  maxAgeMs?: number,
): Promise<ProviderRateLimits> {
  const key = keyFor(provider, accountId);
  const running = pending.get(key);
  if (running) return running;
  const cached = snapshots.get(key);
  if (cached && !force) return Promise.resolve(cached);

  cancelRetry(key);
  const generation = Symbol(key);
  generations.set(key, generation);
  if (!oneShot && (!background || !cached))
    publish(key, fetchingRateLimits(idle[provider].provider, cached));
  const run = (async () => {
    let result: ProviderRateLimits;
    try {
      const intent = oneShot ? "approved" : force && !background ? "refresh" : "read";
      const hostRead = readHostAccountQuota(provider, accountId, intent, maxAgeMs);
      result =
        (hostRead ? await hostRead : undefined) ??
        (provider === "claude"
          ? await fetchClaudeRateLimits(accountId, oneShot)
          : provider === "codex"
            ? await fetchCodexRateLimits(accountId)
            : provider === "grok"
              ? await fetchGrokRateLimits(accountId)
              : provider === "opencode"
                ? await fetchOpencodeGoRateLimits()
                : await fetchPiUsage(provider === "pi-anthropic" ? "anthropic" : "openai-codex"));
    } catch (error) {
      result = errorRateLimits(idle[provider].provider, errorText(error));
    } finally {
      if (generations.get(key) === generation) pending.delete(key);
    }
    if (generations.get(key) !== generation) return result;
    if (oneShot && !canRetry()) return result;
    // Only an unbroken run of renewal checks counts towards the cap.
    if (result.renewalPending !== true) renewalChecks.delete(key);
    if (result.status === "error") {
      const renewalPending = result.renewalPending === true;
      const { retryAt } = result;
      // A failed request (a 429, a dropped connection) says nothing about the
      // usage itself: the last windows stay, dated when they were read.
      if (result.reason !== "signedOut" && cached && hasWindows(cached)) {
        result = {
          ...errorRateLimits(result.provider, result.error ?? "", cached, result.reason),
          ...(renewalPending ? { renewalPending } : {}),
          ...(retryAt !== undefined ? { retryAt } : {}),
        };
      }
      if (!oneShot)
        scheduleRetry(provider, accountId, canRetry, background, renewalPending, retryAt);
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

export function loadPolledRateLimits(
  provider: QuotaSource,
  accountId: string,
  canRetry: () => boolean,
): Promise<ProviderRateLimits> {
  const age =
    provider === "pi-anthropic" || provider === "pi-openai-codex"
      ? 5 * 60_000
      : QUOTA_POLL_MS[provider];
  return loadAutomaticRateLimits(provider, accountId, age, canRetry);
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
  return loadAutomaticRateLimits(provider, accountId, maxAgeMs);
}

function loadAutomaticRateLimits(
  provider: QuotaSource,
  accountId: string,
  maxAgeMs: number,
  canRetry: () => boolean = () => true,
): Promise<ProviderRateLimits> {
  const key = keyFor(provider, accountId);
  const running = pending.get(key);
  if (running) return running;
  const cached = snapshots.get(key);
  if (
    cached &&
    (retryTimers.has(key) ||
      pausedRetries.has(key) ||
      (cached.retryAt ?? 0) > Date.now() ||
      Date.now() - cached.updatedAt < maxAgeMs)
  ) {
    return Promise.resolve(cached);
  }
  return loadRateLimits(provider, accountId, true, canRetry, true, false, maxAgeMs);
}

function hasWindows(limits: ProviderRateLimits): boolean {
  return Boolean(limits.session || limits.weekly || limits.monthly || limits.resetCredits);
}

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
  provider: QuotaSource,
  accountId: string,
  canRetry: () => boolean,
  background: boolean,
  renewalPending = false,
  retryAt?: number,
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
      retryAt !== undefined
        ? Math.min(2_147_483_647, Math.max(1_000, retryAt - Date.now()))
        : renewing
          ? RENEWAL_CHECK_MS
          : QUOTA_RETRY_MS[Math.min(attempt, QUOTA_RETRY_MS.length - 1)],
    ),
  );
}

// Re-arm paused retries when the window regains focus; the account may have been removed meanwhile.
focusManager.subscribe(() => {
  if (!focusManager.isFocused()) return;
  for (const [key, resume] of Array.from(pausedRetries)) {
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
    snapshots.delete(key);
    const { [key]: _removed, ...rest } = allSnapshots;
    allSnapshots = rest;
  } else {
    for (const key of retryTimers.keys()) cancelRetry(key);
    pausedRetries.clear();
    retryAttempts.clear();
    renewalChecks.clear();
    generations.clear();
    pending.clear();
    snapshots.clear();
    allSnapshots = {};
  }
  listeners.notify();
}
