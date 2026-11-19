import type { SocialPlatform } from "../../../src/features/social/model/social";
import { accountCapabilities } from "../../../src/integrations/social/capabilities";
import type { SocialActionContext } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import { loadPersonThreads, loadThread } from "./inbox-threads";
import type { InboxReplyOptions, InboxTimelineEvent } from "./inbox-types";

/** Platforms that only allow a free-form reply within 24 hours of the last inbound message. */
const REPLY_WINDOW_PLATFORMS: readonly SocialPlatform[] = ["facebook", "instagram", "whatsapp"];
const TIMELINE_LIMIT = 200;

/** Shared with the UI, which maps this code to its own copy. */
export const REPLY_WINDOW_EXPIRED = "window.expired";

/** Whether the owner can send a reply in this conversation, and if not, why. */
export async function inboxReplyOptions(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<InboxReplyOptions> {
  exact(input, ["threadId"]);
  const { thread, account } = await loadThread(ctx, str(input.threadId, "conversation"));
  if (thread.replyAllowed === false)
    return {
      canReply: false,
      reasonCode: "platform.reply_not_allowed",
      reason: "The platform does not allow replies to this conversation.",
    };
  const operation = thread.kind === "message" ? "message.reply" : "reply";
  const capability = accountCapabilities(account, ctx.now()).find(
    (item) => item.operation === operation,
  );
  if (capability?.status !== "available")
    return {
      canReply: false,
      reasonCode: capability?.reasonCode ?? "unknown",
      reason: capability?.reason ?? "This account cannot reply right now.",
    };
  if (
    thread.kind === "message" &&
    REPLY_WINDOW_PLATFORMS.includes(account.platform) &&
    thread.replyUntil !== undefined &&
    ctx.now() > thread.replyUntil
  )
    return {
      canReply: false,
      templatesOnly: true,
      reasonCode: REPLY_WINDOW_EXPIRED,
      reason: "24-hour window passed; only a template can be sent",
    };
  return { canReply: true };
}

/** Cursor = "<at>|<eventId>" of the oldest event the reader already holds, same format as inbox.unified. */
function parseTimelineCursor(value: unknown): { at: number; id: string } | undefined {
  if (value === undefined) return undefined;
  const text = str(value, "inbox cursor", 400);
  const separator = text.indexOf("|");
  const at = Number(text.slice(0, separator));
  if (separator < 1 || !Number.isSafeInteger(at)) throw new Error("Invalid inbox cursor.");
  return { at, id: str(text.slice(separator + 1), "inbox cursor", 300) };
}

/**
 * Every conversation event of one person, across all handles and channels the principal can read,
 * plus the person's stored interactions. Oldest first. One page is the newest 200 events, or the 200
 * before `cursor`; `next` is present only while older events remain, so the reader can stop at the start.
 */
export async function inboxTimeline(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<{ personId: string; events: InboxTimelineEvent[]; truncated: boolean; next?: string }> {
  exact(input, ["personId", "cursor"]);
  const personId = str(input.personId, "person");
  const cursor = parseTimelineCursor(input.cursor);
  const person = await ctx.store.getPerson(personId);
  if (!person) throw new Error("Person not found.");
  // Only this person's conversations are read, never every thread in the inbox.
  const accounts = await ctx.service.accounts(ctx.principal);
  const readableAccountIds = new Set(accounts.map((item) => item.id));
  const personThreads = await loadPersonThreads(ctx, accounts, person.handles);
  const events: InboxTimelineEvent[] = [];
  for (const { thread, account } of personThreads)
    for (const event of thread.events)
      events.push({
        id: `thread:${thread.id}:${event.id}`,
        at: event.at,
        direction: event.direction,
        platform: account.platform,
        accountId: thread.accountId,
        threadId: thread.id,
        kind: thread.kind,
        text: event.text,
      });
  // Stored interactions can belong to accounts this principal cannot read; those are dropped.
  const seen = new Set(
    events.map((event) => `${event.accountId}|${event.direction}|${event.at}|${event.text}`),
  );
  for (const interaction of await ctx.store.listInteractions(personId)) {
    if (!readableAccountIds.has(interaction.accountId)) continue;
    const text = interaction.text ?? "";
    if (seen.has(`${interaction.accountId}|${interaction.direction}|${interaction.at}|${text}`))
      continue;
    events.push({
      id: `interaction:${interaction.id}`,
      at: interaction.at,
      direction: interaction.direction,
      platform: interaction.platform,
      accountId: interaction.accountId,
      kind: "interaction",
      text,
    });
  }
  events.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // shortcut: every page re-reads the person's threads and filters in memory, output stays bounded at 200 events; upgrade to a SQL event window when one person's history is large.
  const older = cursor
    ? events.filter(
        (event) => event.at < cursor.at || (event.at === cursor.at && event.id < cursor.id),
      )
    : events;
  const page = older.slice(-TIMELINE_LIMIT);
  const oldest = page[0];
  const more = older.length > page.length;
  return {
    personId,
    events: page,
    truncated: more,
    ...(more && oldest ? { next: `${oldest.at}|${oldest.id}` } : {}),
  };
}
