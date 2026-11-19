import {
  click,
  type CommentRow,
  content,
  control,
  denied,
  files,
  fill,
  inputId,
  json,
  readJson,
  rowsToInbound,
  submitResponse,
  unknown,
  unsupported,
} from "./social-browser-publishing-shared";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import {
  type SocialInbound,
  SocialPlatformError,
  type SocialSendResult,
} from "../../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import { NEXT_OR_DONE_LABELS } from "./browser/ui-labels";
import {
  LINKEDIN_CAPTURE_FILE_INPUT,
  LINKEDIN_COMPOSER_EDITOR,
  LINKEDIN_POST_LABELS,
} from "./social-browser-linkedin-composer";
import {
  linkedInApplyImageAlt,
  linkedInImageAltEvidence,
  linkedInPublishDocument,
  linkedInStartMessage,
} from "./social-browser-linkedin-extended";
import type {
  BrowserIdentity,
  BrowserPollResult,
  BrowserRecipe,
  BrowserRecipeContext,
} from "./social-browser-recipe";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { guardLinkedInScreen } from "./social-browser-linkedin-guard";
import { linkedInMentions } from "./social-browser-linkedin-mentions";
import type { SocialMonitorChannel } from "../../src/features/social/model/social";
import { linkedInCommentaryIssue } from "../../src/integrations/social/linkedinMedia";
const LI = "https://www.linkedin.com";
/** The owner chooses a Page explicitly; an account label is never a Page-identity claim. */
export function linkedInBrowserConnectionUrl(account: SocialAccount, target?: string): string {
  if (account.accountType !== "organization") {
    if (target?.trim()) throw new Error("A LinkedIn member account does not accept a Page target.");
    return `${LI}/feed/`;
  }
  const saved = /^web:linkedin:company:([a-zA-Z0-9][a-zA-Z0-9-]{0,99})$/
    .exec(account.platformId)?.[1]
    .toLowerCase();
  let selected = target?.trim();
  if (selected?.includes("://")) {
    let url: URL;
    try {
      url = new URL(selected);
    } catch {
      throw new Error("Enter a LinkedIn Page ID or URL name.");
    }
    const match =
      /^\/company\/([a-zA-Z0-9][a-zA-Z0-9-]{0,99})(?:\/(?:admin(?:\/page-posts\/published)?)?)?\/?$/.exec(
        url.pathname,
      );
    if (
      url.origin !== LI ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !match
    )
      throw new Error(
        "Use this Page's LinkedIn ID, URL name or HTTPS company URL without query parameters.",
      );
    selected = match[1];
  }
  if (selected && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/.test(selected))
    throw new Error("Enter a LinkedIn Page ID or URL name.");
  selected = selected?.toLowerCase();
  if (saved && selected && saved !== selected)
    throw new Error("Use the previously verified LinkedIn Page for this account.");
  if (account.platformId && !saved)
    throw new Error(
      "This account has no verified LinkedIn Page browser identity. Use a separate browser account.",
    );
  const page = saved ?? selected;
  if (!page) throw new Error("Enter the LinkedIn Page ID or URL name before signing in.");
  return `${LI}/company/${page}/admin/page-posts/published/`;
}

/**
 * Create-post responses. The feed composer now submits through its server-driven UI request
 * (`CreatePost` on `/flagship-web/rsc-action/actions/server-request`); the Voyager paths remain for
 * Page admin surfaces. Only the response ID matters, and it is never the delivery evidence.
 */
export const LINKEDIN_CREATE_RESPONSE =
  /\/(?:voyager\/api\/(?:contentcreation\/normShares|graphql)|flagship-web\/rsc-action\/actions\/server-request)$/;
const LINKEDIN_POST_URN = /urn:li:(?:activity|share|ugcPost):\d+/g;

/** A recognized response's ID is only a candidate; send paths separately re-read persisted owner/text evidence. */
export function linkedInCreatedId(raw: string): string | undefined {
  const value = readJson(raw);
  const created = value?.value ?? value?.data?.value ?? value?.data?.data?.createContent?.value;
  const id =
    typeof created === "string"
      ? created
      : (created?.entityUrn ?? created?.updateUrn ?? created?.activityUrn);
  if (typeof id === "string" && /^urn:li:(?:activity|share|ugcPost):\d+$/.test(id)) return id;
  // The server-driven response is not a Voyager object: accept it only when it names exactly one post.
  const urns = new Set(raw.slice(0, 200_000).match(LINKEDIN_POST_URN));
  return urns.size === 1 ? [...urns][0] : undefined;
}

/**
 * Reads the signed-in member from LinkedIn's own `/voyager/api/me` with the page's session, so
 * identity survives feed markup changes. Only the public identifier and name leave the page.
 */
const LINKEDIN_ME = String.raw`(async () => {
  if (location.origin !== ${json(LI)} || /\/(login|checkpoint|signup|authwall)(\/|$)/.test(location.pathname)) return;
  const csrf = /(?:^|;\s*)JSESSIONID="?([^";]+)/.exec(document.cookie)?.[1];
  if (!csrf) return;
  const response = await fetch('/voyager/api/me', { credentials: 'include', headers: {
    'csrf-token': csrf, accept: 'application/vnd.linkedin.normalized+json+2.1', 'x-restli-protocol-version': '2.0.0' } });
  if (!response.ok) return;
  const body = await response.json();
  const urn = body?.data?.['*miniProfile'];
  const mini = (body?.included || []).find(item => item && item.entityUrn === urn);
  const slug = typeof mini?.publicIdentifier === 'string' ? mini.publicIdentifier : '';
  if (!urn || !/^[\w-]+$/.test(slug)) return;
  const name = [mini.firstName, mini.lastName].filter(part => typeof part === 'string' && part.trim()).join(' ').trim();
  return { platformId: 'web:linkedin:in:' + slug.toLowerCase(), name: name || slug };
})()`;

async function linkedInIdentity(
  page: BrowserPage,
  account?: SocialAccount,
): Promise<BrowserIdentity | undefined> {
  if (account?.accountType !== "organization") {
    const member = await page
      .evaluate<BrowserIdentity | undefined>(LINKEDIN_ME)
      .catch(() => undefined);
    if (member) return member;
  }
  const result = await page.evaluate<BrowserIdentity | undefined>(String.raw`(() => {
    if (location.origin !== ${json(LI)} || /\/(login|checkpoint|signup|authwall)(\/|$)/.test(location.pathname)) return;
    const organization = ${account?.accountType === "organization"};
    const selector = organization
      ? '.share-creation-state__member-info a[href*="/company/"],.share-box-feed-entry__avatar a[href*="/company/"],a[data-control-name="page_profile_photo"]'
      : 'a[data-control-name="identity_profile_photo"],.feed-identity-module__actor-meta a[href*="/in/"],.profile-rail-card__actor-link[href*="/in/"]';
    const links = [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length);
    const values = links.map(el => { try {
      const url = new URL(el.getAttribute('href'), location.origin);
      const match = (organization ? /^\/company\/([\w-]+)\/?$/ : /^\/in\/([\w-]+)\/?$/).exec(url.pathname);
      if (url.origin !== location.origin || !match) return null;
      const name = (el.getAttribute('aria-label') || el.querySelector('img')?.getAttribute('alt') || el.textContent || '').trim();
      return { platformId: 'web:linkedin:' + (organization ? 'company:' : 'in:') + match[1].toLowerCase(), name: name || match[1] };
    } catch { return null; } }).filter(Boolean);
    const unique = [...new Map(values.map(value => [value.platformId, value])).values()];
    return unique.length === 1 ? unique[0] : undefined;
  })()`);
  if (result || account?.accountType === "organization") return result;
  const menu = await page.evaluate<boolean>(String.raw`(() => {
    if(location.origin !== ${json(LI)} || /\/(login|checkpoint|signup|authwall)(\/|$)/.test(location.pathname)) return false;
    const buttons=[...document.querySelectorAll('button.global-nav__primary-link-me-menu-trigger')].filter(el=>el.getClientRects().length);
    if(buttons.length!==1) return false; buttons[0].setAttribute('data-bycoda-li-own-menu','true'); return true;
  })()`);
  if (!menu) return;
  await page.click('[data-bycoda-li-own-menu="true"]');
  try {
    return await page.evaluate<BrowserIdentity | undefined>(String.raw`(() => {
      const menu=document.querySelector('.global-nav__me-content,.global-nav__me-menu.artdeco-dropdown--is-open');
      if(!menu) return;
      const ids=[...menu.querySelectorAll('a[href*="/in/"]')].map(el=>{try{
        const url=new URL(el.getAttribute('href'),location.origin),slug=/^\/in\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
        return url.origin===${json(LI)} && slug ? {platformId:'web:linkedin:in:'+slug.toLowerCase(),name:(el.textContent||'').trim()||slug} : null;
      }catch{return null;}}).filter(Boolean);
      const unique=[...new Map(ids.map(id=>[id.platformId,id])).values()]; return unique.length===1 ? unique[0] : undefined;
    })()`);
  } finally {
    await page.click('[data-bycoda-li-own-menu="true"]').catch(() => undefined);
  }
}

const LINKEDIN_MEDIA_LABELS = ["Media", "Medya"] as const;
/** The stacked media editor is closed and the composer itself shows the attachment. */
const LINKEDIN_MEDIA_ATTACHED = `(() => { const open=document.querySelectorAll('dialog[open]'); return open.length===1&&!!open[0].querySelector('video,img[src^="blob:"]'); })()`;

async function linkedInPost(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  if (job.payload.media.some((item) => item.kind === "document"))
    return linkedInPublishDocument(ctx, job, job.payload.media[0]?.title ?? "");
  if (
    !content(job).trim() ||
    linkedInCommentaryIssue(job) ||
    ctx.files.length !== job.payload.media.length ||
    ctx.files.length > 4 ||
    ctx.files.some((item, index) => item.kind !== job.payload.media[index]?.kind) ||
    (ctx.files.some((item) => item.kind === "video") &&
      (ctx.files.length !== 1 || ctx.files[0].kind !== "video")) ||
    (job.payload.media.some((item) => item.alt?.trim()) && ctx.files.length !== 1)
  )
    throw unsupported();
  const company = /^web:linkedin:company:([\w-]+)$/.exec(ctx.account.platformId)?.[1];
  // A member's composer opens by LinkedIn's own `shareActive` link, which needs no feed markup.
  await ctx.page.goto(
    company
      ? `${LI}/company/${company}/admin/page-posts/published/`
      : `${LI}/feed/?shareActive=true`,
  );
  await ctx.verifyIdentity();
  if (company) await click(ctx, "button.share-box-feed-entry__trigger", "compose");
  if (ctx.files.length) {
    // The media button builds its file input on click and opens the native chooser through
    // `input.click()`; capture that input instead so no OS dialog appears, then fill it directly.
    await ctx.page.evaluate(LINKEDIN_CAPTURE_FILE_INPUT);
    await click(
      ctx,
      'dialog[open] button[aria-haspopup="dialog"]',
      "media-open",
      LINKEDIN_MEDIA_LABELS,
    );
    await files(
      ctx,
      `input[type="file"][data-bycoda-li-file][accept*="${ctx.files[0].kind === "video" ? "video" : "image"}"]`,
    );
    await linkedInApplyImageAlt(ctx, job.payload.media);
    // The media editor is a second dialog stacked on the composer; it is gone once the composer
    // shows the attachment preview.
    for (let step = 0; step < 2; step++) {
      if (await ctx.page.evaluate<boolean>(LINKEDIN_MEDIA_ATTACHED)) break;
      await click(ctx, "dialog[open] button", "media-next", NEXT_OR_DONE_LABELS);
      // The editor closes asynchronously; a second step is only needed when it stays open.
      if (await ctx.waitFor<boolean>(LINKEDIN_MEDIA_ATTACHED, 10_000)) break;
    }
    const ready = await ctx.waitFor<boolean>(
      String.raw`(() => {
      const labels=${json(LINKEDIN_POST_LABELS)};
      const submit=[...document.querySelectorAll('dialog[open] button')].find(el=>labels.includes((el.getAttribute('aria-label')||el.textContent||'').trim()));
      const dialog=submit&&submit.closest('dialog');
      if(!dialog || submit.disabled || document.querySelectorAll('dialog[open]').length!==1 || dialog.querySelector('[role="progressbar"],progress,.uploading,.processing')) return false;
      return [...dialog.querySelectorAll(${json(ctx.files[0].kind === "video" ? "video" : 'img[src^="blob:"]')})].length >= ${ctx.files.length};
    })()`,
      120_000,
    );
    if (!ready) throw unsupported();
  }
  await fill(ctx, LINKEDIN_COMPOSER_EDITOR, "post-text", content(job));
  const id = await submitResponse(
    ctx,
    LINKEDIN_CREATE_RESPONSE,
    linkedInCreatedId,
    "dialog[open] button",
    "publish",
    LINKEDIN_POST_LABELS,
  );
  // Reload the exact created resource: the composer and transient feed card are not delivery evidence.
  const url = `${LI}/feed/update/${encodeURIComponent(id)}/`;
  try {
    await ctx.page.goto(url);
    const persisted = await ctx.waitFor<boolean>(
      linkedInPostEvidence(
        id,
        ctx.account.platformId,
        content(job),
        ctx.files.map((item) => {
          if (item.kind === "document") throw unsupported();
          return item.kind;
        }),
      ),
      30_000,
    );
    if (!persisted) throw unknown();
    if (
      job.payload.media.some((item) => item.alt?.trim()) &&
      !(await ctx.waitFor<boolean>(linkedInImageAltEvidence(id, job.payload.media), 20_000))
    )
      throw unknown();
    await ctx.verifyIdentity();
    return { platformId: id, url };
  } catch {
    throw unknown();
  }
}

function linkedInPostEvidence(
  id: string,
  owner: string,
  text: string,
  media: ("image" | "video")[] = [],
): string {
  const path = owner
    .replace(/^web:linkedin:in:/, "/in/")
    .replace(/^web:linkedin:company:/, "/company/");
  return String.raw`(() => {
    const all = [...document.querySelectorAll('[data-urn]')].filter(row => /^urn:li:(?:activity|share|ugcPost):\d+$/.test(row.getAttribute('data-urn') || ''));
    // A share/ugcPost ID renders under its activity URN; the detail page of that exact URL holds one update.
    let path = ''; try { path = decodeURIComponent(location.pathname); } catch {}
    const rows = all.filter(row => row.getAttribute('data-urn') === ${json(id)}).concat(all.length === 1 && path.replace(/\/$/, '') === '/feed/update/' + ${json(id)} ? all : []);
    return rows.some(row => {
      const actor = row.querySelector('.update-components-actor__meta-link,.feed-shared-actor__container-link');
      const body = row.querySelector('.update-components-text,.feed-shared-update-v2__description');
      if (!actor || !body || body.textContent.trim() !== ${json(text)}) return false;
      try {
        if(new URL(actor.getAttribute('href'), location.origin).pathname.replace(/\/$/,'').toLowerCase() !== ${json(path)}) return false;
        const kinds=${json(media)};
        if(kinds.includes('video')) return [...row.querySelectorAll('video')].some(el=>{try{const url=new URL(el.currentSrc||el.getAttribute('src'));return (url.protocol==='blob:'||/(^|\.)licdn.com$/.test(url.hostname)) && el.readyState>=2;}catch{return false;}});
        if(kinds.length) return [...row.querySelectorAll('.update-components-image img,.feed-shared-image img')].filter(el=>{try{return /(^|\.)licdn.com$/.test(new URL(el.getAttribute('src')).hostname);}catch{return false;}}).length===kinds.length;
        return true;
      } catch { return false; }
    });
  })()`;
}

/** Comment rows are `article[data-id]` (replies nest inside their parent); the legacy item class stays as an alternative. */
const LINKEDIN_COMMENT_ROW = 'article[data-id^="urn:li:comment:"],.comments-comment-item';

function linkedInCommentSnapshot(postId: string): string {
  return String.raw`(() => {
    const list=document.querySelector('.comments-comments-list,.comments-comment-list');if(!list)return;
    const elements=[...list.querySelectorAll(${json(LINKEDIN_COMMENT_ROW)})].slice(0,100);
    // A post with no comments has no explicit marker. The positive signal is a loaded comment box next to a
    // content-free list and no comments item in the social counts (that item exists only when the count is above zero).
    const empty=()=>!!document.querySelector('[class*="comments-comment-box"]')&&!list.textContent.trim()&&
      !list.querySelector('a,button,img,article,[data-id],[class*="loader"],[class*="skeleton"]')&&
      !document.querySelector('.social-details-social-counts__comments');
    if(!elements.length&&!list.querySelector('.comments-comments-list__empty-state,.comments-empty-state,.comments-comment-list__empty-state')&&!empty())return;
    // The page shows only relative times; a comment ID is a LinkedIn snowflake whose upper bits are the creation time in ms.
    const stamp=(id,row)=>{
      const time=row.querySelector('time[datetime]'),iso=time&&Date.parse(time.getAttribute('datetime'));
      if(Number.isFinite(iso)&&iso>0) return iso;
      const raw=/,(\d{15,})\)$/.exec(id)?.[1]; if(!raw) return NaN;
      try{const at=Number(BigInt(raw)>>22n);return at>1e12&&at<Date.now()+864e5?at:NaN;}catch{return NaN;}
    };
    const rows=elements.map(row => {
      const id = row.getAttribute('data-id') || row.getAttribute('data-comment-urn');
      // Document order puts a comment's own header and body before its nested replies.
      // A Page or school comment has no member contact to attribute; it is skipped, not a parse failure.
      const first = row.querySelector('a[href*="/in/"],a[href*="/company/"],a[href*="/school/"],a[href*="/showcase/"]');
      try { if (first && /^\/(?:company|school|showcase)\//.test(new URL(first.getAttribute('href'),location.origin).pathname)) return 0; } catch { return null; }
      const actor = row.querySelector('.comments-post-meta__profile-link[href*="/in/"],a[href*="/in/"]');
      const text = row.querySelector('.comments-comment-item__main-content,.comments-comment-item-content-body');
      const at = stamp(id || '', row);
      if (!/^urn:li:comment:/.test(id || '') || !actor || !text || !Number.isFinite(at)) return null;
      let url; try { url = new URL(actor.getAttribute('href'),location.origin); } catch { return null; }
      const profile = /^\/in\/([\w-]+)\/?$/.exec(url.pathname);
      const name = (row.querySelector('.comments-comment-meta__description-title')?.textContent || actor.textContent || '').trim();
      return profile && url.origin === ${json(LI)} && at>0 ? { id, postId: ${json(postId)}, contactId:'web:linkedin:in:' + profile[1].toLowerCase(), name:name||profile[1], text:text.textContent.trim(), at } : null;
    });
    return rows.some(row=>row===null)?undefined:rows.filter(Boolean);
  })()`;
}

async function linkedInPoll(
  ctx: BrowserRecipeContext,
  posts: string[],
  cursor?: string,
): Promise<BrowserPollResult> {
  const valid = [
    ...new Set(posts.filter((id) => /^urn:li:(?:activity|share|ugcPost):\d+$/.test(id))),
  ];
  if (!valid.length) throw unsupported();
  const start = /^\d+$/.test(cursor ?? "") ? Number(cursor) % valid.length : 0;
  const events: SocialInbound[] = [];
  const count = Math.min(2, valid.length);
  for (let i = 0; i < count; i++) {
    const post = valid[(start + i) % valid.length];
    await ctx.page.goto(`${LI}/feed/update/${encodeURIComponent(post)}/`);
    await ctx.verifyIdentity();
    const rows = await ctx.waitFor<CommentRow[]>(linkedInCommentSnapshot(post), 20_000);
    if (!rows) throw unsupported();
    await ctx.verifyIdentity();
    events.push(...rowsToInbound(rows, ctx.account));
  }
  // shortcut: same partial-window rule as messages (see linkedInMessages).
  const complete = valid.length <= count;
  return {
    events,
    cursor: String((start + count) % valid.length),
    coverage: [
      complete
        ? { channel: "comments", status: "read" }
        : { channel: "comments", status: "unavailable", reason: "response_unavailable" },
    ],
  };
}

/** A reply targets a specific persisted comment; arbitrary actor/post IDs never become a selector. */
async function linkedInComment(
  ctx: BrowserRecipeContext,
  job: SocialJob,
): Promise<SocialSendResult> {
  if (job.payload.media.length || ctx.files.length) throw unsupported();
  const post = inputId(
    job.payload.objectPostId ?? job.payload.postId,
    /^urn:li:(?:activity|share|ugcPost):\d+$/,
  );
  if (job.kind === "reply") inputId(job.payload.threadId, /^urn:li:comment:[\w:(),-]+$/);
  await ctx.page.goto(`${LI}/feed/update/${encodeURIComponent(post)}/`);
  await ctx.verifyIdentity();
  const reply = job.kind === "reply";
  if (reply) {
    const marked = await ctx.waitFor<boolean>(
      String.raw`(() => {
      const rows = [...document.querySelectorAll(${json(LINKEDIN_COMMENT_ROW)})].filter(el => [el.getAttribute('data-id'),el.getAttribute('data-comment-urn')].includes(${json(job.payload.threadId)}));
      if(rows.length !== 1) return false;
      // The comment's own social bar precedes its nested replies' bars.
      const button = [...rows[0].querySelectorAll('button[class*="reply-action-button"]')].find(el => el.closest(${json(LINKEDIN_COMMENT_ROW)}) === rows[0]);
      if(!button) return false; button.setAttribute('data-bycoda-li-reply','true'); return true;
    })()`,
      20_000,
    );
    if (!marked) throw denied();
    await click(ctx, '[data-bycoda-li-reply="true"]', "reply");
  }
  // The reply box opens inside its comment; the post's own box is the only form outside every comment.
  const form = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const mine = [...document.querySelectorAll('form.comments-comment-box__form')].filter(el => ${reply} ? el.closest(${json(LINKEDIN_COMMENT_ROW)})?.getAttribute('data-id') === ${json(job.payload.threadId ?? "")} : !el.closest(${json(LINKEDIN_COMMENT_ROW)}));
    if(mine.length !== 1) return false;
    document.querySelectorAll('[data-bycoda-li-form]').forEach(el => el.removeAttribute('data-bycoda-li-form'));
    mine[0].setAttribute('data-bycoda-li-form','true'); return true;
  })()`,
    20_000,
  );
  if (!form) throw unsupported();
  // A fresh reply box starts with the generated @mention of the parent author, which the reply replaces.
  await fill(
    ctx,
    '[data-bycoda-li-form] .ql-editor[contenteditable="true"]',
    "comment-text",
    content(job),
    reply,
  );
  const before = await ctx.page.evaluate<string[]>(
    `[...document.querySelectorAll(${json(LINKEDIN_COMMENT_ROW)})].map(el => el.getAttribute('data-id') || el.getAttribute('data-comment-urn')).filter(Boolean)`,
  );
  const submit = await control(
    ctx,
    '[data-bycoda-li-form] button:not([type="button"])',
    "comment-submit",
  );
  await ctx.verifyIdentity();
  ctx.markSubmitted?.();
  try {
    await ctx.page.click(submit);
    // Reopen the post to exclude an optimistic composer echo. A persisted ID and author are mandatory.
    await ctx.page.goto(`${LI}/feed/update/${encodeURIComponent(post)}/`);
    const rows = await ctx.waitFor<CommentRow[]>(linkedInCommentSnapshot(post), 30_000);
    await ctx.verifyIdentity();
    const matches = rows?.filter(
      (row) =>
        !before.includes(row.id) &&
        row.contactId === ctx.account.platformId &&
        row.text === content(job) &&
        row.at >= ctx.now() - 60_000,
    );
    if (matches?.length !== 1) throw unknown();
    return {
      platformId: matches[0].id,
      url: `${LI}/feed/update/${encodeURIComponent(post)}/?commentUrn=${encodeURIComponent(matches[0].id)}`,
    };
  } catch {
    throw unknown();
  }
}

type WebChat = { id: string; href: string };
type WebChatMessage = { id: string; sender: string; text: string; at: number };
type WebConversation = { recipient: string; rows: WebChatMessage[] };

/** The inbox rows are click targets without hrefs; the thread ID only exists in the URL after opening one. */
const LINKEDIN_CHAT_LINKS =
  ".msg-conversations-container__conversations-list .msg-conversation-listitem__link";

function linkedInChatCountExpression(): string {
  return String.raw`(() => {
    const list=document.querySelector('.msg-conversations-container__conversations-list');
    if(!list) return;
    const count=[...list.querySelectorAll('.msg-conversation-listitem__link')].filter(el=>el.getClientRects().length).slice(0,100).length;
    return count || list.querySelector('.msg-conversations-container__empty-state') ? {count} : undefined;
  })()`;
}

const linkedInThreadUrl = (id: string) => `${LI}/messaging/thread/${id}/`;

/** Opens the inbox row at `index` and returns the thread it selected. The caller reloads that URL before reading. */
async function linkedInOpenChat(ctx: BrowserRecipeContext, index: number): Promise<WebChat> {
  const marked = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const el=[...document.querySelectorAll(${json(LINKEDIN_CHAT_LINKS)})].filter(el=>el.getClientRects().length)[${index}];
    if(!el) return false;
    document.querySelectorAll('[data-bycoda-li-chat]').forEach(old=>old.removeAttribute('data-bycoda-li-chat'));
    el.setAttribute('data-bycoda-li-chat','true'); return true;
  })()`,
    20_000,
  );
  if (!marked) throw unsupported();
  await click(ctx, '[data-bycoda-li-chat="true"]', "chat");
  const id = await ctx.waitFor<string>(
    String.raw`(() => {
    const el=document.querySelector('[data-bycoda-li-chat="true"]');
    if(!el||!/--active/.test(el.className)) return;
    try{return /^\/messaging\/thread\/([\w:(),=%-]+)\/?$/.exec(location.pathname)?.[1];}catch{return;}
  })()`,
    20_000,
  );
  let thread: string | undefined;
  try {
    thread = id && decodeURIComponent(id);
  } catch {
    // An undecodable ID is treated as an unrecognized screen below.
  }
  if (!thread || !/^[\w:(),=-]{4,200}$/.test(thread)) throw unsupported();
  return { id: thread, href: linkedInThreadUrl(thread) };
}

function linkedInConversationExpression(): string {
  return String.raw`(() => {
    const thread=document.querySelector('.msg-thread');
    if(!thread) return;
    const profiles=[...thread.querySelectorAll('.msg-thread__link-to-profile[href],.msg-entity-lockup__link[href]')].map(el=>{try{
      const url=new URL(el.getAttribute('href'),location.origin),slug=/^\/in\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
      return url.origin===${json(LI)} && slug ? 'web:linkedin:in:'+slug.toLowerCase() : null;
    }catch{return null;}}).filter(Boolean);
    const recipients=[...new Set(profiles)]; if(recipients.length!==1) return;
    const list=thread.querySelector('.msg-s-message-list'); if(!list) return;
    const elements=[...list.querySelectorAll('[data-event-urn]')].slice(-100);
    if(!elements.length && !list.querySelector('.msg-s-message-list__empty-state')) return;
    // The thread shows only clock times; the message ID embeds its creation time in ms.
    const stamp=(id,el)=>{
      const time=el.querySelector('time[datetime]'),iso=time&&Date.parse(time.getAttribute('datetime'));
      if(Number.isFinite(iso)&&iso>0) return iso;
      const raw=/,2-([\w+/=-]+)\)$/.exec(id)?.[1]; if(!raw) return NaN;
      try{const at=Number(/^\d{13}/.exec(atob(raw.replace(/-/g,'+').replace(/_/g,'/')))?.[0]);return at>1e12?at:NaN;}catch{return NaN;}
    };
    // Consecutive messages of one sender omit the profile link after the first.
    let lastSender;
    const rows=elements.map(el=>{
      const id=el.getAttribute('data-event-urn'),body=el.querySelector('.msg-s-event-listitem__body');
      const actor=el.querySelector('a[href*="/in/"]');
      let sender=lastSender;
      if(actor){try{
        const url=new URL(actor.getAttribute('href'),location.origin),slug=/^\/in\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
        sender=url.origin===${json(LI)} && slug ? 'web:linkedin:in:'+slug.toLowerCase() : undefined;
      }catch{sender=undefined;}}
      lastSender=sender;
      const at=stamp(id||'',el);
      if(!/^urn:li:(?:msg_message|fsd_message):[\w:(),=+/-]+$/.test(id||'')||!body||!sender||!Number.isFinite(at)||el.querySelector('.msg-s-event-listitem--pending'))return null;
      return {id,sender,text:body.textContent.trim(),at};
    }).filter(Boolean);
    return {recipient:recipients[0],rows};
  })()`;
}

async function linkedInMessages(
  ctx: BrowserRecipeContext,
  cursor?: string,
): Promise<BrowserPollResult> {
  if (ctx.account.accountType !== "member") throw unsupported();
  await ctx.page.goto(`${LI}/messaging/`);
  await ctx.verifyIdentity();
  const total = (await ctx.waitFor<{ count: number }>(linkedInChatCountExpression(), 30_000))
    ?.count;
  if (total === undefined) throw unsupported();
  if (!total) return { events: [], coverage: [{ channel: "messages", status: "read" }] };
  const start = /^\d+$/.test(cursor ?? "") ? Number(cursor) % total : 0,
    count = Math.min(2, total),
    events: SocialInbound[] = [];
  for (let i = 0; i < count; i++) {
    if (i) {
      await ctx.page.goto(`${LI}/messaging/`);
      await ctx.verifyIdentity();
      if (!(await ctx.waitFor(linkedInChatCountExpression(), 30_000))) throw unsupported();
    }
    const chat = await linkedInOpenChat(ctx, (start + i) % total);
    await ctx.page.goto(chat.href);
    await ctx.verifyIdentity();
    const conversation = await ctx.waitFor<WebConversation>(
      linkedInConversationExpression(),
      20_000,
    );
    if (!conversation) throw unsupported();
    await ctx.verifyIdentity();
    for (const row of conversation.rows) {
      if (
        row.sender !== conversation.recipient ||
        !row.text ||
        !Number.isFinite(row.at) ||
        row.at <= 0
      )
        continue;
      events.push({
        eventId: row.id,
        threadId: chat.id,
        contactId: conversation.recipient,
        contactName: conversation.recipient.slice("web:linkedin:in:".length),
        text: row.text,
        at: row.at,
        kind: "message",
      });
    }
  }
  // shortcut: coverage has no "partial" channel status yet; a bounded window is reported as
  // unavailable so the monitor status is "partial". Upgrade when the coverage model adds "partial".
  const complete = total <= count;
  return {
    events,
    cursor: String((start + count) % total),
    coverage: [
      complete
        ? { channel: "messages", status: "read" }
        : { channel: "messages", status: "unavailable", reason: "response_unavailable" },
    ],
  };
}

async function linkedInSendMessage(
  ctx: BrowserRecipeContext,
  job: SocialJob,
): Promise<SocialSendResult> {
  if (
    ctx.account.accountType !== "member" ||
    ctx.files.length ||
    job.payload.media.length ||
    !job.payload.text.trim()
  )
    throw unsupported();
  const thread = inputId(job.payload.threadId, /^[\w:(),=-]{4,200}$/),
    recipient = inputId(job.payload.recipientId, /^web:linkedin:in:[\w-]+$/),
    href = linkedInThreadUrl(thread);
  // The inbox rows carry no thread links; the validated ID addresses the conversation directly.
  await ctx.page.goto(href);
  await ctx.verifyIdentity();
  const before = await ctx.waitFor<WebConversation>(linkedInConversationExpression(), 20_000);
  if (before?.recipient !== recipient) throw denied();
  const draft = await ctx.page.evaluate<string | undefined>(
    `document.querySelector('.msg-form__contenteditable[contenteditable="true"]')?.textContent`,
  );
  if (draft?.trim()) throw denied();
  await fill(
    ctx,
    '.msg-form__contenteditable[contenteditable="true"]',
    "message-text",
    job.payload.text,
  );
  const button = await control(ctx, "button.msg-form__send-button", "message-submit"),
    at = ctx.now();
  // Identity failure before the mark is a refusal, not an uncertain delivery.
  await ctx.verifyIdentity();
  try {
    ctx.markSubmitted?.();
    await ctx.page.click(button);
    await ctx.page.goto(href);
    const after = await ctx.waitFor<WebConversation>(linkedInConversationExpression(), 30_000);
    await ctx.verifyIdentity();
    if (after?.recipient !== recipient) throw unknown();
    const rows = after.rows.filter(
      (row) =>
        row.sender === ctx.account.platformId &&
        row.text === job.payload.text &&
        row.at >= at - 60_000 &&
        !before.rows.some((old) => old.id === row.id),
    );
    if (rows.length !== 1) throw unknown();
    return { platformId: rows[0].id, url: href };
  } catch {
    throw unknown();
  }
}

async function linkedInAllPoll(
  ctx: BrowserRecipeContext,
  posts: string[],
  cursor?: string,
): Promise<BrowserPollResult> {
  const state = readJson(cursor ?? "{}") ?? {},
    events: SocialInbound[] = [],
    coverage: NonNullable<BrowserPollResult["coverage"]> = [];
  let commentCursor = String(state.comments ?? "0"),
    messageCursor = String(state.messages ?? "0"),
    read = 0;
  for (const channel of ["comments", "messages", "mentions"] as const) {
    if (channel !== "comments" && ctx.account.accountType !== "member") continue;
    try {
      const result =
        channel === "comments"
          ? await linkedInPoll(ctx, posts, commentCursor)
          : channel === "messages"
            ? await linkedInMessages(ctx, messageCursor)
            : await linkedInMentions(ctx);
      events.push(...result.events);
      const fallback: SocialMonitorChannel = { channel, status: "read" };
      coverage.push(...(result.coverage ?? [fallback]));
      read++;
      if (channel === "comments") commentCursor = result.cursor ?? commentCursor;
      else if (channel === "messages") messageCursor = result.cursor ?? messageCursor;
    } catch (error) {
      if (!(error instanceof SocialPlatformError) || error.code !== "unsupported") throw error;
      // An unrecognized page may be a checkpoint or captcha: escalate instead of reporting it as unavailable.
      const hit = await detectChallenge(ctx.page).catch(() => null);
      if (hit && hit.kind !== "login") throw needsHumanError(hit);
      coverage.push({ channel, status: "unavailable", reason: "response_unavailable" });
    }
  }
  if (!read) throw unsupported();
  return {
    events,
    coverage,
    cursor: JSON.stringify({ comments: commentCursor, messages: messageCursor }),
  };
}

const linkedInDispatch: BrowserRecipe = {
  platform: "linkedin",
  loginUrl: `${LI}/feed/`,
  connectionUrl: linkedInBrowserConnectionUrl,
  operations: [
    "publish",
    "media",
    "comments.read",
    "comment",
    "reply",
    "inbox.read",
    "message.reply",
    "message.start",
    "poll",
  ],
  identity: linkedInIdentity,
  send: (ctx, job) =>
    job.kind === "publish"
      ? linkedInPost(ctx, job)
      : job.kind === "message"
        ? job.payload.threadId
          ? linkedInSendMessage(ctx, job)
          : linkedInStartMessage(ctx, job)
        : job.kind === "reply" && !job.payload.postId && !job.payload.objectPostId
          ? linkedInSendMessage(ctx, job)
          : ["comment", "reply"].includes(job.kind)
            ? linkedInComment(ctx, job)
            : Promise.reject(unsupported()),
  poll: linkedInAllPoll,
};

export const linkedinBrowserRecipe: BrowserRecipe = {
  ...linkedInDispatch,
  send: async (ctx, job) => {
    // Pre-browser check: an over-limit commentary is a validation error, not an unexpected screen.
    if (linkedInCommentaryIssue(job)) throw unsupported();
    return guardLinkedInScreen(ctx, (guarded) => linkedInDispatch.send(guarded, job));
  },
};
