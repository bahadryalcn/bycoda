import type { SocialDraft, SocialThread } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import type {
  InboxFilterState,
  InboxReplyOptions,
  InboxSettings,
  InboxStatus,
  InboxUnifiedResult,
  PersonTimeline,
} from "./inboxTypes";

export const INBOX_PAGE_SIZE = 50;

type RequestFn = <T>(
  action: string,
  input?: Record<string, unknown>,
  requestId?: string,
) => Promise<T>;

export type InboxReplyInput = {
  threadId: string;
  text: string;
  /** Verified fact ids the reply was written from (empty for a manual reply). */
  factIds: string[];
};

function newRequestId(): string {
  return crypto.randomUUID();
}

/** Only the filters the owner set are sent; "all" and empty values are left out. */
export function unifiedFilterInput(filter: InboxFilterState): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (filter.status !== "all") input.status = filter.status;
  if (filter.accountId) input.accountId = filter.accountId;
  const query = filter.query.trim();
  if (query) input.query = query;
  return input;
}

/**
 * Sends one reply: draft, owner approval of the exact draft, then queue. The Host decides the
 * rest (autonomy, suppression, limits). The draft is passed back unchanged as `reviewedDraft`.
 * Marking the conversation "replied" happens only after the reply is queued and never fails it.
 */
export async function sendInboxReply(call: RequestFn, input: InboxReplyInput): Promise<void> {
  const draft = await call<SocialDraft>(
    "replies.draft",
    { threadId: input.threadId, text: input.text, factIds: input.factIds },
    newRequestId(),
  );
  await call("drafts.approve", { id: draft.id, reviewedDraft: draft }, newRequestId());
  await call("replies.send", { id: draft.id }, newRequestId());
  await call(
    "inbox.setStatus",
    { threadId: input.threadId, status: "replied" satisfies InboxStatus },
    newRequestId(),
  ).catch(() => undefined);
}

/** Typed calls for the inbox screen. Every write gets its own request id. */
export function inboxApi(client: SocialClient) {
  const call: RequestFn = client.request;
  return {
    unified: (filter: InboxFilterState, cursor?: string) =>
      call<InboxUnifiedResult>("inbox.unified", {
        filter: unifiedFilterInput(filter),
        ...(cursor ? { cursor } : {}),
        limit: INBOX_PAGE_SIZE,
      }),
    thread: (threadId: string) => call<SocialThread>("thread.read", { id: threadId }),
    timeline: (personId: string) => call<PersonTimeline>("inbox.timeline", { personId }),
    replyOptions: (threadId: string) => call<InboxReplyOptions>("inbox.replyOptions", { threadId }),
    setStatus: (threadId: string, status: InboxStatus, tags?: string[]) =>
      call<unknown>(
        "inbox.setStatus",
        { threadId, status, ...(tags ? { tags } : {}) },
        newRequestId(),
      ),
    suggest: (threadId: string, factIds: string[]) =>
      call<{ text: string; factIds: string[] }>("replies.suggest", { threadId, factIds }),
    setAutoRefresh: (autoRefresh: boolean) =>
      call<InboxSettings>("inbox.settings", { autoRefresh }, newRequestId()),
    sendReply: (input: InboxReplyInput) => sendInboxReply(call, input),
  };
}
