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
 * driver) invokes these exports directly. Selectors were checked against the live 2026-11 profile page
 * (Connect link, visible degree); the invitation dialog, the pending state and the accept card were
 * not observable without sending and are unverified.
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

/** The visible degree marker ("· 1.", "· 2. derece", "1st") of the profile top card. The page also
 * holds a hidden duplicate (sticky header) with another value, so only a rendered element counts. */
const DEGREE = String.raw`(() => {
  const main = document.querySelector('main');
  return main && [...main.querySelectorAll('p,span,.distance-badge,.dist-value')].find(el => el.getClientRects().length && !el.children.length &&
    /^(·\s*)?\d(st|nd|rd|th|\.)?(\s*derece)?$/.test((el.textContent || '').trim()));
})()`;

/** The Connect link of the exact profile: an anchor to /in/<slug>, so suggestion cards (buttons for
 * other members) never match. The long aria-label starts with the member's name; the text decides. */
const connectLinks = (slug: string) => String.raw`(() => {
  const main = document.querySelector('main');
  if (!main) return [];
  return [...main.querySelectorAll('a[href]')].filter(el => {
    try {
      const url = new URL(el.getAttribute('href'), location.origin);
      return el.getClientRects().length && !!el.closest('[data-view-name="edge-creation-connect-action"]') && url.origin === ${json(LI)} && url.pathname.replace(/\/$/, '').toLowerCase() === ${json(`/in/${slug}`)} &&
        /^(Connect|Bağlantı kur|Bağlan)$/.test((el.textContent || '').trim());
    } catch { return false; }
  });
})()`;

/** Marks the single visible Connect control on the exact profile; a 1st-degree profile has none. */
const PROFILE_CONNECT = (slug: string) => String.raw`(() => {
  if (location.origin !== ${json(LI)} || location.pathname.replace(/\/$/, '').toLowerCase() !== ${json(`/in/${slug}`)}) return false;
  const degree = ${DEGREE};
  if (!degree || /^(·\s*)?(1st|1\.?(\s*derece)?)$/.test(degree.textContent.trim())) return false;
  const links = ${connectLinks(slug)};
  if (links.length !== 1 || !(degree.compareDocumentPosition(links[0]) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
  document.querySelectorAll('[data-bycoda-li-connect]').forEach(el => el.removeAttribute('data-bycoda-li-connect'));
  links[0].setAttribute('data-bycoda-li-connect', 'true');
  return true;
})()`;

/** True once an invitation to this profile shows as pending and the Connect link is gone. */
const PENDING = (slug: string) => String.raw`(() => {
  if (location.origin !== ${json(LI)} || location.pathname.replace(/\/$/, '').toLowerCase() !== ${json(`/in/${slug}`)}) return false;
  if (${connectLinks(slug)}.length) return false;
  return [...document.querySelectorAll('main a,main button')].some(el => el.getClientRects().length &&
    /^(Pending|Beklemede)$/.test((el.textContent || '').trim()));
})()`;

/**
 * Marks the single accept control of the one invitation card that links only to this member. The
 * manager uses hashed classes without list semantics, so a card is the smallest ancestor of an
 * accept control that holds any member link; ambiguity (several members in it, or several matching
 * cards) rejects.
 */
const ACCEPT_CARD = (slug: string) => String.raw`(() => {
  if (location.origin !== ${json(LI)} || !location.pathname.startsWith('/mynetwork/invitation-manager')) return false;
  document.querySelectorAll('[data-bycoda-li-accept]').forEach(el => el.removeAttribute('data-bycoda-li-accept'));
  const slugOf = a => { try { const url = new URL(a.getAttribute('href'), location.origin);
    return url.origin === location.origin ? /^\/in\/([\w-]+)\/?$/.exec(url.pathname)?.[1]?.toLowerCase() : undefined; } catch { return undefined; } };
  const accepts = [...document.querySelectorAll('main button,main a[role="button"]')].filter(el => el.getClientRects().length && !el.disabled &&
    el.getAttribute('aria-disabled') !== 'true' && /^(Accept|Kabul et)$/.test((el.textContent || '').trim()));
  const mine = accepts.filter(button => {
    let card = button.parentElement;
    while (card && card.tagName !== 'MAIN' && ![...card.querySelectorAll('a[href]')].some(slugOf)) card = card.parentElement;
    if (!card || card.tagName === 'MAIN') return false;
    const members = new Set([...card.querySelectorAll('a[href]')].map(slugOf).filter(Boolean));
    return members.size === 1 && members.has(${json(slug)}) && [...card.querySelectorAll('button,a[role="button"]')].filter(el => accepts.includes(el)).length === 1;
  });
  if (mine.length !== 1) return false;
  mine[0].setAttribute('data-bycoda-li-accept', 'true');
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
  await click(ctx, 'dialog[open] button,[role="dialog"] button', "invite-note", [
    "Add a note",
    "Not ekle",
  ]);
  const field = await control(
    ctx,
    'dialog[open] textarea,[role="dialog"] textarea',
    "invite-note-field",
  );
  await ctx.verifyIdentity();
  await ctx.page.fill(field, note);
  const send = await control(ctx, 'dialog[open] button,[role="dialog"] button', "invite-send", [
    "Send invitation",
    "Send",
    "Gönder",
    "Davet gönder",
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
