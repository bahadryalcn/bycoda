import { SocialPlatformError, type SocialInbound } from "../../src/integrations/social/adapter";
import type { BrowserPollResult, BrowserRecipeContext } from "./social-browser-recipe";

const LI = "https://www.linkedin.com";
const MAX_CARDS = 50;

type MentionRow = {
  id: string;
  postId: string;
  contactId: string;
  name: string;
  text: string;
  at: number;
};

/**
 * Reads mention notifications from the visible notifications page. Selectors and the mention
 * wording are fixture-based and not verified against live LinkedIn. Returns undefined when the
 * list is not recognized, so the caller reports the channel as unavailable instead of empty.
 */
const MENTION_ROWS = String.raw`(() => {
  if (location.origin !== ${JSON.stringify(LI)} || !/^\/notifications\/?$/.test(location.pathname)) return;
  const cards = [...document.querySelectorAll('article.nt-card,.nt-card-list__item')]
    .filter(el => el.getClientRects().length).slice(0, ${MAX_CARDS});
  if (!cards.length && !document.querySelector('.nt-card-list__empty-state')) return;
  const rows = cards.map(card => {
    const text = ((card.querySelector('.nt-card__text,.nt-card__headline') || card).textContent || '').replace(/\s+/g, ' ').trim();
    if (!/\b(mentioned you|tagged you|sizi (?:etiketledi|andı))\b/i.test(text)) return null;
    const actor = card.querySelector('a[href*="/in/"]');
    const postId = [...card.querySelectorAll('a[href*="/feed/update/"]')]
      .map(link => /urn:li:(?:activity|share|ugcPost):\d+/.exec(decodeURIComponent(link.getAttribute('href') || '')))
      .map(match => match && match[0]).find(Boolean);
    const time = card.querySelector('time[datetime]');
    let slug;
    try { slug = /^\/in\/([\w-]+)\/?$/.exec(new URL(actor.getAttribute('href'), location.origin).pathname)?.[1]; } catch { slug = undefined; }
    const at = time ? Date.parse(time.getAttribute('datetime')) : NaN;
    return slug && postId && Number.isFinite(at) && at > 0
      ? { id: postId, postId, contactId: 'web:linkedin:in:' + slug.toLowerCase(), name: slug, text: text.slice(0, 1000), at }
      : null;
  });
  return rows.filter(Boolean);
})()`;

/**
 * Mention channel for member accounts. shortcut: reads only the first notifications page, so the
 * channel is reported as read for that page; older mentions are not covered.
 */
export async function linkedInMentions(ctx: BrowserRecipeContext): Promise<BrowserPollResult> {
  if (ctx.account.accountType !== "member") throw new SocialPlatformError("unsupported");
  await ctx.page.goto(`${LI}/notifications/`);
  await ctx.verifyIdentity();
  const rows = await ctx.waitFor<MentionRow[]>(MENTION_ROWS, 20_000);
  if (!rows) throw new SocialPlatformError("unsupported");
  await ctx.verifyIdentity();
  const events: SocialInbound[] = rows
    .filter((row) => row.id && row.contactId && row.text && Number.isFinite(row.at) && row.at > 0)
    .map((row) => ({
      eventId: `mention:${row.id}:${row.at}:${row.contactId}`,
      threadId: row.id,
      postId: row.postId,
      contactId: row.contactId,
      contactName: row.name,
      text: row.text,
      kind: "comment",
      at: row.at,
    }));
  return { events, coverage: [{ channel: "mentions", status: "read" }] };
}
