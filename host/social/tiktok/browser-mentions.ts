import type { SocialInbound } from "../../../src/integrations/social/adapter";
import type { BrowserPollResult, BrowserRecipeContext } from "../social-browser-recipe";
import {
  guardTikTokEngagement,
  readTikTokSurface,
  requireTikTokBrowser,
  TIKTOK_DOM,
  TIKTOK_WEB,
  tiktokEngagementControl,
} from "./browser-engagement";

const NOTIFICATIONS_URL = `${TIKTOK_WEB}/tiktokstudio`;
const mentionsDom = String.raw`
  ${TIKTOK_DOM}
  if (!/^\/tiktokstudio(?:\/|$)/.test(location.pathname)) return;
  const tray = one('[data-e2e="studio-notifications"],[data-e2e="notifications-panel"]');
  const tab = tray && one('[data-e2e="notifications-mentions-tab"]', tray);
  const selected = tab && (tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('aria-pressed') === 'true');
`;

/** Only cards from the selected Mentions and tags filter are eligible for inbox ingestion. */
export async function tiktokMentions(ctx: BrowserRecipeContext): Promise<BrowserPollResult> {
  const owner = requireTikTokBrowser(ctx);
  await ctx.page.goto(NOTIFICATIONS_URL);
  await guardTikTokEngagement(ctx);
  // shortcut: Studio notification selectors are fixture-verified. Revalidate with a signed-in account.
  const state = await readTikTokSurface<"open" | "select" | "selected">(ctx, `(() => {
    ${mentionsDom}
    if (selected) return 'selected';
    if (mark(tab, 'mentions-tab')) return 'select';
    if (!tray && mark(one('button[data-e2e="studio-notifications-button"]'), 'mentions-open')) return 'open';
  })()`);
  if (state === "open") {
    await ctx.page.click(tiktokEngagementControl("mentions-open"));
    await readTikTokSurface(ctx, `(() => { ${mentionsDom} return mark(tab, 'mentions-tab'); })()`);
  }
  if (state !== "selected") await ctx.page.click(tiktokEngagementControl("mentions-tab"));
  const snapshot = await readTikTokSurface<{ events: SocialInbound[]; partial: boolean }>(ctx, String.raw`(() => {
    ${mentionsDom}
    if (!selected) return;
    const list = one('[data-e2e="notifications-mention-list"]', tray);
    if (!list || list.getAttribute('aria-busy') === 'true') return;
    const cards = all('[data-notification-id]', list);
    if (!cards.length && !one('[data-e2e="notifications-mentions-empty"]', list)) return;
    const mapped = cards.slice(0, 50).map(card => {
      const notification = card.getAttribute('data-notification-id');
      const author = one('a[data-e2e="notification-actor"][href]', card);
      const actor = handle(author?.getAttribute('href'));
      const content = one('a[data-e2e="notification-post"][href]', card);
      const url = sameOrigin(content?.getAttribute('href'));
      const post = /^\/@[\w.]{2,24}\/(?:video|photo)\/(\d{1,30})\/?$/.exec(url?.pathname || '')?.[1];
      const commentId = url?.searchParams.get('comment_id');
      const when = at(one('time[datetime]', card));
      const body = text(one('[data-e2e="notification-text"]', card));
      if (!id(notification) || !actor || !post || !body || !Number.isFinite(when) || when <= 0) return;
      if (actor === ${JSON.stringify(owner)}) return null;
      return { eventId: 'tiktok:mention:' + notification, threadId: id(commentId) ? commentId : notification,
        postId: post, contactId: 'web:tiktok:' + actor, contactName: text(author) || actor, text: body, kind: 'comment',
        at: when, replyAllowed: false };
    });
    if (cards.length && mapped.every(value => value === undefined)) return;
    return { events: mapped.filter(Boolean), partial: mapped.length !== cards.length ||
      mapped.some(value => value === undefined) || !!one('[data-e2e="notifications-next-page"]', tray) };
  })()`);
  return {
    events: [...new Map(snapshot.events.map((event) => [event.eventId, event])).values()],
    coverage: [{ channel: "mentions", status: snapshot.partial ? "partial" : "read" }],
  };
}
