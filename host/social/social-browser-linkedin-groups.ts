import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { linkedInCommentaryIssue } from "../../src/integrations/social/linkedinMedia";
import {
  verifyLinkedInNetworkScreen,
  type LinkedInConnectionLimiter,
} from "./social-browser-linkedin-connections";
import { json } from "./social-browser-publishing-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const origin = "https://www.linkedin.com";
const groupsHome = "/groups/";
const groupIdentity = /^web:linkedin:group:([1-9]\d{0,19})$/;
const visible = String.raw`el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !!el.getClientRects().length`;

export type LinkedInGroup = { platformId: string; name: string; url: string };
export type LinkedInGroupsPage = { groups: LinkedInGroup[]; complete: false };
export type LinkedInGroupAction =
  | { kind: "join"; groupId: string }
  | { kind: "post"; groupId: string; text: string };
export type LinkedInGroupResult = {
  groupId: string;
  url: string;
  status: "joined" | "membership_pending" | "published" | "moderation_pending";
  platformId?: string;
};

function member(ctx: BrowserRecipeContext) {
  if (
    ctx.account.platform !== "linkedin" ||
    ctx.account.connection !== "browser" ||
    ctx.account.accountType !== "member" ||
    !/^web:linkedin:in:[\w-]{1,100}$/.test(ctx.account.platformId)
  )
    throw new SocialPlatformError("denied");
}

const human = (path: string) =>
  new SocialPlatformError("needs_human", undefined, { url: origin + path });

function onPath(path: string) {
  return `if (location.origin !== ${json(origin)} || location.pathname !== ${json(path)}) return;`;
}

export async function linkedInReadGroups(ctx: BrowserRecipeContext): Promise<LinkedInGroupsPage> {
  member(ctx);
  await ctx.page.goto(origin + groupsHome);
  await verifyLinkedInNetworkScreen(ctx);
  const groups = await ctx.waitFor<LinkedInGroup[]>(
    String.raw`(() => {
    ${onPath(groupsHome)}
    const visible = ${visible};
    const headings = [...document.querySelectorAll('main h1,main h2,[role="main"] h1,[role="main"] h2')].filter(el =>
      visible(el) && /^(Your groups|Gruplarınız)$/.test((el.textContent || '').trim()));
    const scope = headings.length === 1 ? headings[0].closest('section') : null;
    if (!scope) return;
    const groups = new Map();
    for (const el of scope.querySelectorAll('a[href]')) {
      if (!visible(el)) continue;
      const url = new URL(el.getAttribute('href'), location.origin);
      const id = url.origin === location.origin && /^\/groups\/([1-9]\d{0,19})\/?$/.exec(url.pathname)?.[1];
      const name = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (!id || !name || groups.has(id)) continue;
      groups.set(id, {platformId: 'web:linkedin:group:' + id, name, url: location.origin + '/groups/' + id + '/'});
      if (groups.size === 100) break;
    }
    if (!groups.size && ![...scope.querySelectorAll('p')].some(el =>
      visible(el) && /^(You haven.t joined any groups yet|Henüz hiçbir gruba katılmadınız)\.?$/i.test((el.textContent || '').trim()))) return;
    return [...groups.values()];
  })()`,
    20_000,
  );
  await verifyLinkedInNetworkScreen(ctx);
  if (!groups) throw human(groupsHome);
  return { groups, complete: false };
}

function groupControl(path: string, labels: string[], selector: string, token: string) {
  return String.raw`(() => {
    ${onPath(path)}
    const visible = ${visible};
    const controls = [...document.querySelectorAll(${json(selector)})].filter(el =>
      visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
      ${json(labels)}.includes((el.textContent || '').trim()));
    if (controls.length !== 1) return false;
    document.querySelectorAll('[data-bycoda-li-group]').forEach(el => el.removeAttribute('data-bycoda-li-group'));
    controls[0].setAttribute('data-bycoda-li-group', ${json(token)});
    return true;
  })()`;
}

async function groupPress(
  ctx: BrowserRecipeContext,
  path: string,
  labels: string[],
  selector: string,
) {
  if (!(await ctx.waitFor<boolean>(groupControl(path, labels, selector, "button"), 20_000)))
    throw human(path);
  return '[data-bycoda-li-group="button"]';
}

async function groupSubmit(
  ctx: BrowserRecipeContext,
  gate: LinkedInConnectionLimiter,
  id: string,
  target: string,
  result: () => Promise<LinkedInGroupResult>,
) {
  await verifyLinkedInNetworkScreen(ctx);
  await gate.beforeSubmit(ctx.account.id, id);
  await gate.record(ctx.account.id);
  ctx.markSubmitted?.();
  try {
    await ctx.page.click(target);
    const receipt = await result();
    await verifyLinkedInNetworkScreen(ctx);
    return receipt;
  } catch {
    throw new SocialPlatformError("unknown");
  }
}

const groupHeaderButtons = 'main header button,[role="main"] header button';

async function joinGroup(
  ctx: BrowserRecipeContext,
  id: string,
  path: string,
  gate: LinkedInConnectionLimiter,
) {
  const target = await groupPress(
    ctx,
    path,
    ["Request to join", "Katılma isteği gönder"],
    groupHeaderButtons,
  );
  return await groupSubmit(ctx, gate, id, target, async () => {
    const status = await ctx.waitFor<LinkedInGroupResult["status"]>(
      String.raw`(() => {
      ${onPath(path)}
      const visible = ${visible};
      const labels = [...document.querySelectorAll('main header button,[role="main"] header button')].filter(visible)
        .map(el => (el.textContent || '').trim());
      if (labels.some(label => ['Request to join','Katılma isteği gönder'].includes(label))) return;
      if (labels.some(label => ['Requested','Request pending','İstek gönderildi','İstek beklemede'].includes(label)))
        return 'membership_pending';
      if (labels.some(label => ['Leave group','Gruptan ayrıl'].includes(label))) return 'joined';
    })()`,
      30_000,
    );
    if (!status) throw new SocialPlatformError("unknown");
    return { groupId: id, url: origin + path, status };
  });
}

const modal = 'dialog[open],[role="dialog"][aria-modal="true"]';
const editorSelector = 'div[contenteditable="true"][role="textbox"]';
const groupTabs = 'main [role="tablist"],[role="main"] [role="tablist"]';
const groupPosts = 'main [data-urn][data-id],[role="main"] [data-urn][data-id]';
const activityId = /^urn:li:(?:activity|share|ugcPost):[1-9]\d{0,24}$/;

async function postInGroup(
  ctx: BrowserRecipeContext,
  id: string,
  path: string,
  text: string,
  gate: LinkedInConnectionLimiter,
) {
  const launch = await groupPress(
    ctx,
    path,
    ["Start a post", "Gönderi başlat"],
    'main button,[role="main"] button',
  );
  const before = await ctx.page.evaluate<string[]>(
    `[...document.querySelectorAll(${json(groupPosts)})].map(el => el.getAttribute('data-urn')).slice(0,200)`,
  );
  await verifyLinkedInNetworkScreen(ctx);
  await ctx.page.click(launch);
  const composer = (body: string) => String.raw`(() => {
    ${onPath(path)}
    const visible = ${visible};
    const dialogs = [...document.querySelectorAll(${json(modal)})].filter(visible);
    const dialog = dialogs.length === 1 ? dialogs[0] : null;
    if (!dialog || dialog.querySelector(${json(groupTabs)})) return;
    const editors = [...dialog.querySelectorAll(${json(editorSelector)})].filter(visible);
    if (editors.length !== 1) return;
    const field = editors[0];
    ${body}
  })()`;
  if (
    !(await ctx.waitFor<boolean>(
      composer(`
    if ((field.innerText || field.textContent || '').trim()) return;
    document.querySelectorAll('[data-bycoda-li-group-editor]').forEach(el => el.removeAttribute('data-bycoda-li-group-editor'));
    field.setAttribute('data-bycoda-li-group-editor','true'); return true;
  `),
      20_000,
    ))
  )
    throw human(path);
  await verifyLinkedInNetworkScreen(ctx);
  await ctx.page.fill('[data-bycoda-li-group-editor="true"]', text);
  const submit = await groupPress(
    ctx,
    path,
    ["Post", "Yayınla", "Paylaş"],
    'dialog[open] button,[role="dialog"][aria-modal="true"] button',
  );
  if (
    !(await ctx.page.evaluate<boolean>(
      composer(`
    return (field.innerText || field.textContent || '').trim() === ${json(text)};
  `),
    ))
  )
    throw human(path);
  return await groupSubmit(ctx, gate, id, submit, async () => {
    const receipt = await ctx.waitFor<string>(
      String.raw`(() => {
      ${onPath(path)}
      const visible = ${visible};
      const expected = ${json(text)}, previous = new Set(${json(before)});
      const rows = [...document.querySelectorAll(${json(groupPosts)})].filter(visible).filter(el => {
        const urn = el.getAttribute('data-urn') || '';
        const content = el.querySelector('.feed-shared-update-v2__description');
        const actor = el.querySelector('.update-components-actor__meta-link[href]');
        if (previous.has(urn) || !content || !actor || !${activityId}.test(urn)) return false;
        const url = new URL(actor.getAttribute('href'), location.origin);
        const slug = ${json(ctx.account.platformId.slice("web:linkedin:in:".length))};
        return url.origin === location.origin && url.pathname.replace(/\/$/,'').toLowerCase() === '/in/' + slug &&
          (content.innerText || content.textContent || '').trim() === expected;
      });
      if (rows.length === 1) return rows[0].getAttribute('data-urn');
    })()`,
      30_000,
    );
    if (!receipt || !activityId.test(receipt)) throw new SocialPlatformError("unknown");
    return { groupId: id, url: origin + path, status: "published", platformId: receipt };
  });
}

export async function linkedInGroupAction(
  ctx: BrowserRecipeContext,
  input: LinkedInGroupAction,
  gate: LinkedInConnectionLimiter,
): Promise<LinkedInGroupResult> {
  member(ctx);
  const group = groupIdentity.exec(input.groupId);
  if (!group) throw new SocialPlatformError("denied");
  if (input.kind !== "post" && input.kind !== "join") throw new SocialPlatformError("unsupported");
  const text = input.kind === "post" ? input.text?.trim() : undefined;
  if (
    input.kind === "post" &&
    (!text ||
      text.includes("\0") ||
      linkedInCommentaryIssue({ kind: "publish", payload: { text, media: [] } }))
  )
    throw new SocialPlatformError("rejected");
  const path = `${groupsHome}${group[1]}/`;
  await gate.reserve(ctx.account.id);
  await ctx.page.goto(origin + path);
  await verifyLinkedInNetworkScreen(ctx);
  return input.kind === "join"
    ? await joinGroup(ctx, input.groupId, path, gate)
    : await postInGroup(ctx, input.groupId, path, text!, gate);
}
