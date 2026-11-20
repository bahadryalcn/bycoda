import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SocialClient } from "../../model/socialClient";
import { useFirstPageRefresh } from "../../hooks/useFirstPageRefresh";
import { socialQueryScope } from "../../model/socialQuery";
import { inboxApi } from "./inboxApi";
import { dedupeInboxPages, refreshInboxPages } from "./inboxRefresh";
import type { InboxFilterState } from "./inboxTypes";

/** Automatic list refresh while the screen is visible and auto-refresh is on. */
export const INBOX_REFRESH_MS = 60_000;

const keyOf = (client: SocialClient, ...parts: unknown[]) => [
  ...socialQueryScope(client),
  "inbox",
  ...parts,
];

/**
 * The conversation list. While auto-refresh is on, only the newest page is re-read each interval and
 * folded into the loaded pages, so "Load more" never makes later polls dearer; an invalidation (check
 * now, a status or reply change) still refetches every loaded page.
 */
export function useInboxList(
  client: SocialClient,
  filter: InboxFilterState,
  options: { enabled: boolean; refresh: boolean },
) {
  const api = inboxApi(client);
  const queryKey = keyOf(client, "list", filter);
  const polling = options.enabled && options.refresh;
  const list = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api.unified(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
    select: dedupeInboxPages,
    enabled: options.enabled,
    // The newest-page poll keeps the list current; only an invalidation makes it stale.
    staleTime: polling ? Infinity : 0,
  });
  useFirstPageRefresh({
    active: polling,
    queryKey,
    intervalMs: INBOX_REFRESH_MS,
    read: () => api.unified(filter),
    merge: refreshInboxPages,
  });
  return list;
}

export function useInboxThread(client: SocialClient, threadId: string | undefined) {
  const api = inboxApi(client);
  return useQuery({
    queryKey: keyOf(client, "thread", threadId),
    queryFn: () => api.thread(threadId ?? ""),
    enabled: !!threadId,
  });
}

/** The person's timeline, newest page first; older pages load on request through `fetchNextPage`. */
export function useInboxTimeline(client: SocialClient, personId: string | undefined) {
  const api = inboxApi(client);
  return useInfiniteQuery({
    queryKey: keyOf(client, "timeline", personId),
    queryFn: ({ pageParam }) => api.timeline(personId ?? "", pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
    enabled: !!personId,
  });
}

export function useInboxReplyOptions(client: SocialClient, threadId: string | undefined) {
  const api = inboxApi(client);
  return useQuery({
    queryKey: keyOf(client, "reply-options", threadId),
    queryFn: () => api.replyOptions(threadId ?? ""),
    enabled: !!threadId,
  });
}

/** Reference reads the screen shares; a thread, status or tag change never moves them. */
const REFERENCE_PARTS = new Set<unknown>(["accounts", "facts"]);

/**
 * Accounts, their capabilities and the Host refresh and sending settings from the accounts section only,
 * never the full workspace snapshot. Only the screen fetches it, so it is read once per open;
 * conversation parts pass `active: false` and read the screen's cached result.
 */
export function useInboxAccounts(client: SocialClient, active = true) {
  return useQuery({
    queryKey: keyOf(client, "accounts"),
    queryFn: async () => {
      const { snapshot } = await client.sectionSnapshot({ section: "accounts", limit: 1 });
      if (!snapshot) throw new Error("The Host did not return the accounts.");
      return {
        accounts: snapshot.accounts,
        capabilities: snapshot.capabilities,
        pollingEnabled: snapshot.pollingEnabled,
        sendingEnabled: snapshot.sendingEnabled,
      };
    },
    // Reopening the retained Inbox must reflect account/settings changes made elsewhere: the read
    // refetches when the screen becomes active, but not on every window focus.
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: active,
  });
}

/**
 * Verified facts of one project for AI replies. The Host narrows profiles by the caller's project
 * access, and the key carries the project, so a conversation never reads another project's facts.
 * Remounting a reply box per conversation reuses the cached read inside the stale window.
 */
export function useInboxProjectFacts(client: SocialClient, projectId: string | undefined) {
  return useQuery({
    queryKey: keyOf(client, "facts", projectId),
    queryFn: async () => {
      const { snapshot } = await client.sectionSnapshot({
        section: "accounts",
        projectId,
        limit: 1,
      });
      if (!snapshot) throw new Error("The Host did not return the project facts.");
      return snapshot.profiles.find((profile) => profile.projectId === projectId)?.facts ?? [];
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!projectId,
  });
}

/**
 * Invalidates the inbox list and conversation reads after a status, tag or reply change. Cached
 * queries of other conversations only turn stale. Pass `reference` after a change that can move
 * accounts or the auto-refresh setting (settings, Check now) to reload those reads too.
 */
export function useInboxInvalidate(client: SocialClient) {
  const queryClient = useQueryClient();
  const scope = keyOf(client);
  return (options: { reference?: boolean } = {}) =>
    queryClient.invalidateQueries({
      queryKey: scope,
      predicate: (query) =>
        options.reference === true || !REFERENCE_PARTS.has(query.queryKey[scope.length]),
    });
}
