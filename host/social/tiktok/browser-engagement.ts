import { detectChallenge, needsHumanError } from "../browser/challenge";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import { denied, unsupported } from "../social-browser-publishing-shared";

export const TIKTOK_WEB = "https://www.tiktok.com";
export const TIKTOK_ID = /^\d{1,30}$/;
export const TIKTOK_CONTACT = /^web:tiktok:([a-z0-9_.]{2,24})$/;

/** DOM-only helpers shared by the TikTok engagement surfaces. */
export const TIKTOK_DOM = String.raw`
  if (location.origin !== ${JSON.stringify(TIKTOK_WEB)}) return;
  const visible = el => !!el && el.isConnected && !!el.getClientRects().length &&
    !el.closest('[hidden],[aria-hidden="true"]') && getComputedStyle(el).visibility !== 'hidden';
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const one = (selector, root) => { const found = all(selector, root); return found.length === 1 ? found[0] : null; };
  const sameOrigin = href => { try { const u = new URL(href, location.origin); return u.origin === location.origin ? u : null; } catch { return null; } };
  const handle = href => /^\/@([\w.]{2,24})\/?$/.exec(sameOrigin(href)?.pathname || '')?.[1]?.toLowerCase();
  const text = el => (el?.innerText ?? el?.textContent ?? '').replace(/\r\n/g, '\n').trim();
  const at = el => Date.parse(el?.getAttribute('datetime') || '');
  const id = value => typeof value === 'string' && /^\d{1,30}$/.test(value);
  const ready = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
    !el.matches('input[type="password"],input[autocomplete="one-time-code"]');
  const mark = (el, token) => {
    if (!ready(el)) return false;
    document.querySelectorAll('[data-bycoda-tiktok-engagement]').forEach(target => target.removeAttribute('data-bycoda-tiktok-engagement'));
    el.setAttribute('data-bycoda-tiktok-engagement', token);
    return true;
  };
`;

export function requireTikTokBrowser(ctx: BrowserRecipeContext): string {
  const handle = TIKTOK_CONTACT.exec(ctx.account.platformId)?.[1];
  if (ctx.account.platform !== "tiktok" || ctx.account.connection !== "browser" || !handle)
    throw denied();
  return handle;
}

export async function guardTikTokEngagement(ctx: BrowserRecipeContext): Promise<void> {
  const hit = await detectChallenge(ctx.page);
  if (hit) throw needsHumanError(hit);
  await ctx.verifyIdentity();
}

export async function readTikTokSurface<T>(
  ctx: BrowserRecipeContext,
  expression: string,
): Promise<T> {
  const result = await ctx.waitFor<T>(expression, 12_000);
  await guardTikTokEngagement(ctx);
  if (result === undefined || result === null || result === false) throw unsupported();
  return result;
}

export const tiktokEngagementControl = (token: string) =>
  `[data-bycoda-tiktok-engagement=${JSON.stringify(token)}]`;
