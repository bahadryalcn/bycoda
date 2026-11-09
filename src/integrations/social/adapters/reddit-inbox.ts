import type { SocialHttp, SocialInbound, SocialAccount } from "../adapter";
import { redditAt, redditCall, redditChildren, redditCursor } from "./reddit-api";

type Child = { kind: unknown; data: Record<string, unknown> };

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const name = (value: unknown): string | undefined =>
  typeof value === "string" && /^t[1-5]_[a-z0-9]{1,30}$/.test(value) ? value : undefined;

/**
 * Maps one /message/inbox child. Comment replies, post replies and username mentions are kind t1 and
 * become "comment" events, with the comment as the reply target. Private messages are t4 and become
 * "message" events keyed by their thread root. Deleted or system items without an author are skipped.
 */
export function redditInboundEvent(child: Child): SocialInbound | undefined {
  const data = child.data;
  const id = name(data.name);
  const author = typeof data.author === "string" ? data.author : undefined;
  const at = redditAt(data.created_utc);
  if (!id || !author || author === "[deleted]" || at === undefined) return undefined;
  if (child.kind === "t1")
    return {
      eventId: id,
      threadId: name(data.link_id) ?? id,
      contactId: author,
      contactName: author,
      kind: "comment",
      text: text(data.body),
      at,
      postId: id,
    };
  if (child.kind === "t4")
    return {
      eventId: id,
      threadId: name(data.first_message_name) ?? id,
      contactId: author,
      contactName: author,
      kind: "message",
      text: text(data.body),
      at,
    };
  return undefined;
}

export function redditInboundEvents(children: Child[]): SocialInbound[] {
  return children.map(redditInboundEvent).filter((event): event is SocialInbound => !!event);
}

/**
 * Inbox poll. The cursor is the newest fullname already seen; `before` asks Reddit for newer items.
 * shortcut: one page of 100 items per poll. A backlog larger than 100 between two polls is not paged,
 * so older items can be missed. Upgrade: follow `after` until the cursor is reached.
 */
export async function redditInbox(
  http: SocialHttp,
  account: Pick<SocialAccount, "id">,
  token: string,
  cursor: string | undefined,
): Promise<{ events: SocialInbound[]; cursor?: string }> {
  const before = redditCursor(cursor);
  const { value } = await redditCall(http, account, token, "/message/inbox", {
    query: { limit: "100", ...(before ? { before } : {}) },
  });
  const children = redditChildren(value) as Child[];
  // The cursor is the newest named item by created time, whatever order Reddit lists them in.
  let newest: { id: string; at: number } | undefined;
  for (const child of children) {
    const id = name(child.data.name);
    const at = redditAt(child.data.created_utc);
    if (id !== undefined && at !== undefined && (!newest || at > newest.at)) newest = { id, at };
  }
  return { events: redditInboundEvents(children), cursor: newest?.id ?? before };
}
