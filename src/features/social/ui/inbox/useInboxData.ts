import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SocialClient } from "../../model/socialClient";
import { socialQueryScope } from "../../model/socialQuery";
import { inboxApi } from "./inboxApi";
import type { InboxFilterState } from "./inboxTypes";

/** Automatic list refresh while the screen is visible and auto-refresh is on. */
export const INBOX_REFRESH_MS = 60_000;

const keyOf = (client: SocialClient, ...parts: unknown[]) => [
  ...socialQueryScope(client),
  "inbox",
  ...parts,
];

export function useInboxList(
  client: SocialClient,
  filter: InboxFilterState,
  options: { enabled: boolean; refresh: boolean },
) {
  const api = inboxApi(client);
  return useInfiniteQuery({
    queryKey: keyOf(client, "list", filter),
    queryFn: ({ pageParam }) => api.unified(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
    enabled: options.enabled,
    refetchInterval: options.enabled && options.refresh ? INBOX_REFRESH_MS : false,
  });
}

export function useInboxThread(client: SocialClient, threadId: string | undefined) {
  const api = inboxApi(client);
  return useQuery({
    queryKey: keyOf(client, "thread", threadId),
    queryFn: () => api.thread(threadId ?? ""),
    enabled: !!threadId,
  });
}

export function useInboxTimeline(client: SocialClient, personId: string | undefined) {
  const api = inboxApi(client);
  return useQuery({
    queryKey: keyOf(client, "timeline", personId),
    queryFn: () => api.timeline(personId ?? ""),
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

/** Shared snapshot: auto-refresh state, accounts (for names) and project facts for AI replies. */
export function useInboxSnapshot(client: SocialClient, active = true) {
  return useQuery({
    queryKey: keyOf(client, "snapshot"),
    queryFn: () => client.snapshot(),
    // Reopening the retained Inbox must reflect account/settings changes made elsewhere.
    staleTime: 0,
    enabled: active,
  });
}

/** Invalidates every inbox query after a status, tag, setting or reply change. */
export function useInboxInvalidate(client: SocialClient) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keyOf(client) });
}
