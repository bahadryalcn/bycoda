import type { HostProviderAccountCatalog } from "../providers/provider-accounts";
import type { LimitsFetch } from "./limits-fetch";
import type { NamedWindow, WindowKind } from "./limits-parse";
import { windowReading, type WindowReading } from "./limits-pace";
import {
  errorRateLimits,
  idleRateLimits,
  mergeCodexQuotaWindows,
  quotaBillingProvider,
  QUOTA_POLL_MS,
  QUOTA_RETRY_MS,
  unavailableRateLimits,
  type ProviderRateLimits,
  type QuotaSource,
} from "../../src/shared/model/provider-quota";

const providersWithQuota = ["claude", "codex", "opencode", "grok"] as const;
type Provider = (typeof providersWithQuota)[number];
export type QuotaTarget = { provider: Provider; accountId: string };

export function isQuotaProvider(provider: unknown): provider is Provider {
  return providersWithQuota.some((candidate) => candidate === provider);
}
export function isQuotaSource(source: unknown): source is QuotaSource {
  return isQuotaProvider(source) || source === "pi-anthropic" || source === "pi-openai-codex";
}
type Account = {
  id: string;
  label: string;
  color: string;
  kind?: "personal" | "work";
  derivedKind?: "personal" | "work";
};

export type AccountLimit = {
  id: string;
  label: string;
  color: string;
  kind?: "personal" | "work";
  derivedKind?: "personal" | "work";
  reading: WindowReading;
};
export type LimitCard = {
  key: string;
  kind: WindowKind;
  model: string | null;
  /** The account with the most headroom: the one a person would switch to. */
  best: WindowReading;
  accounts: AccountLimit[];
};
export type AccountStatus = {
  id: string;
  label: string;
  color: string;
  kind?: "personal" | "work";
  derivedKind?: "personal" | "work";
  status: "ok" | "unavailable" | "error";
  error: string | null;
  resetCredits: number | null;
  observedAt?: number | null;
};
export type UsageLimitsReport = {
  environmentId: string;
  sampledAt: number;
  source: "host-provider-api";
  providers: {
    provider: Provider;
    cards: LimitCard[];
    accounts: AccountStatus[];
  }[];
};

export type LimitsDeps = {
  environmentId: string;
  /** `opencode` is a single synthetic account, listed only while its key is connected. */
  accounts: () => Promise<HostProviderAccountCatalog & { opencode?: Account[] }>;
  fetchAccount: (provider: QuotaSource, accountId: string) => Promise<LimitsFetch>;
  now?: () => number;
};

const KIND_ORDER: Record<WindowKind, number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
};
type Good = { observedAt: number; result: Extract<LimitsFetch, { status: "ok" }> };
type QuotaObservation = {
  latest: LimitsFetch;
  good: Good | null;
  attemptedAt: number;
  nextReadAt: number;
};
type CacheEntry = {
  pending?: Promise<QuotaObservation>;
  observation?: QuotaObservation;
  nextReadAt: number;
  failures: number;
  approvedAt?: number;
};
const cache = new Map<string, CacheEntry>();
const quotaKey = (environmentId: string, provider: QuotaSource, accountId: string) =>
  JSON.stringify([environmentId, provider, accountId]);

/** The active Codex child can update known overall windows without another probe. */
export function observeCodexQuota(
  environmentId: string,
  accountId: string,
  update: ProviderRateLimits,
) {
  const observation = cache.get(quotaKey(environmentId, "codex", accountId))?.observation;
  if (observation?.latest.status !== "ok" || !observation.good) return;
  const { result } = observation.good;
  if (!result.desktop) return;
  const desktop = mergeCodexQuotaWindows(result.desktop, update);
  const windows = result.limits.windows.map((window) => {
    const observed = update[window.kind];
    return window.model === null && observed ? { ...window, window: observed } : window;
  });
  const merged = { ...result, desktop, limits: { ...result.limits, windows } };
  observation.latest = merged;
  observation.good.result = merged;
}

/** Report readers and individual consumers share one provider call per Host account. */
export function readAccountQuota(
  deps: LimitsDeps,
  target: { provider: QuotaSource; accountId: string },
  intent: "read" | "refresh" | "approved" = "read",
  maxAgeMs = QUOTA_POLL_MS[target.provider],
): Promise<QuotaObservation> {
  const { provider, accountId } = target;
  const key = quotaKey(deps.environmentId, provider, accountId);
  const clock = deps.now ?? Date.now;
  const now = clock();
  const entry = cache.get(key) ?? { nextReadAt: 0, failures: 0 };
  if (entry.pending) return entry.pending;
  if (intent === "approved" && entry.approvedAt !== undefined && now - entry.approvedAt < 300_000) {
    throw new Error("Wait before refreshing this account's quota again");
  }
  const last = entry.observation;
  const withinBackoff = last && last.latest.status !== "ok" && now < entry.nextReadAt;
  const fresh = last && last.latest.status === "ok" && now - last.attemptedAt < maxAgeMs;
  if (
    last &&
    ((intent === "read" && (fresh || withinBackoff)) ||
      (withinBackoff &&
        last.latest.status === "error" &&
        last.latest.reason !== "signedOut" &&
        !last.latest.renewalPending))
  ) {
    return Promise.resolve(last);
  }
  if (intent === "approved") entry.approvedAt = now;
  if (!cache.has(key) && cache.size >= 256) {
    const evictable = [...cache].find(([, candidate]) => !candidate.pending);
    if (evictable) cache.delete(evictable[0]);
  }
  cache.set(key, entry);
  entry.pending = Promise.resolve()
    .then(() => deps.fetchAccount(provider, accountId))
    .catch((): LimitsFetch => ({ status: "error", error: "Quota read failed" }))
    .then((latest) => {
      const attemptedAt = clock();
      const good =
        latest.status === "ok"
          ? { result: latest, observedAt: attemptedAt }
          : latest.status === "unavailable" || latest.reason === "signedOut"
            ? null
            : (entry.observation?.good ?? null);
      const delay =
        latest.status === "ok"
          ? QUOTA_POLL_MS[provider]
          : latest.renewalPending && entry.failures < 10
            ? 15_000
            : Math.max(
                latest.retryAfterMs ?? 0,
                QUOTA_RETRY_MS[Math.min(entry.failures, QUOTA_RETRY_MS.length - 1)],
              );
      entry.failures = latest.status === "ok" ? 0 : entry.failures + 1;
      entry.nextReadAt = attemptedAt + delay;
      entry.observation = { latest, good, attemptedAt, nextReadAt: entry.nextReadAt };
      return entry.observation;
    })
    .finally(() => {
      delete entry.pending;
    });
  return entry.pending;
}
export const clearLimitsCache = () => cache.clear();

export async function readDesktopQuota(
  deps: LimitsDeps,
  target: { provider: QuotaSource; accountId: string },
  intent: "read" | "refresh" | "approved",
  maxAgeMs?: number,
): Promise<ProviderRateLimits> {
  const provider = quotaBillingProvider(target.provider);
  const { latest, good, attemptedAt, nextReadAt } = await readAccountQuota(
    deps,
    target,
    intent,
    maxAgeMs,
  );
  const previous = good
    ? {
        ...(good.result.desktop ?? {
          ...idleRateLimits(provider),
          ...Object.fromEntries(
            good.result.limits.windows
              .filter(({ model }) => model === null)
              .map(({ kind, window }) => [kind, window]),
          ),
          status: "ok" as const,
        }),
        updatedAt: good.observedAt,
      }
    : null;
  if (latest.status === "ok" && previous) return previous;
  if (latest.status === "ok") throw new Error("Quota observation missing");
  const failure =
    latest.status === "unavailable"
      ? unavailableRateLimits(provider, latest.error, latest.reason)
      : errorRateLimits(provider, latest.error, previous, latest.reason);
  return {
    ...failure,
    updatedAt: previous?.updatedAt ?? attemptedAt,
    retryAt: nextReadAt,
    ...(latest.renewalPending ? { renewalPending: true } : {}),
  };
}

/** Groups accounts' windows into one card per window, ranked by most headroom. */
export function buildCards(
  readings: { account: Account; windows: NamedWindow[] }[],
  now: number,
): LimitCard[] {
  const groups = new Map<string, { sample: NamedWindow; accounts: AccountLimit[] }>();
  for (const { account, windows } of readings)
    for (const named of windows) {
      const group = groups.get(named.key) ?? { sample: named, accounts: [] };
      group.accounts.push({
        ...account,
        reading: windowReading(named.window, now),
      });
      groups.set(named.key, group);
    }
  return [...groups.values()]
    .map(({ sample, accounts }) => {
      accounts.sort(
        (a, b) => b.reading.leftPercent - a.reading.leftPercent || a.label.localeCompare(b.label),
      );
      return {
        key: sample.key,
        kind: sample.kind,
        model: sample.model,
        best: accounts[0].reading,
        accounts,
      };
    })
    .sort(
      (a, b) =>
        Number(a.model !== null) - Number(b.model !== null) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.model ?? "").localeCompare(b.model ?? ""),
    );
}

export async function readUsageLimits(
  deps: LimitsDeps,
  target?: QuotaTarget,
): Promise<UsageLimitsReport> {
  const now = (deps.now ?? Date.now)();
  const catalog = await deps.accounts();
  const providers = await Promise.all(
    (target ? [target.provider] : providersWithQuota).map(async (provider) => {
      const accounts = (catalog[provider] ?? []).filter(
        (account) => !target || account.id === target.accountId,
      );
      const results = await Promise.all(
        accounts.map(async (account) => ({
          account,
          observation: await readAccountQuota(deps, { provider, accountId: account.id }),
        })),
      );
      // OpenCode Go is optional: without a key or plan it is left out rather than shown as an error.
      if (
        (provider === "opencode" || provider === "grok") &&
        results.every(({ observation }) => observation.latest.status === "unavailable")
      )
        return null;
      return {
        provider,
        cards: buildCards(
          results.map(({ account, observation }) => ({
            account,
            windows: observation.good?.result.limits.windows ?? [],
          })),
          now,
        ),
        accounts: results.map(({ account, observation: { latest, good } }): AccountStatus => ({
          ...account,
          status: latest.status,
          error: latest.status === "ok" ? null : latest.error,
          resetCredits: latest.status === "ok" ? latest.limits.resetCredits : null,
          observedAt: good?.observedAt ?? null,
        })),
      };
    }),
  );
  return {
    environmentId: deps.environmentId,
    sampledAt: (deps.now ?? Date.now)(),
    source: "host-provider-api",
    providers: providers.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  };
}
