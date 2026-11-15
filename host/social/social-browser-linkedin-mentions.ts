import { SocialPlatformError, type SocialInbound } from "../../src/integrations/social/adapter";
import type { BrowserPollResult, BrowserRecipeContext } from "./social-browser-recipe";

const LI = "https://www.linkedin.com";
const MAX_CARDS = 50;
const MENTIONS_PATH = "/notifications/?filter=mentions_all";

type MentionRow = {
  id: string;
  postId: string;
  contactId: string;
  name: string;
  text: string;
  at: number;
};

/**
 * Reads the notifications page filtered to "Bahsetmeler" (mentions), so every card there is a mention
 * and no wording is matched. Cards are `notification-card` blocks without layout boxes (display:
 * contents), the post is the `highlightedUpdateUrn` of a /feed/ link, and the time is only relative
 * ("2 saat"), so it is converted at read time. Returns undefined when the filter is not the active
 * one or the list is neither populated nor the empty state, so the caller reports the channel as
 * unavailable instead of empty.
 */
const MENTION_ROWS = String.raw`(() => {
  if (location.origin !== ${JSON.stringify(LI)} || !/^\/notifications\/?$/.test(location.pathname) ||
    new URLSearchParams(location.search).get('filter') !== 'mentions_all') return;
  const main = document.querySelector('main');
  if (!main) return;
  const active = [...main.querySelectorAll('[role="radio"][aria-checked="true"]')].map(el => (el.textContent || '').trim());
  if (active.length !== 1 || !/^(Bahsetmeler|Mentions)$/.test(active[0])) return;
  const cards = [...main.querySelectorAll('[data-view-name="notification-card"]')].slice(0, ${MAX_CARDS});
  const empty = [...main.querySelectorAll('h2,h3,p,span,div')].some(el => !el.children.length && el.getClientRects().length &&
    /^(Yeni bahsetme yok|No new mentions)$/i.test((el.textContent || '').trim()));
  if (!cards.length && !empty) return;
  const units = { s: 1e3, sn: 1e3, saniye: 1e3, min: 6e4, dakika: 6e4, dk: 6e4, h: 36e5, saat: 36e5, d: 864e5, gün: 864e5, w: 6048e5, hafta: 6048e5, hf: 6048e5, mo: 2592e6, ay: 2592e6, y: 31536e6, yr: 31536e6, yıl: 31536e6 };
  const now = Date.now();
  const rows = cards.map(card => {
    const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
    const actor = card.querySelector('a[href*="/in/"]');
    const postId = [...card.querySelectorAll('a[href*="/feed/"]')]
      .map(link => /urn:li:(?:activity|share|ugcPost):\d+/.exec(decodeURIComponent(link.getAttribute('href') || '')))
      .map(match => match && match[0]).find(Boolean);
    const time = card.querySelector('time[datetime]');
    const relative = [...card.querySelectorAll('span,p,time')].map(el => /^(\d+)\s*(sn|saniye|dakika|dk|saat|gün|hafta|hf|ay|yıl|mo|min|yr|s|m|h|d|w|y)\b/i.exec((el.textContent || '').trim())).find(Boolean);
    let slug;
    try { slug = /^\/in\/([\w-]+)\/?$/.exec(new URL(actor.getAttribute('href'), location.origin).pathname)?.[1]; } catch { slug = undefined; }
    const unit = relative && (relative[2].toLowerCase() === 'm' ? 6e4 : units[relative[2].toLowerCase()]);
    const at = time ? Date.parse(time.getAttribute('datetime')) : unit ? now - Number(relative[1]) * unit : now;
    return slug && postId && Number.isFinite(at) && at > 0
      ? { id: postId, postId, contactId: 'web:linkedin:in:' + slug.toLowerCase(), name: slug, text: text.slice(0, 1000), at }
      : null;
  });
  return rows.filter(Boolean);
})()`;

/**
 * Mention channel for member accounts. shortcut: reads only the first notifications page, so the
 * channel is reported as read for that page; older mentions are not covered. The event id omits the
 * time (it is estimated from relative text and changes between polls), so a second mention of the
 * same member in the same post is not a new event.
 */
export async function linkedInMentions(ctx: BrowserRecipeContext): Promise<BrowserPollResult> {
  if (ctx.account.accountType !== "member") throw new SocialPlatformError("unsupported");
  await ctx.page.goto(`${LI}${MENTIONS_PATH}`);
  await ctx.verifyIdentity();
  const rows = await ctx.waitFor<MentionRow[]>(MENTION_ROWS, 20_000);
  if (!rows) throw new SocialPlatformError("unsupported");
  await ctx.verifyIdentity();
  const events: SocialInbound[] = rows
    .filter((row) => row.id && row.contactId && row.text && Number.isFinite(row.at) && row.at > 0)
    .map((row) => ({
      eventId: `mention:${row.id}:${row.contactId}`,
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
