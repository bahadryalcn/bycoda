import {
  SocialPlatformError,
  type SocialInbound,
  type SocialSendResult,
} from "../src/integrations/social/adapter";

type ObjectValue = Record<string, any>;
const numericId = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,25}$/.test(value);
function decode(raw: string, now: number): ObjectValue {
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new SocialPlatformError("rejected");
  let value: ObjectValue;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SocialPlatformError("rejected");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SocialPlatformError("rejected");
  if (Array.isArray(value.errors) && value.errors.length) {
    const codes = value.errors.map((item: ObjectValue) => item?.code);
    if (codes.some((code: unknown) => code === 32 || code === 89 || code === 215))
      throw new SocialPlatformError("expired");
    if (codes.includes(88)) throw new SocialPlatformError("rate_limit", now + 15 * 60_000);
    throw new SocialPlatformError("rejected");
  }
  return value;
}
function walk(value: unknown, visit: (item: ObjectValue) => void) {
  const pending = [value];
  let budget = 20_000;
  while (pending.length) {
    if (--budget <= 0) throw new SocialPlatformError("rejected");
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item)) {
      if (item.length + pending.length > 20_000) throw new SocialPlatformError("rejected");
      pending.push(...item);
      continue;
    }
    visit(item);
    const children = Object.values(item);
    if (children.length + pending.length > 20_000) throw new SocialPlatformError("rejected");
    pending.push(...children);
  }
}
function timestamp(value: unknown, now: number): number | undefined {
  const at =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : typeof value === "string"
          ? Date.parse(value)
          : NaN;
  return Number.isSafeInteger(at) && at > 0 && at <= now + 60_000 ? at : undefined;
}

/** Decode only response evidence addressed to this account; never infer recipients from names. */
export function parseXBrowserMentions(
  raw: string,
  accountId: string,
  ownedPosts: string[],
  now = Date.now(),
): SocialInbound[] {
  if (!numericId(accountId)) throw new SocialPlatformError("denied");
  const value = decode(raw, now);
  const events = new Map<string, SocialInbound>();
  const posts = new Set(ownedPosts.filter(numericId));
  let recognized = !!value.global_objects?.tweets;
  walk(value, (node) => {
    if (
      node.timeline?.instructions ||
      node.timeline_v2?.instructions ||
      node.timeline_response?.timeline?.instructions
    )
      recognized = true;
    const tweet = node.legacy ?? node;
    const id = tweet.id_str ?? node.rest_id;
    const author = tweet.user_id_str;
    if (!numericId(id) || !numericId(author) || typeof tweet.full_text !== "string") return;
    recognized = true;
    if (author === accountId || tweet.full_text.length > 30_000) return;
    const mentions = tweet.entities?.user_mentions;
    const directed =
      tweet.in_reply_to_user_id_str === accountId ||
      posts.has(tweet.in_reply_to_status_id_str) ||
      (Array.isArray(mentions) &&
        mentions.some((mention: ObjectValue) => mention?.id_str === accountId));
    const at = timestamp(tweet.created_at, now);
    if (!directed || !at) return;
    events.set(id, {
      eventId: id,
      threadId: id,
      postId: id,
      contactId: author,
      contactName: author,
      kind: "comment",
      text: tweet.full_text,
      at,
      replyAllowed: !node.limited_actions,
    });
  });
  if (!recognized) throw new SocialPlatformError("unsupported");
  return [...events.values()].sort((a, b) => a.at - b.at).slice(-100);
}

/** Legacy web DM evidence. Encrypted Chat payloads are deliberately not guessed. */
export function parseXBrowserInbox(
  raw: string,
  accountId: string,
  now = Date.now(),
): SocialInbound[] {
  if (!numericId(accountId)) throw new SocialPlatformError("denied");
  const value = decode(raw, now);
  const state = value.inbox_initial_state ?? value.inbox_timeline ?? value.inbox_updates;
  if (!state || !Array.isArray(state.entries)) throw new SocialPlatformError("unsupported");
  const events = new Map<string, SocialInbound>();
  for (const entry of state.entries.slice(0, 500)) {
    const message = entry.message;
    const data = message?.message_data;
    const id = data?.id ?? message?.id;
    const sender = data?.sender_id;
    const recipient = data?.recipient_id;
    const thread = message?.conversation_id;
    const at = timestamp(message?.time ?? data?.time, now);
    if (
      !numericId(id) ||
      !numericId(sender) ||
      recipient !== accountId ||
      sender === accountId ||
      typeof thread !== "string" ||
      !/^\d{1,25}-\d{1,25}$/.test(thread) ||
      !at ||
      typeof data.text !== "string" ||
      data.text.length > 10_000
    )
      continue;
    const participants = thread.split("-");
    if (!participants.includes(accountId) || !participants.includes(sender)) continue;
    events.set(id, {
      eventId: id,
      threadId: thread,
      contactId: sender,
      contactName: sender,
      kind: "message",
      text: data.text,
      at,
      replyAllowed: true,
    });
  }
  return [...events.values()].sort((a, b) => a.at - b.at).slice(-100);
}

export function parseXBrowserMessageSent(
  raw: string,
  senderId: string,
  recipientId: string,
  text: string,
  now = Date.now(),
): SocialSendResult {
  const value = decode(raw, now);
  const event = value.event;
  const message = event?.message_create;
  if (
    numericId(event?.id) &&
    message?.sender_id === senderId &&
    message?.target?.recipient_id === recipientId &&
    message?.message_data?.text === text
  )
    return { platformId: event.id };
  if (Array.isArray(value.entries)) {
    for (const entry of value.entries.slice(0, 100)) {
      const sent = entry?.message?.message_data;
      const id = sent?.id ?? entry?.message?.id;
      if (
        numericId(id) &&
        sent?.sender_id === senderId &&
        sent?.recipient_id === recipientId &&
        sent?.text === text
      )
        return { platformId: id };
    }
  }
  throw new SocialPlatformError("unknown");
}
