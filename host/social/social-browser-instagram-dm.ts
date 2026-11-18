import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import {
  instagramHandle,
  openInstagramRecipientProfile,
} from "./social-browser-instagram-audience";
import type { BrowserRecipeContext } from "./social-browser-recipe";

/** Opens Instagram's profile Message control. The caller still binds the thread
 * participants before preparing and submitting the approved message. */
export async function openInstagramDirectThread(
  context: BrowserRecipeContext,
  rawHandle: unknown,
  recipientId: string,
): Promise<string> {
  if (typeof rawHandle !== "string") throw new SocialPlatformError("unsupported");
  const handle = instagramHandle(rawHandle);
  if ((await openInstagramRecipientProfile(context, handle)) !== recipientId)
    throw new SocialPlatformError("denied");
  const marker = '[data-bycoda-instagram-direct="true"]';
  const path = JSON.stringify(`/${handle}/`);
  const verify = async () => {
    const challenge = await detectChallenge(context.page);
    if (challenge) throw needsHumanError(challenge);
    await context.verifyIdentity();
  };
  const control = await context.waitFor<boolean>(
    `(() => {
    if (location.origin !== 'https://www.instagram.com' || location.pathname.toLowerCase() !== ${path}) return;
    const visible = el => !!el.getClientRects().length;
    if ([...document.querySelectorAll('[role="dialog"]')].some(visible)) return;
    const headers = [...document.querySelectorAll('main header')].filter(visible);
    if (headers.length !== 1) return;
    const matches = [...headers[0].querySelectorAll('a,button,[role="button"]')].filter(el =>
      visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
      ['Message', 'Mesaj', 'Mesaj Gönder', 'Mesaj gönder'].includes(
        (el.getAttribute('aria-label') || el.textContent || '').trim()));
    if (matches.length !== 1) return;
    document.querySelectorAll('[data-bycoda-instagram-direct]').forEach(el => el.removeAttribute('data-bycoda-instagram-direct'));
    matches[0].setAttribute('data-bycoda-instagram-direct','true'); return true;
  })()`,
    15_000,
  );
  await verify();
  if (!control) throw new SocialPlatformError("unsupported");
  await context.page.click(marker);
  const threadId = await context.waitFor<string>(
    `(() => {
    if (location.origin !== 'https://www.instagram.com') return;
    return location.pathname.match(/^\\/direct\\/t\\/(\\d{1,30})\\/?$/)?.[1];
  })()`,
    20_000,
  );
  await verify();
  if (!threadId) throw new SocialPlatformError("unsupported");
  return threadId;
}
