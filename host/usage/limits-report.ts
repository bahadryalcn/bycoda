import type { HostProviderAccountCatalog } from "../providers/provider-accounts";
import type { LimitsFetch } from "./limits-fetch";
import type { NamedWindow, WindowKind } from "./limits-parse";
import { windowReading, type WindowReading } from "./limits-pace";

type Provider = "claude" | "codex" | "opencode";
type Account = { id: string; label: string; color: string };

export type AccountLimit = {
  id: string;
  label: string;
  color: string;
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
  status: "ok" | "unavailable" | "error";
  error: string | null;
  resetCredits: number | null;
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
  fetchAccount: (provider: Provider, accountId: string) => Promise<LimitsFetch>;
  now?: () => number;
};

const KIND_ORDER: Record<WindowKind, number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
};
const OK_TTL_MS = 2 * 60_000;
const FAIL_TTL_MS = 30_000;
const cache = new Map<string, { at: number; ttl: number; value: Promise<LimitsFetch> }>();

/** Shares one in-flight read per account and keeps it briefly, so several phones do not hammer a provider. */
function cached(key: string, now: number, load: () => Promise<LimitsFetch>): Promise<LimitsFetch> {
  const hit = cache.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  const entry = { at: now, ttl: OK_TTL_MS, value: load() };
  entry.value.then(
    (result) => {
      if (result.status !== "ok") entry.ttl = FAIL_TTL_MS;
    },
    () => {
      entry.ttl = 0;
    },
  );
  if (cache.size > 256) cache.clear();
  cache.set(key, entry);
  return entry.value;
}
export const clearLimitsCache = () => cache.clear();

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

export async function readUsageLimits(deps: LimitsDeps): Promise<UsageLimitsReport> {
  const now = (deps.now ?? Date.now)();
  const catalog = await deps.accounts();
  const providers = await Promise.all(
    (["claude", "codex", "opencode"] as const).map(async (provider) => {
      const accounts = catalog[provider] ?? [];
      const results = await Promise.all(
        accounts.map(async (account) => ({
          account,
          fetch: await cached(`${provider}:${account.id}`, now, () =>
            deps.fetchAccount(provider, account.id),
          ).catch((): LimitsFetch => ({
            status: "error",
            error: "Quota read failed",
          })),
        })),
      );
      // OpenCode Go is optional: without a key or plan it is left out rather than shown as an error.
      if (provider === "opencode" && results.every(({ fetch }) => fetch.status === "unavailable"))
        return null;
      return {
        provider,
        cards: buildCards(
          results.map(({ account, fetch }) => ({
            account,
            windows: fetch.status === "ok" ? fetch.limits.windows : [],
          })),
          now,
        ),
        accounts: results.map(({ account, fetch }): AccountStatus => ({
          ...account,
          status: fetch.status,
          error: fetch.status === "ok" ? null : fetch.error,
          resetCredits: fetch.status === "ok" ? fetch.limits.resetCredits : null,
        })),
      };
    }),
  );
  return {
    environmentId: deps.environmentId,
    sampledAt: now,
    source: "host-provider-api",
    providers: providers.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  };
}
