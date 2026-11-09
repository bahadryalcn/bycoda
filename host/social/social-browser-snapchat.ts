import {
  click,
  content,
  control,
  denied,
  files,
  fill,
  inputId,
  json,
  unknown,
  unsupported,
} from "./social-browser-publishing-shared";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import type { SocialInbound, SocialSendResult } from "../../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import { needsHumanError } from "./browser/challenge";
import {
  readSnapchatPublicProfileIdentity,
  selectSnapchatPublishDestination,
  snapchatUploaderSelectors,
  verifySnapchatPublishDestination,
} from "./social-browser-snapchat-extended";
import {
  guardSnapchatStep,
  snapchatChallenge,
  unexpectedSnapchatScreen,
} from "./social-browser-snapchat-guard";
import type {
  BrowserIdentity,
  BrowserPollResult,
  BrowserRecipe,
  BrowserRecipeContext,
} from "./social-browser-recipe";

export const SNAP = "https://web.snapchat.com";
const SNAP_UPLOAD = "https://my.snapchat.com";
const snapWebLocation = `((location.origin === ${json(SNAP)} && location.pathname === '/') || (location.origin === 'https://www.snapchat.com' && /^\\/web(?:\\/|$)/.test(location.pathname)))`;

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

/** A recognized Snapchat verification screen stops the flow as NEEDS_HUMAN; nothing is clicked. */
async function snapchatIdentityOrChallenge(
  page: BrowserPage,
  account?: SocialAccount,
): Promise<BrowserIdentity | undefined> {
  const identity = await snapchatIdentity(page, account);
  if (identity) return identity;
  const hit = await snapchatChallenge(page);
  if (hit) throw needsHumanError(hit);
  return undefined;
}

export type SnapPost = { id: string; owner: string; text: string; at: number; url: string };
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

/**
 * Reads the Public Profile Spotlight list after a submission and accepts one new row only: exact
 * caption, fresh timestamp and a Spotlight link. Anything else is unknown, so the job waits for review.
 * shortcut: the owner username is not compared, because a UUID-selected profile has no username here;
 * verifyIdentity already binds the uploader to this profile. Not verified on live pages.
 */
export async function snapchatVerifiedSpotlight(
  ctx: BrowserRecipeContext,
  submitted: { before?: SnapPost[]; at: number; text: string },
): Promise<SocialSendResult> {
  await ctx.page.goto(SNAP_UPLOAD);
  const rows = await ctx.waitFor<SnapPost[]>(
    String.raw`(() => {
    const rows = ${snapPostsExpression()};
    return rows && rows.some(row => row.text === ${json(submitted.text)}) ? rows : undefined;
  })()`,
    60_000,
  );
  await ctx.verifyIdentity();
  const matches = rows?.filter(
    (row) =>
      row.text === submitted.text &&
      row.at >= submitted.at - 5000 &&
      row.at <= ctx.now() + 60_000 &&
      !submitted.before?.some((old) => old.id === row.id),
  );
  if (matches?.length !== 1) throw unknown();
  return { platformId: matches[0].id, url: matches[0].url };
}

/**
 * Spotlight or Public Story from the Public Profile uploader. Story has no caption or Spotlight
 * link to read back, so it is always held for review after submission.
 */
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
  const before = await ctx.page.evaluate<SnapPost[] | undefined>(snapPostsExpression());
  await guardSnapchatStep(ctx.page, () => files(ctx, snapchatUploaderSelectors.fileInput));
  const ready = await ctx.waitFor<boolean>(
    String.raw`(() => {
    const video=document.querySelector('video[aria-label="Video upload thumbnail"]');
    return !!video && document.querySelectorAll('[data-testid="small-preview-image-container"]').length<=1 && video.readyState>=1 && Number.isFinite(video.duration) && video.duration>=5 && video.duration<=60 && video.videoWidth>=540 && video.videoHeight>=960 && Math.abs(video.duration-${options.durationSeconds})<1 && video.videoWidth===${options.width} && video.videoHeight===${options.height};
  })()`,
    120_000,
  );
  if (!ready) throw await unexpectedSnapchatScreen(ctx.page);
  const selection = await selectSnapchatPublishDestination(ctx, options.target);
  if (options.target === "spotlight" && content(job))
    await guardSnapchatStep(ctx.page, () =>
      fill(ctx, snapchatUploaderSelectors.spotlightDescription, "snap-description", content(job)),
    );
  const terms = await ctx.page.evaluate<boolean>(String.raw`(() => {
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(el=>el.getClientRects().length);
    return dialogs.some(el=>/Creator Terms|Terms of Service|İçerik Üretici Koşulları|Hizmet Koşulları/i.test(el.textContent||''));
  })()`);
  if (terms) throw denied();
  const submit = await guardSnapchatStep(ctx.page, () =>
    control(ctx, snapchatUploaderSelectors.submit, "snap-post"),
  );
  await ctx.verifyIdentity();
  await verifySnapchatPublishDestination(ctx, selection);
  const at = ctx.now();
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
    if (options.target !== "spotlight") throw unknown();
    return await snapchatVerifiedSpotlight(ctx, { before, at, text: content(job) });
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
  if (!destination) throw await unexpectedSnapchatScreen(ctx.page);
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
export type SnapchatChat = { threadId: string; href: string; recipient: string };

export function snapchatChatsExpression(): string {
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
  if (!chats) throw await unexpectedSnapchatScreen(ctx.page);
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
    if (!rows) throw await unexpectedSnapchatScreen(ctx.page);
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
  await guardSnapchatStep(ctx.page, () =>
    fill(
      ctx,
      '[data-conversation-id] [data-testid="chat-input"][contenteditable="true"],[data-conversation-id] textarea[aria-label="Send a chat"]',
      "chat-text",
      job.payload.text,
    ),
  );
  const button = await guardSnapchatStep(ctx.page, () =>
    control(
      ctx,
      '[data-conversation-id] button[data-testid="send-chat"],[data-conversation-id] button[aria-label="Send"]',
      "send-chat",
    ),
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

export const snapchatBrowserRecipe: BrowserRecipe = {
  platform: "snapchat",
  loginUrl: SNAP,
  connectionUrl: snapchatBrowserConnectionUrl,
  operations: ["publish", "media", "inbox.read", "message.reply", "poll", "audience.collect"],
  identity: snapchatIdentityOrChallenge,
  send: (ctx, job) => (job.kind === "publish" ? snapchatUpload(ctx, job) : snapchatSend(ctx, job)),
  poll: snapchatPoll,
};
