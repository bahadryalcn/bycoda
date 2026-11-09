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
  // shortcut: coverage has no "partial" channel status yet; a bounded window is reported as
  // unavailable so the monitor status is "partial". Upgrade when the coverage model adds "partial".
  const complete = chats.length <= count;
  return {
    events,
    cursor: String((start + count) % chats.length),
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
  // Identity failure before the mark is a refusal, not an uncertain delivery.
  await ctx.verifyIdentity();
  try {
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
