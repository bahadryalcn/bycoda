import type { CaptureSource, CollectedPerson } from "../../src/integrations/social/audience-types";
import { unsupported } from "./social-browser-publishing-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";
import { SNAP, snapchatChatsExpression, type SnapchatChat } from "./social-browser-snapchat";
import { unexpectedSnapchatScreen } from "./social-browser-snapchat-guard";

/**
 * Contacts of the signed-in member account's visible chat list (`dm_senders`). Other sources
 * (comments, followers, keywords) are not available from Snapchat in this adapter.
 * shortcut: the chat list has no message time, so `at` is the collection time; the chat list is
 * capped at 100 entries and has no pagination.
 */
export async function snapchatCollectAudience(
  ctx: BrowserRecipeContext,
  source: CaptureSource,
): Promise<{ people: CollectedPerson[] }> {
  if (source.kind !== "dm_senders" || ctx.account.accountType !== "member") throw unsupported();
  await ctx.page.goto(SNAP);
  await ctx.verifyIdentity();
  const chats = await ctx.waitFor<SnapchatChat[]>(snapchatChatsExpression(), 30_000);
  if (!chats) throw await unexpectedSnapchatScreen(ctx.page);
  const at = ctx.now();
  const seen = new Set<string>();
  const people: CollectedPerson[] = [];
  for (const chat of chats) {
    if (chat.recipient === ctx.account.platformId || seen.has(chat.recipient)) continue;
    seen.add(chat.recipient);
    const username = chat.recipient.slice("web:snapchat:".length);
    people.push({
      platformId: chat.recipient,
      name: username,
      username,
      profileUrl: `https://www.snapchat.com/add/${username}`,
      kind: "dm",
      ref: chat.threadId,
      at,
    });
  }
  await ctx.verifyIdentity();
  return { people };
}
