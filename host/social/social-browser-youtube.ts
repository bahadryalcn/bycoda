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
import type { SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError, type SocialSendResult } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { UnexpectedScreen, type ScreenSummary } from "./browser-layers/types";
import type { BrowserPage } from "./social-browser";
import type {
  BrowserIdentity,
  BrowserPollResult,
  BrowserRecipe,
  BrowserRecipeContext,
} from "./social-browser-recipe";
const YT = "https://studio.youtube.com";
const EMPTY_SUMMARY: ScreenSummary = {
  url: "",
  title: "",
  buttons: [],
  fields: [],
  headings: [],
  errors: [],
};
/** Text-only page summary: no field values, no query string, no cookies. */
const SCREEN_SUMMARY = String.raw`(() => {
  const visible = el => !!el && el.getClientRects().length > 0;
  const texts = (selector, max, length = 80) => [...document.querySelectorAll(selector)].filter(visible)
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, length)).filter(Boolean).slice(0, max);
  return {
    url: location.origin + location.pathname,
    title: document.title.slice(0, 120),
    buttons: texts('button,ytcp-button,[role="button"]', 20),
    fields: [...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible)
      .map(el => el.getAttribute('aria-label') || el.getAttribute('name') || el.tagName.toLowerCase()).slice(0, 20),
    headings: texts('h1,h2,h3,[role="heading"]', 10),
    errors: texts('[role="alert"],tp-yt-paper-toast', 5, 160),
  };
})()`;
/**
 * A required element is missing: a captcha or verification page becomes NEEDS_HUMAN (never
 * interacted with); any other page is handed to the next layer as UnexpectedScreen.
 */
async function unexpectedPage(page: BrowserPage): Promise<Error> {
  const hit = await detectChallenge(page).catch(() => null);
  if (hit && hit.kind !== "login") return needsHumanError(hit);
  const summary = await page
    .evaluate<ScreenSummary | undefined>(SCREEN_SUMMARY)
    .catch(() => undefined);
  return new UnexpectedScreen(summary ?? EMPTY_SUMMARY);
}
/** Only DOM steps are guarded: input validation keeps its own unsupported errors. */
async function guarded<T>(ctx: BrowserRecipeContext, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "unsupported")
      throw await unexpectedPage(ctx.page);
    throw error;
  }
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
  return guarded(ctx, () => uploadVideo(ctx, job, channel, options));
}

async function uploadVideo(
  ctx: BrowserRecipeContext,
  job: SocialJob,
  channel: string,
  options: NonNullable<SocialJob["payload"]["youtube"]>,
): Promise<SocialSendResult> {
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
  if (!rows) throw await unexpectedPage(ctx.page);
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
  return guarded(ctx, () => replyInInbox(ctx, job, channel, comment));
}

async function replyInInbox(
  ctx: BrowserRecipeContext,
  job: SocialJob,
  channel: string,
  comment: string,
): Promise<SocialSendResult> {
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
  return guarded(ctx, () => commentOnVideo(ctx, job, channel, post));
}

async function commentOnVideo(
  ctx: BrowserRecipeContext,
  job: SocialJob,
  channel: string,
  post: string,
): Promise<SocialSendResult> {
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

export const youtubeBrowserRecipe: BrowserRecipe = {
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
};
