import type {
  SocialAccount,
  SocialJob,
  TikTokCreatorInfo,
} from "../src/features/social/model/social";
import {
  SocialPlatformError,
  type SocialInbound,
  type SocialSendResult,
} from "../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import {
  linkedInApplyImageAlt,
  linkedInImageAltEvidence,
  linkedInPublishDocument,
  linkedInStartMessage,
} from "./social-browser-linkedin-extended";
import {
  readSnapchatPublicProfileIdentity,
  selectSnapchatPublishDestination,
  verifySnapchatPublishDestination,
  snapchatUploaderSelectors,
} from "./social-browser-snapchat-extended";
import type {
  BrowserIdentity,
  BrowserPollResult,
  BrowserRecipe,
  BrowserRecipeContext,
} from "./social-browser-recipe";

const LI = "https://www.linkedin.com";
const YT = "https://studio.youtube.com";
const TT = "https://www.tiktok.com";
const SNAP = "https://web.snapchat.com";
const SNAP_UPLOAD = "https://my.snapchat.com";
const unsupported = () => new SocialPlatformError("unsupported");
const unknown = () => new SocialPlatformError("unknown");
const denied = () => new SocialPlatformError("denied");
const json = JSON.stringify;
const content = (job: SocialJob) => [job.payload.text, job.payload.link].filter(Boolean).join("\n");
const snapWebLocation = `((location.origin === ${json(SNAP)} && location.pathname === '/') || (location.origin === 'https://www.snapchat.com' && /^\\/web(?:\\/|$)/.test(location.pathname)))`;

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

/** Mark only a unique control. Ambiguous matches must never pick the first Post/Send button. */
async function control(
  ctx: BrowserRecipeContext,
  selector: string,
  token: string,
  labels?: readonly string[],
  hidden = false,
): Promise<string> {
  const marked = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const labels = ${json(labels ?? [])};
    const matches = [...document.querySelectorAll(${json(selector)})].filter(el =>
      (${hidden} || (el.getClientRects().length && !el.hidden)) &&
      !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
      (!labels.length || labels.includes((el.getAttribute('aria-label') || el.textContent || '').trim())));
    if (matches.length !== 1) return false;
    document.querySelectorAll('[data-bycoda-web-control]').forEach(el => el.removeAttribute('data-bycoda-web-control'));
    matches[0].setAttribute('data-bycoda-web-control', ${json(token)}); return true;
  })()`,
    20_000,
  );
  if (!marked) throw unsupported();
  return `[data-bycoda-web-control=${json(token)}]`;
}

async function click(
  ctx: BrowserRecipeContext,
  selector: string,
  token: string,
  labels?: readonly string[],
) {
  const target = await control(ctx, selector, token, labels);
  await ctx.verifyIdentity();
  await ctx.page.click(target);
}

async function fill(
  ctx: BrowserRecipeContext,
  selector: string,
  token: string,
  value: string,
  replaceGenerated = false,
) {
  const target = await control(ctx, selector, token);
  await ctx.verifyIdentity();
  const existing = await ctx.page.evaluate<string | undefined>(
    String.raw`(() => {const el=document.querySelector(${json(target)});return el?String(el.value??el.textContent??''):undefined;})()`,
  );
  if (existing === undefined || (!replaceGenerated && existing.trim() && existing !== value))
    throw denied();
  await ctx.page.fill(target, value);
}

async function files(ctx: BrowserRecipeContext, selector: string) {
  const target = await control(ctx, selector, "media", undefined, true);
  await ctx.verifyIdentity();
  await ctx.page.setFiles(
    target,
    ctx.files.map((item) => item.path),
  );
}

function inputId(value: string | undefined, expression: RegExp): string {
  if (!value || !expression.test(value)) throw denied();
  return value;
}

function readJson(raw: string): Record<string, any> | undefined {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A recognized response's ID is only a candidate; send paths separately re-read persisted owner/text evidence. */
export function linkedInCreatedId(raw: string): string | undefined {
  const value = readJson(raw);
  const created = value?.value ?? value?.data?.value ?? value?.data?.data?.createContent?.value;
  const id =
    typeof created === "string"
      ? created
      : (created?.entityUrn ?? created?.updateUrn ?? created?.activityUrn);
  return typeof id === "string" && /^urn:li:(?:activity|share|ugcPost):\d+$/.test(id)
    ? id
    : undefined;
}

async function submitResponse(
  ctx: BrowserRecipeContext,
  path: RegExp,
  parse: (raw: string) => string | undefined,
  selector: string,
  token: string,
  labels?: readonly string[],
): Promise<string> {
  const target = await control(ctx, selector, token, labels);
  const watcher = ctx.page.watchResponse(path, (raw) => !!parse(raw));
  let submitted = false;
  try {
    await ctx.verifyIdentity();
    // Never retry a click: even an exception can occur after the browser dispatched it.
    submitted = true;
    ctx.markSubmitted?.();
    await ctx.page.click(target);
    const raw = await watcher.body(30_000);
    const id = raw && parse(raw);
    if (!id) throw unknown();
    await ctx.verifyIdentity();
    return id;
  } catch (error) {
    if (submitted) throw unknown();
    throw error;
  } finally {
    watcher.stop();
  }
}

async function linkedInIdentity(
  page: BrowserPage,
  account?: SocialAccount,
): Promise<BrowserIdentity | undefined> {
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

async function linkedInPost(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  if (job.payload.media.some((item) => item.kind === "document"))
    return linkedInPublishDocument(ctx, job, job.payload.media[0]?.title ?? "");
  if (
    !content(job).trim() ||
    ctx.files.length !== job.payload.media.length ||
    ctx.files.length > 4 ||
    ctx.files.some((item, index) => item.kind !== job.payload.media[index]?.kind) ||
    (ctx.files.some((item) => item.kind === "video") &&
      (ctx.files.length !== 1 || ctx.files[0].kind !== "video")) ||
    (job.payload.media.some((item) => item.alt?.trim()) && ctx.files.length !== 1)
  )
    throw unsupported();
  const company = /^web:linkedin:company:([\w-]+)$/.exec(ctx.account.platformId)?.[1];
  await ctx.page.goto(
    company ? `${LI}/company/${company}/admin/page-posts/published/` : `${LI}/feed/`,
  );
  await ctx.verifyIdentity();
  await click(ctx, "button.share-box-feed-entry__trigger", "compose");
  if (ctx.files.length) {
    await files(
      ctx,
      ctx.files[0].kind === "video"
        ? '[role="dialog"] input[type="file"][accept*="video"]'
        : '[role="dialog"] input[type="file"][accept*="image"]',
    );
    await linkedInApplyImageAlt(ctx, job.payload.media);
    for (let step = 0; step < 2; step++) {
      if (
        await ctx.page.evaluate<boolean>(
          `!!document.querySelector('[role="dialog"] .ql-editor[contenteditable="true"]')`,
        )
      )
        break;
      await click(ctx, '[role="dialog"] button.artdeco-button--primary', "media-next", [
        "Next",
        "Done",
        "İleri",
        "Bitti",
      ]);
    }
    const ready = await ctx.waitFor<boolean>(
      String.raw`(() => {
      const dialog=document.querySelector('[role="dialog"]');
      if(!dialog || dialog.querySelector('[role="progressbar"],.uploading,.processing')) return false;
      return [...dialog.querySelectorAll(${json(ctx.files[0].kind === "video" ? "video" : 'img[src^="blob:"]')})].length >= ${ctx.files.length};
    })()`,
      120_000,
    );
    if (!ready) throw unsupported();
  }
  await fill(ctx, '[role="dialog"] .ql-editor[contenteditable="true"]', "post-text", content(job));
  const id = await submitResponse(
    ctx,
    /\/voyager\/api\/(?:contentcreation\/normShares|graphql)$/,
    linkedInCreatedId,
    '[role="dialog"] button.share-actions__primary-action',
    "publish",
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
    const rows = [...document.querySelectorAll('[data-urn],article')].filter(row => row.getAttribute('data-urn') === ${json(id)});
    return rows.some(row => {
      const actor = row.querySelector('.update-components-actor__meta-link,.feed-shared-actor__container-link');
      const body = row.querySelector('.update-components-text,.feed-shared-update-v2__description');
      if (!actor || !body || body.textContent.trim() !== ${json(text)}) return false;
      try {
        if(new URL(actor.getAttribute('href'), location.origin).pathname.replace(/\/$/,'').toLowerCase() !== ${json(path)}) return false;
        const kinds=${json(media)};
        if(kinds.includes('video')) return [...row.querySelectorAll('video')].some(el=>{try{const url=new URL(el.currentSrc||el.getAttribute('src'));return /(^|\.)licdn.com$/.test(url.hostname) && el.readyState>=2;}catch{return false;}});
        if(kinds.length) return [...row.querySelectorAll('.update-components-image img,.feed-shared-image img')].filter(el=>{try{return /(^|\.)licdn.com$/.test(new URL(el.getAttribute('src')).hostname);}catch{return false;}}).length===kinds.length;
        return true;
      } catch { return false; }
    });
  })()`;
}

type CommentRow = {
  id: string;
  postId: string;
  contactId: string;
  name: string;
  text: string;
  at: number;
  parent?: string;
};
function rowsToInbound(rows: CommentRow[], account: SocialAccount): SocialInbound[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (
        !row ||
        !row.id ||
        !row.postId ||
        !row.contactId ||
        !row.text ||
        !Number.isFinite(row.at) ||
        row.at <= 0 ||
        row.contactId === account.platformId ||
        seen.has(row.id)
      )
        return false;
      seen.add(row.id);
      return true;
    })
    .slice(0, 100)
    .map((row) => ({
      eventId: row.id,
      threadId: row.id,
      postId: row.postId,
      contactId: row.contactId,
      contactName: row.name,
      text: row.text,
      kind: "comment",
      at: row.at,
    }));
}

function linkedInCommentSnapshot(postId: string): string {
  return String.raw`(() => {
    const list=document.querySelector('.comments-comments-list,.comments-comment-list');if(!list)return;
    const elements=[...list.querySelectorAll('.comments-comment-item')].slice(0,100);
    if(!elements.length&&!list.querySelector('.comments-comments-list__empty-state,.comments-empty-state,.comments-comment-list__empty-state'))return;
    const rows=elements.map(row => {
      const id = row.getAttribute('data-id') || row.getAttribute('data-comment-urn');
      const actor = row.querySelector('.comments-post-meta__profile-link[href*="/in/"]');
      const text = row.querySelector('.comments-comment-item__main-content,.comments-comment-item-content-body');
      const time = row.querySelector('time[datetime]');
      if (!/^urn:li:comment:/.test(id || '') || !actor || !text || !time) return null;
      let url; try { url = new URL(actor.getAttribute('href'),location.origin); } catch { return null; }
      const profile = /^\/in\/([\w-]+)\/?$/.exec(url.pathname);
      const at=Date.parse(time.getAttribute('datetime'));
      return profile && url.origin === ${json(LI)} && Number.isFinite(at) && at>0 ? { id, postId: ${json(postId)}, contactId:'web:linkedin:in:' + profile[1].toLowerCase(), name:actor.textContent.trim(), text:text.textContent.trim(), at } : null;
    });
    return rows.some(row=>!row)?undefined:rows;
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
  return {
    events,
    cursor: String((start + count) % valid.length),
    coverage: [{ channel: "comments", status: "read" }],
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
  if (job.kind === "reply") {
    const marked = await ctx.waitFor<boolean>(
      String.raw`(() => {
      const rows = [...document.querySelectorAll('.comments-comment-item')].filter(el => [el.getAttribute('data-id'),el.getAttribute('data-comment-urn')].includes(${json(job.payload.threadId)}));
      if(rows.length !== 1) return false;
      const button = rows[0].querySelector('button.comments-comment-social-bar__reply-action-button');
      if(!button) return false; button.setAttribute('data-bycoda-li-reply','true'); return true;
    })()`,
      20_000,
    );
    if (!marked) throw denied();
    await click(ctx, '[data-bycoda-li-reply="true"]', "reply");
  }
  await fill(
    ctx,
    '.comments-comment-box .ql-editor[contenteditable="true"]',
    "comment-text",
    content(job),
  );
  const before = await ctx.page.evaluate<string[]>(
    `[...document.querySelectorAll('.comments-comment-item')].map(el => el.getAttribute('data-id') || el.getAttribute('data-comment-urn')).filter(Boolean)`,
  );
  const submit = await control(ctx, "button.comments-comment-box__submit-button", "comment-submit");
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

function linkedInChatsExpression(): string {
  return String.raw`(() => {
    const list=document.querySelector('.msg-conversations-container__conversations-list,.msg-conversations-container');
    if(!list) return;
    const chats=[...list.querySelectorAll('a.msg-conversation-listitem__link[href]')].slice(0,100).map(el=>{try{
      const url=new URL(el.getAttribute('href'),location.origin),id=/^\/messaging\/thread\/([\w:(),-]+)\/?$/.exec(url.pathname)?.[1];
      return url.origin===${json(LI)} && id ? {id,href:url.origin+url.pathname} : null;
    }catch{return null;}}).filter(Boolean);
    return chats.length || list.querySelector('.msg-conversations-container__empty-state') ? chats : undefined;
  })()`;
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
    const rows=elements.map(el=>{
      const id=el.getAttribute('data-event-urn'),body=el.querySelector('.msg-s-event-listitem__body');
      const group=el.closest('.msg-s-message-group')||el;
      const actor=group.querySelector('a.msg-s-message-group__profile-link[href]');
      const time=el.querySelector('time[datetime]')||group.querySelector('time[datetime]');
      if(!/^urn:li:(?:msg_message|fsd_message):[\w:(),-]+$/.test(id||'')||!body||!actor||!time||el.querySelector('.msg-s-event-listitem--pending'))return null;
      try{
        const url=new URL(actor.getAttribute('href'),location.origin),slug=/^\/in\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
        return url.origin===${json(LI)} && slug ? {id,sender:'web:linkedin:in:'+slug.toLowerCase(),text:body.textContent.trim(),at:Date.parse(time.getAttribute('datetime'))} : null;
      }catch{return null;}
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
  const chats = await ctx.waitFor<WebChat[]>(linkedInChatsExpression(), 30_000);
  if (!chats) throw unsupported();
  if (!chats.length) return { events: [], coverage: [{ channel: "messages", status: "read" }] };
  const start = /^\d+$/.test(cursor ?? "") ? Number(cursor) % chats.length : 0,
    count = Math.min(2, chats.length),
    events: SocialInbound[] = [];
  for (let i = 0; i < count; i++) {
    const chat = chats[(start + i) % chats.length];
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
  return {
    events,
    cursor: String((start + count) % chats.length),
    coverage: [{ channel: "messages", status: "read" }],
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
  const thread = inputId(job.payload.threadId, /^[\w:(),-]{4,200}$/),
    recipient = inputId(job.payload.recipientId, /^web:linkedin:in:[\w-]+$/);
  await ctx.page.goto(`${LI}/messaging/`);
  await ctx.verifyIdentity();
  const chats = await ctx.waitFor<WebChat[]>(linkedInChatsExpression(), 30_000),
    matching = chats?.filter((chat) => chat.id === thread);
  if (matching?.length !== 1) throw denied();
  await ctx.page.goto(matching[0].href);
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
  try {
    await ctx.verifyIdentity();
    ctx.markSubmitted?.();
    await ctx.page.click(button);
    await ctx.page.goto(matching[0].href);
    const after = await ctx.waitFor<WebConversation>(linkedInConversationExpression(), 30_000);
    await ctx.verifyIdentity();
    if (after?.recipient !== recipient) throw unknown();
    const rows = after.rows.filter(
      (row) =>
        row.sender === ctx.account.platformId &&
        row.text === job.payload.text &&
        row.at >= at - 5000 &&
        !before.rows.some((old) => old.id === row.id),
    );
    if (rows.length !== 1) throw unknown();
    return { platformId: rows[0].id, url: matching[0].href };
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
  for (const channel of ["comments", "messages"] as const) {
    if (channel === "messages" && ctx.account.accountType !== "member") continue;
    try {
      const result =
        channel === "comments"
          ? await linkedInPoll(ctx, posts, commentCursor)
          : await linkedInMessages(ctx, messageCursor);
      events.push(...result.events);
      coverage.push({ channel, status: "read" });
      read++;
      if (channel === "comments") commentCursor = result.cursor ?? commentCursor;
      else messageCursor = result.cursor ?? messageCursor;
    } catch (error) {
      if (error instanceof SocialPlatformError && error.code === "unsupported")
        coverage.push({ channel, status: "unavailable", reason: "response_unavailable" });
      else throw error;
    }
  }
  if (!read) throw unsupported();
  return {
    events,
    coverage,
    cursor: JSON.stringify({ comments: commentCursor, messages: messageCursor }),
  };
}

async function youtubeIdentity(page: BrowserPage): Promise<BrowserIdentity | undefined> {
  const studio = await page.evaluate<BrowserIdentity | undefined>(String.raw`(() => {
    if (location.origin !== ${json(YT)} || !document.querySelector('ytcp-app')) return;
    const current = /^\/channel\/(UC[\w-]{22})(\/|$)/.exec(location.pathname);
    const links = [...document.querySelectorAll('a#channel-link,ytcp-navigation-drawer a[href*="/channel/"]')];
    const identities = links.map(el => { try {
      const url = new URL(el.getAttribute('href'),location.origin);
      const id = /^\/channel\/(UC[\w-]{22})(\/|$)/.exec(url.pathname)?.[1];
      if (!id || !['https://studio.youtube.com','https://www.youtube.com'].includes(url.origin)) return;
      return {platformId:'web:youtube:' + id, name:(el.getAttribute('aria-label') || el.textContent || '').trim() || id};
    } catch {} }).filter(Boolean);
    const unique = [...new Map(identities.map(identity => [identity.platformId,identity])).values()];
    return current && unique.length === 1 && unique[0].platformId === 'web:youtube:' + current[1] ? unique[0] : undefined;
  })()`);
  if (studio) return studio;
  const publicIdentity = String.raw`(() => {
    if(location.origin!=='https://www.youtube.com'||!document.querySelector('ytd-masthead'))return;
    const links=[...document.querySelectorAll('ytd-guide-entry-renderer a[href^="https://studio.youtube.com/channel/"]')].filter(el=>el.getClientRects().length);
    const identities=links.map(el=>{try{const url=new URL(el.getAttribute('href')),id=/^\/channel\/(UC[\w-]{22})(\/|$)/.exec(url.pathname)?.[1];return id?{platformId:'web:youtube:'+id,name:(el.getAttribute('title')||el.textContent||'').trim()||id}:null;}catch{return null;}}).filter(Boolean);
    const unique=[...new Map(identities.map(id=>[id.platformId,id])).values()];return unique.length===1?unique[0]:undefined;
  })()`;
  const existing = await page.evaluate<BrowserIdentity | undefined>(publicIdentity);
  if (existing) return existing;
  const canOpen = await page.evaluate<boolean>(
    `location.origin==='https://www.youtube.com' && !!document.querySelector('ytd-masthead #guide-button button')`,
  );
  if (!canOpen) return;
  await page.click("ytd-masthead #guide-button button");
  try {
    return await page.evaluate<BrowserIdentity | undefined>(publicIdentity);
  } finally {
    await page.click("ytd-masthead #guide-button button").catch(() => undefined);
  }
}

async function setRadio(ctx: BrowserRecipeContext, selector: string, token: string) {
  await click(ctx, selector, token);
  const selected = await ctx.page.evaluate<boolean>(String.raw`(() => {
    const el = document.querySelector('[data-bycoda-web-control="${token}"]');
    return !!el && (el.checked === true || el.hasAttribute('checked') || el.getAttribute('aria-checked') === 'true');
  })()`);
  if (!selected) throw unsupported();
}

async function youtubeSynthetic(ctx: BrowserRecipeContext, value: boolean) {
  // Expanded details contain several Yes/No groups: bind the actual Altered content section first.
  if (
    !(await ctx.page.evaluate<boolean>(
      `!!document.querySelector('ytcp-video-metadata-editor-advanced')`,
    ))
  )
    await click(ctx, "ytcp-button#toggle-button", "advanced", ["Show more", "Daha fazla göster"]);
  const target = await ctx.waitFor<string>(
    String.raw`(() => {
    const headings = [...document.querySelectorAll('ytcp-form-section h3,ytcp-form-section .label,ytcp-form-section #label')]
      .filter(el => ['Altered content','Değiştirilmiş içerik'].includes(el.textContent.trim()));
    if(headings.length !== 1) return;
    const section = headings[0].closest('ytcp-form-section');
    const labels = ${json(value ? ["Yes", "Evet"] : ["No", "Hayır"])};
    const radios = [...section.querySelectorAll('tp-yt-paper-radio-button,[role="radio"]')].filter(el => labels.includes(el.textContent.trim()) && el.getClientRects().length);
    if(radios.length !== 1) return; radios[0].setAttribute('data-bycoda-youtube-synthetic','true'); return '[data-bycoda-youtube-synthetic="true"]';
  })()`,
    20_000,
  );
  if (!target) throw unsupported();
  await setRadio(ctx, target, "synthetic");
}

async function youtubeUpload(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  const options = job.payload.youtube;
  const channel = /^web:youtube:(UC[\w-]{22})$/.exec(ctx.account.platformId)?.[1];
  if (
    !channel ||
    !options ||
    !options.title.trim() ||
    /[<>]/.test(options.title + content(job)) ||
    !["private", "unlisted", "public"].includes(options.privacy) ||
    typeof options.madeForKids !== "boolean" ||
    typeof options.containsSyntheticMedia !== "boolean" ||
    ctx.files.length !== 1 ||
    ctx.files[0].kind !== "video" ||
    job.payload.media.length !== 1
  )
    throw unsupported();
  await ctx.page.goto(`${YT}/channel/${channel}/videos/upload`);
  await ctx.verifyIdentity();
  await click(ctx, "ytcp-button#create-icon", "create");
  await click(ctx, "tp-yt-paper-item,ytcp-text-menu-item", "upload-menu", [
    "Upload videos",
    "Video yükle",
  ]);
  await files(ctx, 'ytcp-uploads-dialog input[type="file"]');
  await fill(ctx, '#title-textarea #textbox[contenteditable="true"]', "title", options.title, true);
  await fill(
    ctx,
    '#description-textarea #textbox[contenteditable="true"]',
    "description",
    content(job),
    true,
  );
  await setRadio(
    ctx,
    `tp-yt-paper-radio-button[name="${options.madeForKids ? "VIDEO_MADE_FOR_KIDS_MFK" : "VIDEO_MADE_FOR_KIDS_NOT_MFK"}"]`,
    "audience",
  );
  await youtubeSynthetic(ctx, options.containsSyntheticMedia);
  const uploaded = await ctx.waitFor<string>(
    String.raw`(() => {
    const links = [...document.querySelectorAll('ytcp-uploads-dialog a[href]')].map(el => { try { return new URL(el.getAttribute('href')); } catch {} }).filter(Boolean);
    const ids = links.flatMap(url => url.hostname === 'youtu.be' ? [url.pathname.slice(1)] : url.hostname === 'www.youtube.com' ? [url.searchParams.get('v')] : []).filter(id => /^[\w-]{11}$/.test(id || ''));
    const unique = [...new Set(ids)]; return unique.length === 1 ? unique[0] : undefined;
  })()`,
    120_000,
  );
  if (!uploaded) throw unknown();
  for (let step = 0; step < 4; step++) {
    const visibility = await ctx.page.evaluate<boolean>(
      `[...document.querySelectorAll('tp-yt-paper-radio-button[name="PUBLIC"],tp-yt-paper-radio-button[name="UNLISTED"],tp-yt-paper-radio-button[name="PRIVATE"]')].some(el => el.getClientRects().length)`,
    );
    if (visibility) break;
    if (step === 3) throw unsupported();
    await click(ctx, "ytcp-button#next-button", "next");
  }
  await setRadio(
    ctx,
    `tp-yt-paper-radio-button[name="${options.privacy.toUpperCase()}"]`,
    "visibility",
  );
  await ctx.verifyIdentity();
  const submit = await control(ctx, "ytcp-button#done-button", "save-upload");
  try {
    await ctx.verifyIdentity();
    ctx.markSubmitted?.();
    await ctx.page.click(submit);
    const closed = await ctx.waitFor<boolean>(
      `!document.querySelector('ytcp-uploads-dialog')`,
      60_000,
    );
    if (!closed) throw unknown();
    await ctx.page.goto(`${YT}/channel/${channel}/videos/upload`);
    const persisted = await ctx.waitFor<boolean>(
      youtubeVideoEvidence(uploaded, options.title, options.privacy),
      120_000,
    );
    if (!persisted) throw unknown();
    await ctx.verifyIdentity();
    return {
      platformId: uploaded,
      url: `https://www.youtube.com/watch?v=${uploaded}`,
      visibility: options.privacy,
    };
  } catch {
    throw unknown();
  }
}

function youtubeVideoEvidence(id: string, title: string, privacy: string): string {
  const labels: Record<string, string[]> = {
    public: ["Public", "Herkese açık"],
    unlisted: ["Unlisted", "Liste dışı"],
    private: ["Private", "Gizli"],
  };
  return String.raw`(() => {
    const rows = [...document.querySelectorAll('ytcp-video-row')].filter(row => {
      const link = row.querySelector('a#video-title[href]');
      if(!link || link.textContent.trim() !== ${json(title)}) return false;
      try { return new URL(link.getAttribute('href'),location.origin).pathname === '/video/' + ${json(id)} + '/edit'; } catch { return false; }
    });
    if(rows.length !== 1) return false;
    const row = rows[0], visibility = row.querySelector('#visibility,ytcp-video-visibility-select');
    const state = row.querySelector('#status,.upload-status,#restrictions');
    if(!visibility || !${json(labels[privacy])}.includes(visibility.textContent.trim())) return false;
    if(/processing|uploading|failed|işleniyor|yükleniyor|başarısız/i.test(state?.textContent || '')) return false;
    return true;
  })()`;
}

function youtubeCommentsSnapshot(): string {
  return String.raw`(() => {
    const list = document.querySelector('ytcp-comments-section,ytcp-comments-section-renderer');
    if(!list) return;
    const rows = [...list.querySelectorAll('ytcp-comment-thread')].slice(0,100);
    if(!rows.length && !list.querySelector('ytcp-comments-empty-state,ytcp-empty-state')) return;
    const parsed=rows.map(row => {
      const link = row.querySelector('a[href*="lc="]'), actor = row.querySelector('a[href*="/channel/"]');
      const body = row.querySelector('#content-text,#comment-text');
      const time = row.querySelector('time[datetime]');
      if(!link || !actor || !body || !time) return null;
      let url,profile; try { url = new URL(link.getAttribute('href')); profile = new URL(actor.getAttribute('href')); } catch { return null; }
      const id = url.searchParams.get('lc'), postId = url.searchParams.get('v');
      const channel = /^\/channel\/(UC[\w-]{22})\/?$/.exec(profile.pathname)?.[1];
      if(url.hostname !== 'www.youtube.com' || profile.hostname !== 'www.youtube.com' || !/^[-\w]{10,200}$/.test(id || '') || !/^[-\w]{11}$/.test(postId || '') || !channel) return null;
      const at=Date.parse(time.getAttribute('datetime'));if(!Number.isFinite(at)||at<=0)return null;
      return {id,postId,contactId:'web:youtube:' + channel,name:actor.textContent.trim(),text:body.textContent.trim(),at};
    });
    return parsed.some(row=>!row)?undefined:parsed;
  })()`;
}

async function youtubePoll(ctx: BrowserRecipeContext): Promise<BrowserPollResult> {
  const channel = /^web:youtube:(UC[\w-]{22})$/.exec(ctx.account.platformId)?.[1];
  if (!channel) throw denied();
  await ctx.page.goto(`${YT}/channel/${channel}/comments/inbox`);
  await ctx.verifyIdentity();
  const rows = await ctx.waitFor<CommentRow[]>(youtubeCommentsSnapshot(), 30_000);
  if (!rows) throw unsupported();
  await ctx.verifyIdentity();
  return {
    events: rowsToInbound(rows, ctx.account),
    coverage: [{ channel: "comments", status: "read" }],
  };
}

export function youtubeCommentCreatedId(
  raw: string,
  text: string,
  channel: string,
): string | undefined {
  const value = readJson(raw);
  const actions = value?.actions;
  if (!Array.isArray(actions)) return;
  for (const action of actions) {
    const renderer =
      action?.createCommentAction?.commentRenderer ??
      action?.createCommentReplyAction?.commentRenderer;
    const actualText =
      renderer?.contentText?.simpleText ??
      renderer?.contentText?.runs?.map((run: { text?: string }) => run.text ?? "").join("");
    if (renderer?.authorEndpoint?.browseEndpoint?.browseId !== channel || actualText !== text)
      continue;
    if (typeof renderer.commentId === "string" && /^[\w-]{10,200}$/.test(renderer.commentId))
      return renderer.commentId;
  }
}

async function youtubeReply(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  const channel = /^web:youtube:(UC[\w-]{22})$/.exec(ctx.account.platformId)?.[1];
  const comment = inputId(job.payload.threadId, /^[\w-]{10,200}$/);
  if (!channel || ctx.files.length || job.payload.media.length || job.kind !== "reply")
    throw unsupported();
  await ctx.page.goto(`${YT}/channel/${channel}/comments/inbox`);
  await ctx.verifyIdentity();
  const marked = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const rows = [...document.querySelectorAll('ytcp-comment-thread')].filter(row => [...row.querySelectorAll('a[href*="lc="]')].some(link => { try { return new URL(link.getAttribute('href')).searchParams.get('lc') === ${json(comment)}; } catch { return false; } }));
    if(rows.length !== 1) return false;
    const button = rows[0].querySelector('ytcp-button#reply-button,button#reply-button');
    if(!button) return false; button.setAttribute('data-bycoda-youtube-reply','true'); return true;
  })()`,
    30_000,
  );
  if (!marked) throw denied();
  await click(ctx, '[data-bycoda-youtube-reply="true"]', "reply-open");
  await fill(
    ctx,
    'ytcp-commentbox #contenteditable-root[contenteditable="true"],ytcp-comment-box #contenteditable-root[contenteditable="true"]',
    "reply-text",
    content(job),
  );
  const id = await submitResponse(
    ctx,
    /\/youtubei\/v1\/(?:comment|creator)\/create_comment_reply$/,
    (raw) => youtubeCommentCreatedId(raw, content(job), channel),
    "ytcp-commentbox ytcp-button#submit-button,ytcp-comment-box ytcp-button#submit-button",
    "reply-submit",
  );
  await ctx.page.goto(`${YT}/channel/${channel}/comments/inbox`);
  const persisted = await ctx.waitFor<boolean>(
    String.raw`(() => {
    return [...document.querySelectorAll('ytcp-comment-thread')].some(row => [...row.querySelectorAll('a[href*="lc="]')].some(link => { try { return new URL(link.getAttribute('href')).searchParams.get('lc') === ${json(id)}; } catch { return false; } }) && [...row.querySelectorAll('#content-text,#comment-text')].some(el => el.textContent.trim() === ${json(content(job))}));
  })()`,
    30_000,
  );
  if (!persisted) throw unknown();
  await ctx.verifyIdentity();
  return { platformId: id };
}

async function youtubeTopLevelComment(
  ctx: BrowserRecipeContext,
  job: SocialJob,
): Promise<SocialSendResult> {
  const channel = /^web:youtube:(UC[\w-]{22})$/.exec(ctx.account.platformId)?.[1];
  const post = inputId(job.payload.objectPostId ?? job.payload.postId, /^[\w-]{11}$/);
  if (!channel || ctx.files.length || job.payload.media.length || !job.payload.text.trim())
    throw unsupported();
  const url = `https://www.youtube.com/watch?v=${post}`;
  await ctx.page.goto(url);
  await ctx.verifyIdentity();
  const target = await ctx.waitFor<boolean>(
    `document.querySelector('ytd-watch-flexy')?.getAttribute('video-id') === ${json(post)}`,
    30_000,
  );
  if (!target) throw denied();
  await click(ctx, "ytd-comment-simplebox-renderer #placeholder-area", "open-comment");
  const draft = await ctx.page.evaluate<string | undefined>(
    `document.querySelector('ytd-comment-simplebox-renderer #contenteditable-root')?.textContent`,
  );
  if (draft?.trim()) throw denied();
  await fill(
    ctx,
    'ytd-comment-simplebox-renderer #contenteditable-root[contenteditable="true"]',
    "comment-text",
    job.payload.text,
  );
  const id = await submitResponse(
    ctx,
    /\/youtubei\/v1\/comment\/create_comment$/,
    (raw) => youtubeCommentCreatedId(raw, job.payload.text, channel),
    "ytd-comment-simplebox-renderer #submit-button button",
    "comment-submit",
  );
  await ctx.page.goto(`${url}&lc=${encodeURIComponent(id)}`);
  const persisted = await ctx.waitFor<boolean>(
    String.raw`(() => {
    if(document.querySelector('ytd-watch-flexy')?.getAttribute('video-id')!==${json(post)})return false;
    return [...document.querySelectorAll('ytd-comment-thread-renderer')].some(row=>[...row.querySelectorAll('a[href*="lc="]')].some(link=>{try{return new URL(link.getAttribute('href'),location.origin).searchParams.get('lc')===${json(id)};}catch{return false;}})&&row.querySelector('#content-text')?.textContent.trim()===${json(job.payload.text)});
  })()`,
    30_000,
  );
  if (!persisted) throw unknown();
  await ctx.verifyIdentity();
  return { platformId: id, url: `${url}&lc=${encodeURIComponent(id)}` };
}

async function tiktokIdentity(page: BrowserPage): Promise<BrowserIdentity | undefined> {
  return page.evaluate<BrowserIdentity | undefined>(String.raw`(() => {
    if(location.origin !== ${json(TT)} || /\/(login|signup)(\/|$)/.test(location.pathname)) return;
    const links = [...document.querySelectorAll('a[data-e2e="nav-profile"],[data-e2e="profile-icon"] a[href^="/@"],header a[href^="/@"]')].filter(el => el.getClientRects().length);
    const identities = links.map(el => { try {
      const url = new URL(el.getAttribute('href'),location.origin), handle = /^\/@([\w.]{2,24})\/?$/.exec(url.pathname)?.[1];
      return url.origin === location.origin && handle ? {platformId:'web:tiktok:' + handle.toLowerCase(),name:'@' + handle} : null;
    } catch { return null; } }).filter(Boolean);
    const unique = [...new Map(identities.map(identity => [identity.platformId,identity])).values()];
    return unique.length === 1 ? unique[0] : undefined;
  })()`);
}

const tiktokPrivacy: Record<string, readonly string[]> = {
  PUBLIC_TO_EVERYONE: ["Everyone", "Herkes"],
  MUTUAL_FOLLOW_FRIENDS: ["Friends", "Arkadaşlar"],
  FOLLOWER_OF_CREATOR: ["Followers", "Takipçiler"],
  SELF_ONLY: ["Only you", "Yalnızca sen", "Only me", "Sadece ben"],
};

async function tiktokCreatorInfo(ctx: BrowserRecipeContext): Promise<TikTokCreatorInfo> {
  await ctx.page.goto(`${TT}/tiktokstudio/upload`);
  await ctx.verifyIdentity();
  await click(
    ctx,
    '[data-e2e="privacy-select"],[data-e2e="video-privacy"][aria-haspopup="listbox"]',
    "privacy-open",
  );
  const value = await ctx.page.evaluate<TikTokCreatorInfo | undefined>(String.raw`(() => {
    const mapping = ${json(tiktokPrivacy)};
    const choices = [...document.querySelectorAll('[role="option"],select[name="privacy"] option')].filter(el => el.getClientRects().length && !el.disabled).map(el => el.textContent.trim());
    const privacyOptions = [...new Set(choices.map(text => Object.keys(mapping).find(key => mapping[key].includes(text))))];
    const info = document.querySelector('[data-e2e="upload-info"],[data-e2e="upload-card"]');
    const duration = /(\d+)\s*(?:minutes?|min|dakika)/i.exec(info?.textContent || '');
    const read = name => {
      const el = document.querySelector('input[name="' + name + '"],[role="switch"][data-e2e="allow-' + name + '"]');
      return el ? el.disabled === true || el.getAttribute('aria-disabled') === 'true' : undefined;
    };
    const commentDisabled = read('comment'), duetDisabled = read('duet'), stitchDisabled = read('stitch');
    if(!privacyOptions.length || privacyOptions.includes(undefined) || !duration || [commentDisabled,duetDisabled,stitchDisabled].includes(undefined)) return;
    return {nickname:${json(ctx.account.name)},privacyOptions,maxDurationSeconds:Number(duration[1])*60,commentDisabled,duetDisabled,stitchDisabled};
  })()`);
  if (!value || !Number.isFinite(value.maxDurationSeconds) || value.maxDurationSeconds <= 0)
    throw unsupported();
  await ctx.verifyIdentity();
  return value;
}

export function tiktokCommentRows(raw: string, postId: string): CommentRow[] | undefined {
  const value = readJson(raw);
  if (value?.status_code !== 0 || !Array.isArray(value.comments)) return;
  const rows: CommentRow[] = [];
  for (const comment of value.comments.slice(0, 100)) {
    const handle = comment?.user?.unique_id;
    if (
      !/^\d{1,30}$/.test(String(comment?.cid ?? "")) ||
      String(comment?.aweme_id) !== postId ||
      typeof handle !== "string" ||
      !/^[\w.]{2,24}$/.test(handle) ||
      typeof comment.text !== "string" ||
      !Number.isFinite(comment.create_time) ||
      comment.create_time <= 0
    )
      return;
    rows.push({
      id: String(comment.cid),
      postId,
      contactId: `web:tiktok:${handle.toLowerCase()}`,
      name: String(comment.user.nickname ?? handle),
      text: comment.text,
      at: comment.create_time * 1000,
    });
  }
  return rows;
}

export function tiktokCommentCreatedId(
  raw: string,
  postId: string,
  text: string,
  owner: string,
): string | undefined {
  const value = readJson(raw);
  const comment = value?.comment;
  if (
    value?.status_code !== 0 ||
    String(comment?.aweme_id) !== postId ||
    comment?.text !== text ||
    `web:tiktok:${String(comment?.user?.unique_id ?? "").toLowerCase()}` !== owner
  )
    return;
  const id = String(comment?.cid ?? "");
  return /^\d{1,30}$/.test(id) ? id : undefined;
}

export function tiktokVideoCreatedId(raw: string): string | undefined {
  const value = readJson(raw);
  if (value?.status_code !== 0 && value?.data?.status !== 0) return;
  const id = value?.data?.video_id ?? value?.data?.post_info?.video_id;
  return typeof id === "string" && /^\d{1,30}$/.test(id) ? id : undefined;
}

async function tiktokPoll(
  ctx: BrowserRecipeContext,
  posts: string[],
  cursor?: string,
): Promise<BrowserPollResult> {
  const handle = /^web:tiktok:([\w.]{2,24})$/.exec(ctx.account.platformId)?.[1];
  const valid = [...new Set(posts.filter((post) => /^\d{1,30}$/.test(post)))];
  if (!handle || !valid.length) throw unsupported();
  const start = /^\d+$/.test(cursor ?? "") ? Number(cursor) % valid.length : 0;
  const count = Math.min(2, valid.length),
    events: SocialInbound[] = [];
  for (let i = 0; i < count; i++) {
    const postId = valid[(start + i) % valid.length];
    const watch = ctx.page.watchResponse(
      /\/api\/comment\/list\/?$/,
      (raw) => !!tiktokCommentRows(raw, postId),
    );
    try {
      await ctx.page.goto(`${TT}/@${handle}/video/${postId}`);
      await ctx.verifyIdentity();
      const body = await watch.body(30_000);
      const rows = body && tiktokCommentRows(body, postId);
      if (!rows) throw unsupported();
      await ctx.verifyIdentity();
      events.push(...rowsToInbound(rows, ctx.account));
    } finally {
      watch.stop();
    }
  }
  return {
    events,
    cursor: String((start + count) % valid.length),
    coverage: [{ channel: "comments", status: "read" }],
  };
}

async function tiktokComment(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  const post = inputId(job.payload.objectPostId ?? job.payload.postId, /^\d{1,30}$/);
  const owner = /^web:tiktok:([\w.]{2,24})$/.exec(ctx.account.platformId)?.[1];
  const author = /^web:tiktok:([\w.]{2,24})$/.exec(job.payload.recipientId ?? "")?.[1] ?? owner;
  if (!owner || !author || job.payload.media.length || ctx.files.length) throw unsupported();
  if (job.kind === "reply") inputId(job.payload.threadId, /^\d{1,30}$/);
  await ctx.page.goto(`${TT}/@${author}/video/${post}`);
  await ctx.verifyIdentity();
  if (job.kind === "reply") {
    const target = await ctx.waitFor<boolean>(
      String.raw`(() => {
      const rows = [...document.querySelectorAll('[data-comment-id]')].filter(el => el.getAttribute('data-comment-id') === ${json(job.payload.threadId)});
      if(rows.length !== 1) return false;
      const reply = rows[0].querySelector('[data-e2e="comment-reply-1"],[data-e2e="comment-reply-2"]');
      if(!reply) return false; reply.setAttribute('data-bycoda-tiktok-reply','true'); return true;
    })()`,
      20_000,
    );
    if (!target) throw denied();
    await click(ctx, '[data-bycoda-tiktok-reply="true"]', "reply-open");
  }
  await fill(
    ctx,
    '[data-e2e="comment-input"] [contenteditable="true"],[data-e2e="comment-text"][contenteditable="true"]',
    "comment-text",
    content(job),
  );
  const id = await submitResponse(
    ctx,
    /\/api\/comment\/publish\/?$/,
    (raw) => tiktokCommentCreatedId(raw, post, content(job), ctx.account.platformId),
    '[data-e2e="comment-post"]',
    "comment-submit",
  );
  // The response binds owner, exact text and target video. No optimistic DOM text is accepted.
  return { platformId: id, url: `${TT}/@${author}/video/${post}?comment_id=${id}` };
}

async function tiktokSwitch(ctx: BrowserRecipeContext, name: string, desired: boolean) {
  const selector = `input[name=${json(name)}],[role="switch"][data-e2e=${json(name)}]`;
  const read = String.raw`(() => {
    const values = [...document.querySelectorAll(${json(selector)})].filter(el => el.getClientRects().length);
    if(values.length !== 1) return; const el = values[0];
    const value = el.matches('input') ? el.checked : el.getAttribute('aria-checked') === 'true';
    return {value,disabled:el.disabled === true || el.getAttribute('aria-disabled') === 'true'};
  })()`;
  const current = await ctx.page.evaluate<{ value: boolean; disabled: boolean } | undefined>(read);
  if (!current || (current.disabled && current.value !== desired)) throw unsupported();
  if (current.value !== desired) await click(ctx, selector, `switch-${name}`);
  if ((await ctx.page.evaluate<{ value: boolean } | undefined>(read))?.value !== desired)
    throw unsupported();
}

async function tiktokUpload(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  const options = job.payload.tiktok;
  const handle = /^web:tiktok:([\w.]{2,24})$/.exec(ctx.account.platformId)?.[1];
  if (
    !handle ||
    !options ||
    !tiktokPrivacy[options.privacy] ||
    options.consent !== true ||
    !Number.isFinite(options.durationSeconds) ||
    options.durationSeconds <= 0 ||
    ctx.files.length !== 1 ||
    ctx.files[0].kind !== "video" ||
    job.payload.media.length !== 1
  )
    throw unsupported();
  await ctx.page.goto(`${TT}/tiktokstudio/upload`);
  await ctx.verifyIdentity();
  await files(ctx, 'input[type="file"][accept*="video"]');
  await fill(
    ctx,
    '[data-e2e="caption-editor"][contenteditable="true"],[data-e2e="caption-editor"] [contenteditable="true"]',
    "caption",
    content(job),
    true,
  );
  await click(
    ctx,
    '[data-e2e="privacy-select"],[data-e2e="video-privacy"][aria-haspopup="listbox"]',
    "privacy-open",
  );
  await click(ctx, '[role="option"]', "privacy-value", tiktokPrivacy[options.privacy]);
  const visibility = await ctx.page.evaluate<boolean>(
    `[...document.querySelectorAll('[data-e2e="privacy-select"],[data-e2e="video-privacy"]')].some(el => ${json(tiktokPrivacy[options.privacy])}.includes(el.textContent.trim()))`,
  );
  if (!visibility) throw unsupported();
  for (const [name, desired] of [
    ["allow-comment", options.allowComment],
    ["allow-duet", options.allowDuet],
    ["allow-stitch", options.allowStitch],
    ["content-disclosure", options.brandContent || options.brandOrganic],
    ["ai-generated-content", options.isAigc],
  ] as const)
    await tiktokSwitch(ctx, name, desired);
  if (options.brandContent || options.brandOrganic) {
    await tiktokSwitch(ctx, "your-brand", options.brandOrganic);
    await tiktokSwitch(ctx, "branded-content", options.brandContent);
  }
  await tiktokSwitch(ctx, "music-usage-confirmation", true);
  const id = await submitResponse(
    ctx,
    /\/api\/(?:v1\/)?(?:web\/)?(?:project|video|post)\/(?:post|create|publish)\/?$/,
    tiktokVideoCreatedId,
    'button[data-e2e="post_video_button"],button[data-e2e="post-video-button"]',
    "publish-video",
  );
  await ctx.page.goto(`${TT}/@${handle}`);
  const persisted = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const items = [...document.querySelectorAll('[data-e2e="user-post-item"]')].filter(item => [...item.querySelectorAll('a[href]')].some(link => { try { return new URL(link.getAttribute('href'),location.origin).pathname === '/@' + ${json(handle)} + '/video/' + ${json(id)}; } catch { return false; } }));
    return items.length === 1 && [...items[0].querySelectorAll('[data-e2e="user-post-item-desc"],img[alt]')].some(el => (el.getAttribute('alt') || el.textContent || '').trim() === ${json(content(job))});
  })()`,
    120_000,
  );
  if (!persisted) throw unknown();
  await ctx.verifyIdentity();
  return { platformId: id, url: `${TT}/@${handle}/video/${id}` };
}

export function snapchatBrowserConnectionUrl(account: SocialAccount): string {
  if (account.accountType === "public_profile") return SNAP_UPLOAD;
  if (account.accountType === "member") return SNAP;
  throw new Error("Choose a Snapchat member account or Public Profile for browser mode.");
}

async function snapchatIdentity(
  page: BrowserPage,
  account?: SocialAccount,
): Promise<BrowserIdentity | undefined> {
  if (!account || account.accountType === "public_profile") {
    const current = await readSnapchatPublicProfileIdentity(page);
    if (current) return current;
  }
  const expression = String.raw`(() => {
    const expected=${json(account?.accountType ?? null)};
    if(expected && !['member','public_profile'].includes(expected))return;
    const web=expected!=='public_profile' && ${snapWebLocation} && !!document.querySelector('[data-testid="chat-list"],[role="navigation"][aria-label="Chats"]');
    const uploader=['https://my.snapchat.com','https://profile.snapchat.com'].includes(location.origin) && !!document.querySelector('input[type="file"],form[data-testid="upload-form"]');
    if(!web&&!uploader)return;
    if(uploader){
      if(expected && expected!=='public_profile')return;
      const checked=[...document.querySelectorAll('input[type="checkbox"]:checked')].filter(el=>(el.name==='selectedProfiles'||el.getAttribute('data-testid')==='profile-checkbox')&&el.getClientRects().length);
      const selected=checked.length ? checked.map(el=>el.closest('label')||[...document.querySelectorAll('label[for]')].find(label=>label.getAttribute('for')===el.id)).filter(Boolean)
        : [...document.querySelectorAll('[data-testid="selected-profile"][aria-selected="true"],[data-testid="selected-profile"][data-selected="true"]')].filter(el=>el.getClientRects().length);
      if(checked.length>1 || selected.length!==1)return;
      const links=[...selected[0].querySelectorAll('a[href*="/add/"]')];
      if(links.length!==1)return;
      try{
        const url=new URL(links[0].getAttribute('href'),location.origin),username=/^\/add\/([a-zA-Z][\w.-]{1,30})\/?$/.exec(url.pathname)?.[1];
        if(url.protocol!=='https:'||!['www.snapchat.com','snapchat.com'].includes(url.hostname)||url.username||url.password||!username)return;
        return {platformId:'web:snapchat:public_profile:'+username.toLowerCase(),name:'@'+username,accountType:'public_profile'};
      }catch{return;}
    }
    // An own-profile panel is distinct from a friend's profile. Never infer the sender from a chat header.
    const panels = [...document.querySelectorAll('[data-testid="my-profile"],[data-testid="profile-menu"],[aria-label="My Profile"]')].filter(el => el.getClientRects().length);
    const identities = panels.flatMap(panel => [...panel.querySelectorAll('a[href*="snapchat.com/add/"],[data-testid="profile-username"]')].map(el => {
      const href = el.getAttribute('href'); let username;
      if(href) { try { const url = new URL(href,location.origin); if(url.hostname === 'www.snapchat.com' || url.hostname === 'snapchat.com') username = /^\/add\/([a-zA-Z][\w.-]{1,30})\/?$/.exec(url.pathname)?.[1]; } catch {} }
      else username = (el.textContent || '').trim().replace(/^@/,'');
      return username && /^[a-zA-Z][\w.-]{1,30}$/.test(username) ? {platformId:'web:snapchat:' + username.toLowerCase(),name:'@' + username,accountType:'member'} : null;
    })).filter(Boolean);
    const unique = [...new Map(identities.map(identity => [identity.platformId,identity])).values()];
    return unique.length === 1 ? unique[0] : undefined;
  })()`;
  const existing = await page.evaluate<BrowserIdentity | undefined>(expression);
  if (existing) return existing;
  const open = await page.evaluate<boolean>(String.raw`(() => {
    if(${account?.accountType === "public_profile"})return false;
    if(!${snapWebLocation} || !document.querySelector('[data-testid="chat-list"],[role="navigation"][aria-label="Chats"]'))return false;
    const controls=[...document.querySelectorAll('button[data-testid="my-profile-button"],button[data-testid="profile-button"],button[aria-label="My Profile"],button[aria-label="Profile"]')].filter(el=>el.getClientRects().length);
    if(controls.length!==1)return false;controls[0].setAttribute('data-bycoda-snap-own-profile','true');return true;
  })()`);
  if (!open) return;
  await page.click('[data-bycoda-snap-own-profile="true"]');
  try {
    return await page.evaluate<BrowserIdentity | undefined>(expression);
  } finally {
    await page.click('[data-bycoda-snap-own-profile="true"]').catch(() => undefined);
  }
}

type SnapPost = { id: string; owner: string; text: string; at: number; url: string };
function snapPostsExpression(): string {
  return String.raw`(() => {
    if(!['https://my.snapchat.com','https://profile.snapchat.com'].includes(location.origin))return;
    return [...document.querySelectorAll('a[href*="/spotlight/"]')].slice(0,100).map(link=>{
      const row=link.closest('article,[role="row"],[data-testid="content-card"]');if(!row)return null;
      const actor=row.querySelector('a[href*="/add/"]'),text=row.querySelector('[data-testid="caption"],.caption'),time=row.querySelector('time[datetime]');
      if(!actor||!text||!time)return null;
      try{
        const url=new URL(link.getAttribute('href'),location.origin),profile=new URL(actor.getAttribute('href'),location.origin);
        const id=/^\/spotlight\/([\w-]{8,200})\/?$/.exec(url.pathname)?.[1],username=/^\/add\/([a-zA-Z][\w.-]{1,30})\/?$/.exec(profile.pathname)?.[1];
        return id&&username&&['www.snapchat.com','snapchat.com'].includes(url.hostname)&&['www.snapchat.com','snapchat.com'].includes(profile.hostname)?{id,owner:'web:snapchat:public_profile:'+username.toLowerCase(),text:text.textContent.trim(),at:Date.parse(time.getAttribute('datetime')),url:url.origin+url.pathname}:null;
      }catch{return null;}
    }).filter(Boolean);
  })()`;
}

/** Spotlight only. Story targets require a separate reviewed target choice; terms are never accepted here. */
async function snapchatUploadCurrent(
  ctx: BrowserRecipeContext,
  job: SocialJob,
): Promise<SocialSendResult> {
  const options = job.payload.snapchat;
  if (
    !options ||
    ctx.account.accountType !== "public_profile" ||
    ctx.files.length !== 1 ||
    ctx.files[0].kind !== "video" ||
    job.payload.media.length !== 1 ||
    !["story", "spotlight"].includes(options.target)
  )
    throw unsupported();
  if (options.target === "story" && content(job).trim()) throw unsupported();
  if (options.target === "spotlight" && content(job).length > 160) throw unsupported();
  await ctx.page.goto(SNAP_UPLOAD);
  await ctx.verifyIdentity();
  await files(ctx, snapchatUploaderSelectors.fileInput);
  const ready = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const video=document.querySelector('video[aria-label="Video upload thumbnail"]');
    return !!video && document.querySelectorAll('[data-testid="small-preview-image-container"]').length<=1 && video.readyState>=1 && Number.isFinite(video.duration) && video.duration>=5 && video.duration<=60 && video.videoWidth>=540 && video.videoHeight>=960 && Math.abs(video.duration-${options.durationSeconds})<1 && video.videoWidth===${options.width} && video.videoHeight===${options.height};
  })()`,
    120_000,
  );
  if (!ready) throw unsupported();
  const selection = await selectSnapchatPublishDestination(ctx, options.target);
  if (options.target === "spotlight" && content(job))
    await fill(
      ctx,
      snapchatUploaderSelectors.spotlightDescription,
      "snap-description",
      content(job),
    );
  const terms = await ctx.page.evaluate<boolean>(String.raw`(() => {
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>el.getClientRects().length);
    return dialogs.some(el=>/Creator Terms|Terms of Service|İçerik Üretici Koşulları|Hizmet Koşulları/i.test(el.textContent||''));
  })()`);
  if (terms) throw denied();
  const submit = await control(ctx, snapchatUploaderSelectors.submit, "snap-post");
  await ctx.verifyIdentity();
  await verifySnapchatPublishDestination(ctx, selection);
  ctx.markSubmitted?.();
  try {
    await ctx.page.click(submit);
    await ctx.waitFor<boolean>(
      String.raw`(() => {
      if(!['https://my.snapchat.com','https://profile.snapchat.com'].includes(location.origin))return false;
      return !document.querySelector('video[aria-label="Video upload thumbnail"]') || !!document.querySelector('[role="alert"]');
    })()`,
      60_000,
    );
    // Current PostProfileMedia returns EmptyResponse. Neither that acceptance nor a
    // toast identifies the posted Snap, so the queue must hold this for review.
    throw unknown();
  } catch {
    throw unknown();
  }
}

async function snapchatUpload(
  ctx: BrowserRecipeContext,
  job: SocialJob,
): Promise<SocialSendResult> {
  if (
    /^web:snapchat:public_profile:[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
      ctx.account.platformId,
    )
  )
    return snapchatUploadCurrent(ctx, job);
  if (job.payload.snapchat?.target === "story") throw unsupported();
  if (
    ctx.account.accountType !== "public_profile" ||
    !/^web:snapchat:public_profile:[a-zA-Z][\w.-]{1,30}$/.test(ctx.account.platformId) ||
    ctx.files.length !== 1 ||
    ctx.files[0].kind !== "video" ||
    job.payload.media.length !== 1
  )
    throw unsupported();
  await ctx.page.goto(SNAP_UPLOAD);
  await ctx.verifyIdentity();
  const before = await ctx.page.evaluate<SnapPost[] | undefined>(snapPostsExpression());
  await files(ctx, 'input[type="file"][accept*="video"]');
  const destination = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const labels=[...document.querySelectorAll('label')].filter(el=>['Spotlight Snaps','Spotlight'].includes(el.textContent.trim()));
    if(labels.length!==1)return false;
    const input=labels[0].querySelector('input[type="checkbox"]')||document.getElementById(labels[0].getAttribute('for'));
    if(!input||input.disabled)return false;input.setAttribute('data-bycoda-snap-target','true');return true;
  })()`,
    30_000,
  );
  if (!destination) throw unsupported();
  const selected = await ctx.page.evaluate<boolean>(
    `document.querySelector('[data-bycoda-snap-target="true"]')?.checked === true`,
  );
  if (!selected) await click(ctx, '[data-bycoda-snap-target="true"]', "spotlight-target");
  const targetsValid = await ctx.page.evaluate<boolean>(String.raw`(() => {
    const target=document.querySelector('[data-bycoda-snap-target="true"]');
    if(!target?.checked)return false;
    const checked=[...document.querySelectorAll('input[type="checkbox"]:checked')].filter(el=>el.name==='selectedProfiles'||el.getAttribute('data-testid')==='profile-checkbox');
    if(checked.length!==1)return false;
    const label=checked[0].closest('label'),link=label?.querySelector('a[href*="/add/"]');
    if(!link)return false;
    try{const url=new URL(link.getAttribute('href'),location.origin),username=/^\/add\/([a-zA-Z][\w.-]{1,30})\/?$/.exec(url.pathname)?.[1];return ['www.snapchat.com','snapchat.com'].includes(url.hostname)&&'web:snapchat:public_profile:'+username?.toLowerCase()===${json(ctx.account.platformId)};}catch{return false;}
  })()`);
  if (!targetsValid) throw denied();
  if (content(job)) {
    const hasCaption = await ctx.page.evaluate<boolean>(
      `!!document.querySelector('textarea[name="caption"],textarea[aria-label="Caption"]')`,
    );
    if (hasCaption)
      await fill(
        ctx,
        'textarea[name="caption"],textarea[aria-label="Caption"]',
        "caption",
        content(job),
      );
    else {
      if (!/^(?:#[\p{L}\p{N}_]+\s*)+$/u.test(content(job))) throw unsupported();
      await fill(
        ctx,
        'input[placeholder="Add topics"],input[aria-label="Topics"]',
        "topics",
        content(job),
      );
    }
  }
  const termsReady = await ctx.page.evaluate<boolean>(String.raw`(() => {
    const labels=[...document.querySelectorAll('label')].filter(el=>/Creator Terms|Terms of Service|İçerik Üretici Koşulları|Hizmet Koşulları/i.test(el.textContent));
    if(!labels.length)return !/Creator Terms|İçerik Üretici Koşulları/i.test(document.querySelector('main')?.textContent||'');
    return labels.every(label=>{const input=label.querySelector('input[type="checkbox"]')||document.getElementById(label.getAttribute('for'));return input?.checked===true;});
  })()`);
  if (!termsReady) throw denied();
  const submit = await control(ctx, "button", "post-spotlight", [
      "Post to Snapchat",
      "Snapchat'te paylaş",
    ]),
    at = ctx.now();
  try {
    await ctx.verifyIdentity();
    ctx.markSubmitted?.();
    await ctx.page.click(submit);
    await ctx.page.goto(SNAP_UPLOAD);
    const rows = await ctx.waitFor<SnapPost[]>(snapPostsExpression(), 60_000);
    await ctx.verifyIdentity();
    const matches = rows?.filter(
      (row) =>
        row.owner === ctx.account.platformId &&
        row.text === content(job) &&
        row.at >= at - 5000 &&
        row.at <= ctx.now() + 60_000 &&
        !before?.some((old) => old.id === row.id),
    );
    if (matches?.length !== 1) throw unknown();
    return { platformId: matches[0].id, url: matches[0].url };
  } catch {
    throw unknown();
  }
}

type SnapchatMessage = {
  id: string;
  threadId: string;
  sender: string;
  recipient: string;
  text: string;
  at: number;
};
type SnapchatChat = { threadId: string; href: string; recipient: string };

function snapchatChatsExpression(): string {
  return String.raw`(() => {
    if(!${snapWebLocation})return;
    const list = document.querySelector('[data-testid="chat-list"],[role="navigation"][aria-label="Chats"]');
    if(!list) return;
    const chats = [...list.querySelectorAll('a[href]')].slice(0,100).map(el => { try {
      const url = new URL(el.getAttribute('href'),location.origin), id = url.searchParams.get('chatId');
      const recipient = el.getAttribute('data-username');
      const allowed=(url.origin===${json(SNAP)} && url.pathname==='/') || (url.origin==='https://www.snapchat.com' && /^\/web\/?$/.test(url.pathname));
      if(!allowed || !/^[\w-]{8,100}$/.test(id || '') || !/^[a-zA-Z][\w.-]{1,30}$/.test(recipient || '')) return null;
      return {threadId:id,href:url.origin + url.pathname + '?chatId=' + encodeURIComponent(id),recipient:'web:snapchat:' + recipient.toLowerCase()};
    } catch { return null; } }).filter(Boolean);
    if(!chats.length && !list.querySelector('[data-testid="empty-chat-list"]')) return;
    return chats;
  })()`;
}

function snapchatMessagesExpression(threadId: string, owner: string, recipient: string): string {
  return String.raw`(() => {
    const thread = [...document.querySelectorAll('[data-conversation-id]')].find(el => el.getAttribute('data-conversation-id') === ${json(threadId)});
    if(!thread) return;
    const participants = [...thread.querySelectorAll('[data-participant-username]')].map(el => 'web:snapchat:' + el.getAttribute('data-participant-username').toLowerCase());
    if(!participants.includes(${json(owner)}) || !participants.includes(${json(recipient)})) return;
    const elements = [...thread.querySelectorAll('[data-message-id]')].slice(-100);
    if(!elements.length && !thread.querySelector('[data-testid="empty-conversation"]')) return;
    const rows=elements.map(el => {
      const id = el.getAttribute('data-message-id'), body = el.querySelector('[data-testid="message-text"],[data-message-text]');
      const sender = el.getAttribute('data-sender-username'), to = el.getAttribute('data-recipient-username');
      const time = el.querySelector('time[datetime]');
      if(!/^[\w-]{8,160}$/.test(id || '') || !body || !time || !/^[a-zA-Z][\w.-]{1,30}$/.test(sender || '') || !/^[a-zA-Z][\w.-]{1,30}$/.test(to || '')) return null;
      const at=Date.parse(time.getAttribute('datetime'));if(!Number.isFinite(at)||at<=0)return null;
      return {id,threadId:${json(threadId)},sender:'web:snapchat:' + sender.toLowerCase(),recipient:'web:snapchat:' + to.toLowerCase(),text:body.textContent,at};
    });
    return rows.some(row=>!row)?undefined:rows;
  })()`;
}

async function snapchatPoll(
  ctx: BrowserRecipeContext,
  _posts: string[],
  cursor?: string,
): Promise<BrowserPollResult> {
  if (ctx.account.accountType !== "member") throw unsupported();
  await ctx.page.goto(SNAP);
  await ctx.verifyIdentity();
  const chats = await ctx.waitFor<SnapchatChat[]>(snapchatChatsExpression(), 30_000);
  if (!chats) throw unsupported();
  if (!chats.length) return { events: [], coverage: [{ channel: "messages", status: "read" }] };
  const start = /^\d+$/.test(cursor ?? "") ? Number(cursor) % chats.length : 0;
  const events: SocialInbound[] = [],
    count = Math.min(2, chats.length);
  for (let i = 0; i < count; i++) {
    const chat = chats[(start + i) % chats.length];
    await ctx.page.goto(chat.href);
    await ctx.verifyIdentity();
    const rows = await ctx.waitFor<SnapchatMessage[]>(
      snapchatMessagesExpression(chat.threadId, ctx.account.platformId, chat.recipient),
      20_000,
    );
    if (!rows) throw unsupported();
    await ctx.verifyIdentity();
    for (const row of rows) {
      if (
        row.sender !== chat.recipient ||
        row.recipient !== ctx.account.platformId ||
        !row.text ||
        !Number.isFinite(row.at) ||
        row.at <= 0
      )
        continue;
      events.push({
        eventId: row.id,
        threadId: chat.threadId,
        contactId: chat.recipient,
        contactName: chat.recipient.slice("web:snapchat:".length),
        text: row.text,
        kind: "message",
        at: row.at,
      });
    }
  }
  return {
    events,
    cursor: String((start + count) % chats.length),
    coverage: [{ channel: "messages", status: "read" }],
  };
}

async function snapchatSend(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  if (
    ctx.account.accountType !== "member" ||
    !(
      (job.kind === "message" || job.kind === "reply") &&
      !job.payload.postId &&
      !job.payload.objectPostId
    ) ||
    job.payload.media.length ||
    ctx.files.length ||
    !job.payload.text.trim()
  )
    throw unsupported();
  const threadId = inputId(job.payload.threadId, /^[\w-]{8,100}$/);
  const recipient = inputId(job.payload.recipientId, /^web:snapchat:[a-zA-Z][\w.-]{1,30}$/);
  await ctx.page.goto(SNAP);
  await ctx.verifyIdentity();
  const chats = await ctx.waitFor<SnapchatChat[]>(snapchatChatsExpression(), 30_000);
  const matching = chats?.filter(
    (chat) => chat.threadId === threadId && chat.recipient === recipient,
  );
  if (matching?.length !== 1) throw denied();
  await ctx.page.goto(matching[0].href);
  await ctx.verifyIdentity();
  const before = await ctx.waitFor<SnapchatMessage[]>(
    snapchatMessagesExpression(threadId, ctx.account.platformId, recipient),
    20_000,
  );
  if (!before) throw denied();
  await fill(
    ctx,
    '[data-conversation-id] [data-testid="chat-input"][contenteditable="true"],[data-conversation-id] textarea[aria-label="Send a chat"]',
    "chat-text",
    job.payload.text,
  );
  const button = await control(
    ctx,
    '[data-conversation-id] button[data-testid="send-chat"],[data-conversation-id] button[aria-label="Send"]',
    "send-chat",
  );
  const at = ctx.now();
  try {
    await ctx.verifyIdentity();
    ctx.markSubmitted?.();
    await ctx.page.click(button);
    // Reopen the exact chat. A newly rendered optimistic bubble is not sufficient.
    await ctx.page.goto(matching[0].href);
    const after = await ctx.waitFor<SnapchatMessage[]>(
      snapchatMessagesExpression(threadId, ctx.account.platformId, recipient),
      30_000,
    );
    await ctx.verifyIdentity();
    const candidates = after?.filter(
      (row) =>
        row.threadId === threadId &&
        row.sender === ctx.account.platformId &&
        row.recipient === recipient &&
        row.text === job.payload.text &&
        row.at >= at - 5000 &&
        !before.some((old) => old.id === row.id),
    );
    if (candidates?.length !== 1) throw unknown();
    return { platformId: candidates[0].id };
  } catch {
    throw unknown();
  }
}

/** These recipes are guarded UI paths, not a claim that an unknown current layout was live accepted. */
export const publishingBrowserRecipes: BrowserRecipe[] = [
  {
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
  },
  {
    platform: "youtube",
    loginUrl: `${YT}/`,
    operations: ["publish", "media", "comments.read", "comment", "reply", "poll"],
    identity: youtubeIdentity,
    send: (ctx, job) =>
      job.kind === "publish"
        ? youtubeUpload(ctx, job)
        : job.kind === "reply"
          ? youtubeReply(ctx, job)
          : job.kind === "comment"
            ? youtubeTopLevelComment(ctx, job)
            : Promise.reject(unsupported()),
    poll: youtubePoll,
  },
  {
    platform: "tiktok",
    loginUrl: `${TT}/tiktokstudio/upload`,
    operations: ["publish", "media", "comments.read", "comment", "reply", "poll"],
    identity: tiktokIdentity,
    creatorInfo: tiktokCreatorInfo,
    send: (ctx, job) =>
      job.kind === "publish"
        ? tiktokUpload(ctx, job)
        : ["comment", "reply"].includes(job.kind)
          ? tiktokComment(ctx, job)
          : Promise.reject(unsupported()),
    poll: tiktokPoll,
  },
  {
    platform: "snapchat",
    loginUrl: SNAP,
    connectionUrl: snapchatBrowserConnectionUrl,
    operations: ["publish", "media", "inbox.read", "message.reply", "poll"],
    identity: snapchatIdentity,
    send: (ctx, job) =>
      job.kind === "publish" ? snapchatUpload(ctx, job) : snapchatSend(ctx, job),
    poll: snapchatPoll,
  },
];
