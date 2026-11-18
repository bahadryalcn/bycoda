import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "../browser/challenge";
import { denied, json, unknown, unsupported } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";

export const TIKTOK_ORIGIN = "https://www.tiktok.com";
export const TIKTOK_WEB_ID = /^web:tiktok:([a-z0-9_][a-z0-9_.]{0,23})$/;

export function ownerHandle(ctx: BrowserRecipeContext): string {
  const handle = TIKTOK_WEB_ID.exec(ctx.account.platformId)?.[1];
  if (ctx.account.platform !== "tiktok" || ctx.account.connection !== "browser" || !handle)
    throw denied();
  return handle;
}

export async function assertNoTikTokChallenge(ctx: BrowserRecipeContext) {
  const hit = await detectChallenge(ctx.page);
  if (hit) throw needsHumanError(hit);
}

export async function verifyTikTokCreatorPage(ctx: BrowserRecipeContext) {
  await assertNoTikTokChallenge(ctx);
  await ctx.verifyIdentity();
  await assertNoTikTokChallenge(ctx);
}

export async function openTikTokCreatorPage(ctx: BrowserRecipeContext, path: string) {
  ownerHandle(ctx);
  await ctx.page.goto(`${TIKTOK_ORIGIN}${path}`);
  await verifyTikTokCreatorPage(ctx);
}

export function creatorExpression(path: string, body: string, origin = TIKTOK_ORIGIN): string {
  return String.raw`(() => {
    if (location.origin !== ${json(origin)} ||
        location.pathname.replace(/\/$/, '').toLowerCase() !== ${json(path.toLowerCase())}) return;
    const visible = el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !!el.getClientRects().length;
    const enabled = el => visible(el) && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true';
    const label = el => (el?.getAttribute('aria-label') || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const all = (root, selectors) => [...root.querySelectorAll(selectors)].filter(visible);
    const one = (root, selectors) => { const matches = all(root, selectors); return matches.length === 1 ? matches[0] : undefined; };
    const mark = (el, token) => {
      document.querySelectorAll('[data-bycoda-tiktok-creator]').forEach(node => node.removeAttribute('data-bycoda-tiktok-creator'));
      el.setAttribute('data-bycoda-tiktok-creator', token);
      return true;
    };
    ${body}
  })()`;
}

export const markedTikTokCreatorControl = (token: string) =>
  `[data-bycoda-tiktok-creator=${json(token)}]`;

export async function readTikTokCreatorPage<T>(ctx: BrowserRecipeContext, expression: string) {
  const snapshot = await ctx.waitFor<T>(expression, 12_000);
  await verifyTikTokCreatorPage(ctx);
  if (!snapshot) throw unsupported();
  return snapshot;
}

export async function submitTikTokCreatorAction<T>(
  ctx: BrowserRecipeContext,
  expression: string,
  token: string,
  acknowledge: () => Promise<T>,
  beforeSubmit?: () => Promise<void>,
): Promise<T> {
  await readTikTokCreatorPage<boolean>(ctx, expression);
  await (beforeSubmit ?? ctx.beforeSubmit)?.();
  await verifyTikTokCreatorPage(ctx);
  if (!(await ctx.page.evaluate<boolean>(expression))) throw unsupported();
  ctx.markSubmitted?.();
  try {
    await ctx.page.click(markedTikTokCreatorControl(token));
    return await acknowledge();
  } catch (error) {
    if (
      error instanceof SocialPlatformError &&
      error.detail?.reasonCode === "TIKTOK_PROFILE_COOLDOWN"
    )
      throw error;
    throw unknown();
  }
}
