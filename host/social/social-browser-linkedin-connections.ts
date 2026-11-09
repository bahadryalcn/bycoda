import {
  click,
  control,
  denied,
  json,
  unknown,
  unsupported,
} from "./social-browser-publishing-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";

/**
 * Connection invitations for a member browser connection. Not dispatched by the job system:
 * no SocialOperation exists for them yet, so a caller (audience action module or the layered
 * driver) invokes these exports directly. Invitation note limit and every selector are fixture-based
 * and not verified against live LinkedIn.
 */
const LI = "https://www.linkedin.com";
export const LINKEDIN_INVITE_NOTE_LIMIT = 300;

/** The caller supplies the daily/gap gate; BrowserSendLimiter satisfies it. */
export type LinkedInConnectionLimiter = {
  reserve(accountId: string): Promise<void>;
  record(accountId: string): Promise<void>;
};

export type LinkedInConnectionResult = { platformId: string; url: string };

function memberSlug(ctx: BrowserRecipeContext, recipientId: string): string {
  if (
    ctx.account.platform !== "linkedin" ||
    ctx.account.accountType !== "member" ||
    ctx.account.connection !== "browser"
  )
    throw denied();
  const match = /^web:linkedin:in:([\w-]{1,100})$/.exec(recipientId);
  if (!match || recipientId === ctx.account.platformId) throw denied();
  return match[1].toLowerCase();
}

/** Marks the single visible Connect control on the exact profile; a 1st-degree profile has none. */
const PROFILE_CONNECT = (slug: string) => String.raw`(() => {
  if (location.origin !== ${json(LI)} || location.pathname.replace(/\/$/, '').toLowerCase() !== ${json(`/in/${slug}`)}) return false;
  const main = document.querySelector('main');
  if (!main || !main.querySelector('h1')) return false;
  if ([...main.querySelectorAll('.distance-badge,.dist-value')].some(el => /^(1st|1\.|1\. derece)$/.test((el.textContent || '').trim()))) return false;
  const buttons = [...main.querySelectorAll('button')].filter(el => el.getClientRects().length && !el.disabled &&
    /^(Connect|Bağlan)\b/.test((el.getAttribute('aria-label') || el.textContent || '').trim()));
  if (buttons.length !== 1) return false;
  document.querySelectorAll('[data-bycoda-li-connect]').forEach(el => el.removeAttribute('data-bycoda-li-connect'));
  buttons[0].setAttribute('data-bycoda-li-connect', 'true');
  return true;
})()`;

/** True once an invitation to this profile shows as pending. */
const PENDING = (slug: string) => String.raw`(() => {
  if (location.origin !== ${json(LI)} || location.pathname.replace(/\/$/, '').toLowerCase() !== ${json(`/in/${slug}`)}) return false;
  return [...document.querySelectorAll('main button')].some(el => el.getClientRects().length &&
    /^(Pending|Beklemede)\b/.test((el.getAttribute('aria-label') || el.textContent || '').trim()));
})()`;

/** Marks the single accept control inside the one invitation card that links to this member. */
const ACCEPT_CARD = (slug: string) => String.raw`(() => {
  if (location.origin !== ${json(LI)}) return false;
  document.querySelectorAll('[data-bycoda-li-accept]').forEach(el => el.removeAttribute('data-bycoda-li-accept'));
  const links = [...document.querySelectorAll('a[href]')].filter(a => {
    try {
      const url = new URL(a.getAttribute('href'), location.origin);
      return url.origin === location.origin && url.pathname.replace(/\/$/, '').toLowerCase() === ${json(`/in/${slug}`)} && !!a.getClientRects().length;
    } catch { return false; }
  });
  const cards = [...new Set(links.map(a => a.closest('li,article,.invitation-card')).filter(Boolean))];
  if (cards.length !== 1) return false;
  const buttons = [...cards[0].querySelectorAll('button')].filter(el => el.getClientRects().length && !el.disabled &&
    /^(Accept|Kabul et)\b/.test((el.getAttribute('aria-label') || el.textContent || '').trim()));
  if (buttons.length !== 1) return false;
  buttons[0].setAttribute('data-bycoda-li-accept', 'true');
  return true;
})()`;

/** True once no invitation card for this member remains. */
const ACCEPTED = (slug: string) => String.raw`(() => {
  if (location.origin !== ${json(LI)}) return false;
  return ![...document.querySelectorAll('a[href]')].some(a => {
    try { return new URL(a.getAttribute('href'), location.origin).pathname.replace(/\/$/, '').toLowerCase() === ${json(`/in/${slug}`)}; }
    catch { return false; }
  });
})()`;

/**
 * Sends one invitation from a member profile. The limiter reserve runs before navigation; record
 * and the submit mark run immediately before the first click that can send.
 */
export async function linkedInSendConnectionRequest(
  ctx: BrowserRecipeContext,
  input: { recipientId: string; note?: string },
  limiter: LinkedInConnectionLimiter,
): Promise<LinkedInConnectionResult> {
  const slug = memberSlug(ctx, input.recipientId);
  const note = input.note?.trim() ?? "";
  if (note.length > LINKEDIN_INVITE_NOTE_LIMIT || note.includes("\0")) throw unsupported();
  await limiter.reserve(ctx.account.id);
  await ctx.page.goto(`${LI}/in/${slug}/`);
  await ctx.verifyIdentity();
  if (!(await ctx.waitFor<boolean>(PROFILE_CONNECT(slug), 20_000))) throw denied();
  const connect = '[data-bycoda-li-connect="true"]';
  if (!note) {
    // Without a note the Connect click itself is the external send.
    const target = await control(ctx, connect, "connect");
    await ctx.verifyIdentity();
    await limiter.record(ctx.account.id);
    ctx.markSubmitted?.();
    try {
      await ctx.page.click(target);
      if (!(await ctx.waitFor<boolean>(PENDING(slug), 30_000))) throw unknown();
      return { platformId: input.recipientId, url: `${LI}/in/${slug}/` };
    } catch {
      throw unknown();
    }
  }
  await click(ctx, connect, "connect");
  await click(ctx, '[role="dialog"] button', "invite-note", ["Add a note", "Not ekle"]);
  const field = await control(ctx, '[role="dialog"] textarea', "invite-note-field");
  await ctx.verifyIdentity();
  await ctx.page.fill(field, note);
  const send = await control(ctx, '[role="dialog"] button', "invite-send", [
    "Send invitation",
    "Send",
    "Gönder",
  ]);
  await ctx.verifyIdentity();
  await limiter.record(ctx.account.id);
  ctx.markSubmitted?.();
  try {
    await ctx.page.click(send);
    if (!(await ctx.waitFor<boolean>(PENDING(slug), 30_000))) throw unknown();
    return { platformId: input.recipientId, url: `${LI}/in/${slug}/` };
  } catch {
    throw unknown();
  }
}

/** Accepts one pending invitation from the invitation manager. Ambiguous or missing cards stop before any click. */
export async function linkedInAcceptInvitation(
  ctx: BrowserRecipeContext,
  input: { senderId: string },
  limiter: LinkedInConnectionLimiter,
): Promise<LinkedInConnectionResult> {
  const slug = memberSlug(ctx, input.senderId);
  await limiter.reserve(ctx.account.id);
  await ctx.page.goto(`${LI}/mynetwork/invitation-manager/`);
  await ctx.verifyIdentity();
  if (!(await ctx.waitFor<boolean>(ACCEPT_CARD(slug), 20_000))) throw unsupported();
  await ctx.verifyIdentity();
  await limiter.record(ctx.account.id);
  ctx.markSubmitted?.();
  try {
    await ctx.page.click('[data-bycoda-li-accept="true"]');
    if (!(await ctx.waitFor<boolean>(ACCEPTED(slug), 30_000))) throw unknown();
    return { platformId: input.senderId, url: `${LI}/in/${slug}/` };
  } catch {
    throw unknown();
  }
}
