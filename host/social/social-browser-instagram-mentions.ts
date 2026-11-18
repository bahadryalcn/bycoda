import type { InstagramBrowserMentions } from "../../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const INSTAGRAM = "https://www.instagram.com";
const NOTIFICATIONS = '[data-bycoda-instagram-notifications="true"]';

const findNotifications = String.raw`(() => {
  if (location.origin !== ${JSON.stringify(INSTAGRAM)}) return;
  const label = value => /^(Notifications|Bildirimler)$/i.test(value?.trim() || '');
  const controls = [...document.querySelectorAll('nav a,nav button,[role="navigation"] a,[role="navigation"] button')]
    .filter(el => el.getClientRects().length && (
      label(el.getAttribute('aria-label')) || label(el.textContent) ||
      el.getAttribute('href') === '/accounts/activity/'));
  if (controls.length !== 1) return;
  controls[0].setAttribute('data-bycoda-instagram-notifications', 'true');
  return true;
})()`;

const readNotifications = String.raw`(() => {
  if (location.origin !== ${JSON.stringify(INSTAGRAM)}) return;
  const visible = el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length;
  const label = value => /^(Notifications|Bildirimler)$/i.test(value?.trim() || '');
  const panels = [...document.querySelectorAll('main,aside,[role="dialog"],[role="region"]')]
    .filter(el => visible(el) && (label(el.getAttribute('aria-label')) ||
      [...el.querySelectorAll('h1,h2,h3,[role="heading"]')].some(h => visible(h) && label(h.textContent))));
  const innermost = panels.filter(panel => !panels.some(other => panel !== other && panel.contains(other)));
  if (innermost.length !== 1) return;
  const panel = innermost[0];
  const rows = [...panel.querySelectorAll('li,[role="listitem"],[role="row"]')].filter(visible).slice(0, 50);
  const empty = [...panel.querySelectorAll('p,[role="status"]')].some(el => visible(el) &&
    /^(No notifications(?: yet)?|Henüz bildirim yok|Bildirim yok)[.!]?$/i.test(el.textContent.trim()));
  if (!rows.length && !empty) return;
  const mentions = new Map();
  for (const row of rows) {
    const text = row.textContent.replace(/\s+/g, ' ').trim();
    if (!/\bmentioned you\b|senden bahsetti|seni etiketledi|tagged you/i.test(text)) continue;
    const paths = [...row.querySelectorAll('a[href]')].filter(visible).map(link => {
      try {
        const url = new URL(link.getAttribute('href'), location.origin);
        return url.origin === location.origin && !url.username && !url.password ? url.pathname : '';
      } catch { return ''; }
    });
    const post = paths.find(path => /^\/(?:p|reel|stories)\/[A-Za-z0-9_-]+(?:\/[0-9]+)?\/$/.test(path));
    if (!post) continue;
    const profile = paths.find(path => /^\/[A-Za-z0-9_][A-Za-z0-9._]{0,29}\/$/.test(path));
    const time = row.querySelector('time[datetime]');
    const at = time ? Date.parse(time.getAttribute('datetime')) : NaN;
    const url = location.origin + post;
    const username = profile?.slice(1, -1);
    mentions.set(url + '|' + (username || '') + '|' + text, {
      url, username, text: text.slice(0, 500), ...(Number.isFinite(at) && at > 0 ? { at } : {})
    });
  }
  return { mentions: [...mentions.values()], coverage: 'visible_notifications' };
})()`;

/** Reads the visible notification sample from the verified browser account. */
export async function instagramBrowserMentions(
  context: BrowserRecipeContext,
): Promise<InstagramBrowserMentions> {
  const verify = async () => {
    const challenge = await detectChallenge(context.page);
    if (challenge) throw needsHumanError(challenge);
    await context.verifyIdentity();
  };
  await context.page.goto(`${INSTAGRAM}/`);
  await verify();
  const ready = await context.waitFor<boolean>(findNotifications, 15_000);
  await verify();
  if (!ready) throw new SocialPlatformError("unsupported");
  await context.page.click(NOTIFICATIONS);
  const result = await context.waitFor<InstagramBrowserMentions>(readNotifications, 15_000);
  await verify();
  if (!result) throw new SocialPlatformError("unsupported");
  return result;
}
