import type { SocialPlatform } from "../../../src/features/social/model/social";
import { accountCapabilities } from "../../../src/integrations/social/capabilities";
import type { SocialActionContext } from "../core/social-actions";
import { exact, str } from "../core/social-helpers";
import { findVisibleThread, loadInboxView } from "./inbox-threads";
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
  const view = await loadInboxView(ctx);
  const thread = findVisibleThread(view, str(input.threadId, "conversation"));
  const account = view.accountById.get(thread.accountId);
  if (!account) throw new Error("Conversation not found.");
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

/**
 * Every conversation event of one person, across all handles and channels the principal can read,
 * plus the person's stored interactions. Oldest first; the newest 200 are kept.
 */
export async function inboxTimeline(
  ctx: SocialActionContext,
  input: Record<string, unknown>,
): Promise<{ personId: string; events: InboxTimelineEvent[]; truncated: boolean }> {
  exact(input, ["personId"]);
  const personId = str(input.personId, "person");
  const person = await ctx.store.getPerson(personId);
  if (!person) throw new Error("Person not found.");
  const view = await loadInboxView(ctx);
  const events: InboxTimelineEvent[] = [];
  for (const thread of view.threads) {
    const contact = view.contactById.get(thread.contactId);
    const platform = view.accountById.get(thread.accountId)?.platform;
    if (!contact || !platform) continue;
    const onPerson = person.handles.some(
      (handle) => handle.accountId === thread.accountId && handle.platformId === contact.platformId,
    );
    if (!onPerson) continue;
    for (const event of thread.events)
      events.push({
        id: `thread:${thread.id}:${event.id}`,
        at: event.at,
        direction: event.direction,
        platform,
        accountId: thread.accountId,
        threadId: thread.id,
        kind: thread.kind,
        text: event.text,
      });
  }
  // Stored interactions can belong to accounts this principal cannot read; those are dropped.
  const seen = new Set(
    events.map((event) => `${event.accountId}|${event.direction}|${event.at}|${event.text}`),
  );
  for (const interaction of await ctx.store.listInteractions(personId)) {
    if (!view.accountById.has(interaction.accountId)) continue;
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
  return {
    personId,
    events: events.slice(-TIMELINE_LIMIT),
    truncated: events.length > TIMELINE_LIMIT,
  };
}
