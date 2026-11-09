import { focusManager, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { fetchPrChecks, type CodeHostProvider } from "../model/prChecks";
import { type GithubPrChecks } from "../model/githubPrChecks";

const POLL_MS = 30_000;

export type GithubPrChecksView = {
  provider?: CodeHostProvider;
  checks: GithubPrChecks | null;
  /** Initial load: no results yet, so the view must not read as "no checks". */
  loading: boolean;
  /** Revalidation of already-shown results. */
  refreshing: boolean;
  error: string | null;
  /** Previous results stayed on screen after a failed refresh. */
  stale: boolean;
  refresh: () => void;
};

/** One answer of the read: the failure message travels with the results it left in place. */
type PrChecksRead = { checks: GithubPrChecks | null; error: string | null };

/**
 * Account generations. A GitLab or Azure DevOps account change replaces the
 * instance behind the same PR number, so it is part of the query identity and
 * drops saved results. GitHub has no account event. One shared listener pair
 * serves every subscriber; snapshots are plain numbers, so they stay cached.
 */
const ACCOUNT_EVENTS = {
  gitlab: "bycoda:gitlab-change",
  azuredevops: "bycoda:azuredevops-change",
} as const;
const accountGenerations = { gitlab: 0, azuredevops: 0 };
const accountListeners = new Set<() => void>();
function subscribeAccounts(listener: () => void) {
  if (accountListeners.size === 0) {
    window.addEventListener(ACCOUNT_EVENTS.gitlab, onGitlabChange);
    window.addEventListener(ACCOUNT_EVENTS.azuredevops, onAzureDevOpsChange);
  }
  accountListeners.add(listener);
  return () => {
    accountListeners.delete(listener);
    if (accountListeners.size === 0) {
      window.removeEventListener(ACCOUNT_EVENTS.gitlab, onGitlabChange);
      window.removeEventListener(ACCOUNT_EVENTS.azuredevops, onAzureDevOpsChange);
    }
  };
}
function bumpAccount(provider: keyof typeof accountGenerations) {
  accountGenerations[provider] += 1;
  for (const listener of Array.from(accountListeners)) listener();
}
function onGitlabChange() {
  bumpAccount("gitlab");
}
function onAzureDevOpsChange() {
  bumpAccount("azuredevops");
}
const accountGenerationOf = {
  github: () => 0,
  gitlab: () => accountGenerations.gitlab,
  azuredevops: () => accountGenerations.azuredevops,
} satisfies Record<CodeHostProvider, () => number>;

const IDENTITY_LENGTH = 7;

/**
 * Loads PR checks on mount regardless of the active tab, keeps them fresh for
 * open PRs while mounted and visible, and allows initial and manual loads only
 * for closed or merged ones. Results are replaced together with headOid, never
 * merged across commits, and a late answer cannot outlive a PR change, a
 * revision change, or unmount.
 *
 * The query key is the PR identity (provider, account generation, cwd, repo,
 * number) plus the list revision. A revision change starts a new read while the
 * previous head stays visible as stale; a PR or account change shows nothing
 * until its own answer arrives. A failed read keeps the last good results of the
 * same PR and reports the error beside them.
 */
export function useGithubPrChecks(params: {
  provider?: CodeHostProvider;
  cwd: string;
  repo: string;
  number: number;
  enabled: boolean;
  /** Open PRs poll; closed or merged ones load once and on demand. */
  open: boolean;
  poll?: boolean;
  revision?: number;
}): GithubPrChecksView {
  const {
    provider = "github",
    cwd,
    repo,
    number,
    enabled,
    open,
    poll = true,
    revision = 0,
  } = params;
  const accountGeneration = useSyncExternalStore(
    subscribeAccounts,
    accountGenerationOf[provider],
    accountGenerationOf[provider],
  );
  const identity = ["inbox", "prChecks", provider, accountGeneration, cwd, repo, number] as const;
  const identityId = identity.join("\u0000");
  /** Last good results per identity; a failed read hands them back with its error. */
  const lastGood = useRef<{ identityId: string; checks: GithubPrChecks } | null>(null);
  const polling = enabled && open && poll;

  const query = useQuery({
    queryKey: [...identity, revision] as const,
    queryFn: async (): Promise<PrChecksRead> => {
      try {
        const checks = await fetchPrChecks(provider, cwd, repo, number);
        // headOid and checks land together, so two commits never mix.
        lastGood.current = { identityId, checks };
        return { checks, error: null };
      } catch (reason) {
        const previous =
          lastGood.current?.identityId === identityId ? lastGood.current.checks : null;
        return {
          checks: previous,
          error: reason instanceof Error ? reason.message : String(reason),
        };
      }
    },
    enabled,
    // Keep the previous head on screen while a new revision of the same PR loads.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.slice(0, IDENTITY_LENGTH).join("\u0000") === identityId
        ? previous
        : undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: polling ? POLL_MS : false,
    refetchIntervalInBackground: false,
    // Returning to a visible document refreshes an open, polled PR.
    refetchOnWindowFocus: polling,
    refetchOnReconnect: false,
  });

  const { refetch } = query;
  const previousPoll = useRef(poll);
  useEffect(() => {
    const resumed = poll && !previousPoll.current;
    previousPoll.current = poll;
    if (resumed && enabled && open && focusManager.isFocused()) {
      void refetch({ cancelRefetch: false });
    }
  }, [poll, enabled, open, refetch]);

  const refresh = useCallback(() => {
    if (enabled) void refetch({ cancelRefetch: false });
  }, [enabled, refetch]);

  const read = enabled ? query.data : undefined;
  const checks = read?.checks ?? null;
  const showing = checks != null;
  return {
    provider,
    checks,
    loading: enabled && !showing && query.isFetching,
    refreshing: enabled && showing && query.isFetching,
    // A placeholder belongs to the previous revision; its error is not this read's.
    error: read && !query.isPlaceholderData ? read.error : null,
    stale: showing && (query.isPlaceholderData || read?.error != null),
    refresh,
  };
}
