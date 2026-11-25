import { control, denied, json, unknown, unsupported } from "./social-browser-publishing-shared";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
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
  /** Recheck the exact approved target, current authority and single suppression gate. */
  beforeSubmit(accountId: string, targetId: string): Promise<void>;
  record(accountId: string): Promise<void>;
};

export type LinkedInConnectionResult = { platformId: string; url: string };
export type LinkedInNetworkList = "connections" | "invitations.received" | "invitations.sent";
export type LinkedInNetworkAction =
  | "invite"
  | "accept"
  | "ignore"
  | "withdraw"
  | "follow"
  | "unfollow";
export type LinkedInNetworkPage = {
  people: (LinkedInConnectionResult & { name: string })[];
  complete: false;
};

const connectionPaths: Record<LinkedInNetworkList, string> = {
  connections: "/mynetwork/invite-connect/connections/",
  "invitations.received": "/mynetwork/invitation-manager/",
  "invitations.sent": "/mynetwork/invitation-manager/sent/",
};

function memberBrowser(ctx: BrowserRecipeContext) {
  if (
    ctx.account.platform !== "linkedin" ||
    ctx.account.accountType !== "member" ||
    ctx.account.connection !== "browser"
  )
    throw denied();
}

function memberSlug(ctx: BrowserRecipeContext, recipientId: string): string {
  memberBrowser(ctx);
  const match = /^web:linkedin:in:([\w-]{1,100})$/.exec(recipientId);
  const slug = match?.[1].toLowerCase();
  if (
    !slug ||
    recipientId !== `web:linkedin:in:${slug}` ||
    recipientId === ctx.account.platformId.toLowerCase()
  )
    throw denied();
  return slug;
}

export async function verifyLinkedInNetworkScreen(ctx: BrowserRecipeContext) {
  const challenge = await detectChallenge(ctx.page);
  if (challenge) throw needsHumanError(challenge);
  await ctx.verifyIdentity();
}

async function submitNetworkAction(
  ctx: BrowserRecipeContext,
  limiter: LinkedInConnectionLimiter,
  target: string,
  selector: string,
  acknowledged: string,
): Promise<LinkedInConnectionResult> {
  await verifyLinkedInNetworkScreen(ctx);
  await limiter.beforeSubmit(ctx.account.id, target);
  await limiter.record(ctx.account.id);
  ctx.markSubmitted?.();
  try {
    await ctx.page.click(selector);
    if (!(await ctx.waitFor<boolean>(acknowledged, 30_000))) throw unknown();
    await verifyLinkedInNetworkScreen(ctx);
    return { platformId: target, url: `${LI}/in/${memberSlug(ctx, target)}/` };
  } catch {
    throw unknown();
  }
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
const invitationActions = {
  accept: ["Accept", "Kabul et"],
  ignore: ["Ignore", "Yoksay", "Yok say"],
  withdraw: ["Withdraw", "Geri çek"],
} as const;

const domMembers = String.raw`
  const visible = el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !!el.getClientRects().length;
  const slugOf = a => { try {
    const url = new URL(a.getAttribute('href'), location.origin);
    return url.origin === location.origin ? /^\/in\/([\w-]{1,100})\/?$/.exec(url.pathname)?.[1]?.toLowerCase() : undefined;
  } catch { return undefined; } };
  const label = el => String(el.textContent || '').replace(/\s+/g, ' ').trim();
  const active = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const inside = (root, selector) => [...root.querySelectorAll(selector)];
  const memberLinks = el => inside(el, 'a[href]').filter(a => visible(a) && slugOf(a));
  const subjects = button => {
    let card = button.parentElement;
    while (card && card.tagName !== 'MAIN') {
      const links = memberLinks(card);
      if (links.length) return links;
      card = card.parentElement;
    }
    return [];
  };
`;

function invitationCard(slug: string, kind: keyof typeof invitationActions, path: string) {
  return String.raw`(() => {
    if (location.origin !== ${json(LI)} || location.pathname !== ${json(path)}) return false;
    ${domMembers}
    const buttons = inside(document, 'main button,main a[role="button"]');
    const ours = buttons.filter(button => {
      if (!active(button) || !${json(invitationActions[kind])}.includes(label(button))) return false;
      const members = new Set(subjects(button).map(slugOf));
      return members.size === 1 && members.has(${json(slug)});
    });
    inside(document, '[data-bycoda-li-invitation]').forEach(el => el.removeAttribute('data-bycoda-li-invitation'));
    if (ours.length !== 1) return false;
    ours[0].setAttribute('data-bycoda-li-invitation', ${json(kind)});
    return true;
  })()`;
}

/** True once no invitation card for this member remains. */
const invitationRemoved = (slug: string, path: string) => String.raw`(() => {
  if (location.origin !== ${json(LI)} || location.pathname !== ${json(path)}) return false;
  ${domMembers}
  const main = document.querySelector('main');
  return !!main && visible(main) &&
    !memberLinks(main).some(link => slugOf(link) === ${json(slug)});
})()`;

export async function linkedInReadNetwork(
  ctx: BrowserRecipeContext,
  kind: LinkedInNetworkList,
): Promise<LinkedInNetworkPage> {
  memberBrowser(ctx);
  if (!Object.hasOwn(connectionPaths, kind)) throw unsupported();
  const path = connectionPaths[kind];
  await ctx.page.goto(LI + path);
  await verifyLinkedInNetworkScreen(ctx);
  const people = await ctx.waitFor<LinkedInNetworkPage["people"]>(
    String.raw`(() => {
    if (location.origin !== ${json(LI)} || location.pathname !== ${json(path)}) return;
    ${domMembers}
    const main = document.querySelector('main');
    if (!main || !visible(main)) return;
    const kind = ${json(kind)};
    const labels = kind === 'invitations.sent' ? ${json(invitationActions.withdraw)} : ${json(invitationActions.accept)};
    const buttons = inside(main, 'button,a[role="button"]').filter(button => active(button) && labels.includes(label(button)));
    const cards = inside(main, '.mn-connection-card,[data-view-name="connections-list-item"]').filter(visible);
    const links = kind === 'connections' ? cards.flatMap(memberLinks) : buttons.flatMap(button => {
      const one = subjects(button);
      return new Set(one.map(slugOf)).size === 1 ? one : [];
    });
    if (!links.length) {
      const empty = inside(main, 'h1,h2,h3,p').some(el => visible(el) &&
        /^(No pending invitations|No sent invitations|You don.t have any connections yet|Bekleyen davet yok|Gönderilen davet yok)$/i.test(label(el)));
      if (!empty) return;
    }
    const people = new Map();
    for (const link of links) {
      const slug = slugOf(link), name = label(link).slice(0, 160);
      const platformId = 'web:linkedin:in:' + slug;
      if (!slug || !name || platformId === ${json(ctx.account.platformId.toLowerCase())} || people.has(platformId)) continue;
      people.set(platformId, {platformId, name, url: location.origin + '/in/' + slug + '/'});
      if (people.size === 100) break;
    }
    if (links.length && !people.size) return;
    return [...people.values()];
  })()`,
    20_000,
  );
  await verifyLinkedInNetworkScreen(ctx);
  if (!people) throw new SocialPlatformError("needs_human", undefined, { url: LI + path });
  return { people, complete: false };
}

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
  // The first Connect click may send immediately on some profiles. Only the
  // owner can determine whether LinkedIn offers the note dialog for this target.
  if (note) throw new SocialPlatformError("needs_human", undefined, { url: `${LI}/in/${slug}/` });
  await limiter.reserve(ctx.account.id);
  await ctx.page.goto(`${LI}/in/${slug}/`);
  await verifyLinkedInNetworkScreen(ctx);
  if (!(await ctx.waitFor<boolean>(PROFILE_CONNECT(slug), 20_000))) throw denied();
  const connect = '[data-bycoda-li-connect="true"]';
  const target = await control(ctx, connect, "connect");
  return await submitNetworkAction(ctx, limiter, input.recipientId, target, PENDING(slug));
}

/** Accepts one pending invitation from the invitation manager. Ambiguous or missing cards stop before any click. */
export async function linkedInAcceptInvitation(
  ctx: BrowserRecipeContext,
  input: { senderId: string },
  limiter: LinkedInConnectionLimiter,
): Promise<LinkedInConnectionResult> {
  return await manageInvitation(ctx, "accept", input.senderId, limiter);
}

async function manageInvitation(
  ctx: BrowserRecipeContext,
  kind: keyof typeof invitationActions,
  target: string,
  limiter: LinkedInConnectionLimiter,
): Promise<LinkedInConnectionResult> {
  const slug = memberSlug(ctx, target);
  const path = connectionPaths[kind === "withdraw" ? "invitations.sent" : "invitations.received"];
  if (kind === "withdraw")
    throw new SocialPlatformError("needs_human", undefined, { url: LI + path });
  await limiter.reserve(ctx.account.id);
  await ctx.page.goto(LI + path);
  await verifyLinkedInNetworkScreen(ctx);
  if (!(await ctx.waitFor<boolean>(invitationCard(slug, kind, path), 20_000))) throw unsupported();
  const control = `[data-bycoda-li-invitation=${json(kind)}]`;
  return await submitNetworkAction(ctx, limiter, target, control, invitationRemoved(slug, path));
}

const followLabels = {
  follow: ["Follow", "Takip et"],
  unfollow: ["Unfollow", "Takibi bırak"],
  following: ["Following", "Takip ediliyor"],
} as const;

function followControl(slug: string, kind: keyof typeof followLabels, mark: boolean) {
  return String.raw`(() => {
    if (location.origin !== ${json(LI)} || ![${json(`/in/${slug}`)}, ${json(`/in/${slug}/`)}].includes(location.pathname.toLowerCase())) return false;
    ${domMembers}
    const headers = inside(document, 'main h1').filter(visible);
    const card = headers.length === 1 ? headers[0].closest('section') : null;
    if (!card) return false;
    const controls = inside(card, 'button,a[role="button"]').filter(el =>
      active(el) && ${json(followLabels[kind])}.includes(label(el)));
    if (controls.length !== 1) return false;
    if (${mark}) {
      inside(document, '[data-bycoda-li-follow]').forEach(el => el.removeAttribute('data-bycoda-li-follow'));
      controls[0].setAttribute('data-bycoda-li-follow', ${json(kind)});
    }
    return true;
  })()`;
}

export async function linkedInNetworkAction(
  ctx: BrowserRecipeContext,
  input: { kind: LinkedInNetworkAction; targetId: string },
  limiter: LinkedInConnectionLimiter,
): Promise<LinkedInConnectionResult> {
  const { kind, targetId } = input;
  if (kind === "invite")
    return await linkedInSendConnectionRequest(ctx, { recipientId: targetId }, limiter);
  if (kind === "accept" || kind === "ignore" || kind === "withdraw")
    return await manageInvitation(ctx, kind, targetId, limiter);
  if (kind !== "follow" && kind !== "unfollow") throw unsupported();
  const slug = memberSlug(ctx, targetId);
  await limiter.reserve(ctx.account.id);
  await ctx.page.goto(`${LI}/in/${slug}/`);
  await verifyLinkedInNetworkScreen(ctx);
  if (!(await ctx.waitFor<boolean>(followControl(slug, kind, true), 20_000)))
    throw new SocialPlatformError("needs_human", undefined, { url: `${LI}/in/${slug}/` });
  return await submitNetworkAction(
    ctx,
    limiter,
    targetId,
    `[data-bycoda-li-follow=${json(kind)}]`,
    followControl(slug, kind === "follow" ? "following" : "follow", false),
  );
}
