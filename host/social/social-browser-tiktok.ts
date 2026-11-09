import {
  click,
  type CommentRow,
  content,
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
import type { SocialJob, TikTokCreatorInfo } from "../../src/features/social/model/social";
import type { CollectedPerson } from "../../src/integrations/social/audience-types";
import {
  SocialPlatformError,
  type SocialInbound,
  type SocialSendResult,
} from "../../src/integrations/social/adapter";
import { tiktokMode } from "../../src/integrations/social/tiktok";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { UnexpectedScreen, type ScreenSummary } from "./browser-layers/types";
import type { BrowserPage } from "./social-browser";
import type {
  BrowserIdentity,
  BrowserPollResult,
  BrowserRecipe,
  BrowserRecipeContext,
} from "./social-browser-recipe";
const TT = "https://www.tiktok.com";
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
    buttons: texts('button,[role="button"]', 20),
    fields: [...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible)
      .map(el => el.getAttribute('aria-label') || el.getAttribute('name') || el.tagName.toLowerCase()).slice(0, 20),
    headings: texts('h1,h2,h3,[role="heading"]', 10),
    errors: texts('[role="alert"]', 5, 160),
  };
})()`;
/**
 * A required element is missing: a captcha or verification page becomes NEEDS_HUMAN and is never interacted
 * with; any other page is handed to the next layer as UnexpectedScreen.
 */
async function unexpectedPage(page: BrowserPage): Promise<Error> {
  const hit = await detectChallenge(page).catch(() => null);
  if (hit && hit.kind !== "login") return needsHumanError(hit);
  const summary = await page
    .evaluate<ScreenSummary | undefined>(SCREEN_SUMMARY)
    .catch(() => undefined);
  return new UnexpectedScreen(summary ?? EMPTY_SUMMARY);
}
/** Only DOM steps are guarded; input validation keeps its own unsupported errors and runs before this. */
async function guarded<T>(ctx: BrowserRecipeContext, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "unsupported")
      throw await unexpectedPage(ctx.page);
    throw error;
  }
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
  return guarded(ctx, async () => {
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
  });
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

/** Chooses up to two of the owner's videos per round, starting at the saved cursor. */
function commentWindow(ctx: BrowserRecipeContext, posts: string[], cursor?: string) {
  const handle = /^web:tiktok:([\w.]{2,24})$/.exec(ctx.account.platformId)?.[1];
  const valid = [...new Set(posts.filter((post) => /^\d{1,30}$/.test(post)))];
  if (!handle || !valid.length) throw unsupported();
  const start = /^\d+$/.test(cursor ?? "") ? Number(cursor) % valid.length : 0;
  const count = Math.min(2, valid.length);
  const selected = Array.from({ length: count }, (_, i) => valid[(start + i) % valid.length]);
  return { handle, selected, next: String((start + count) % valid.length) };
}

/** Opens one video in Studio and returns its comment rows. A changed response is never read as empty. */
async function videoComments(
  ctx: BrowserRecipeContext,
  handle: string,
  postId: string,
): Promise<CommentRow[]> {
  const watch = ctx.page.watchResponse(
    /\/api\/comment\/list\/?$/,
    (raw) => !!tiktokCommentRows(raw, postId),
  );
  try {
    await ctx.page.goto(`${TT}/@${handle}/video/${postId}`);
    await ctx.verifyIdentity();
    const body = await watch.body(30_000);
    const rows = body && tiktokCommentRows(body, postId);
    if (!rows) throw await unexpectedPage(ctx.page);
    await ctx.verifyIdentity();
    return rows;
  } finally {
    watch.stop();
  }
}

async function tiktokPoll(
  ctx: BrowserRecipeContext,
  posts: string[],
  cursor?: string,
): Promise<BrowserPollResult> {
  const { handle, selected, next } = commentWindow(ctx, posts, cursor);
  const events: SocialInbound[] = [];
  for (const postId of selected)
    events.push(...rowsToInbound(await videoComments(ctx, handle, postId), ctx.account));
  return {
    events,
    cursor: next,
    coverage: [{ channel: "comments", status: "read" }],
  };
}

/**
 * Commenters on the owner's own videos, read from the same Studio comment responses as the poll. Not part
 * of the BrowserRecipe interface yet; the host audience collector calls it directly (see the done file).
 */
export async function tiktokCollectAudience(
  ctx: BrowserRecipeContext,
  posts: string[],
  cursor?: string,
): Promise<{ people: CollectedPerson[]; next?: string }> {
  const { handle, selected, next } = commentWindow(ctx, posts, cursor);
  const people: CollectedPerson[] = [];
  for (const postId of selected)
    for (const row of await videoComments(ctx, handle, postId))
      people.push({
        platformId: row.contactId,
        name: row.name,
        username: row.contactId.slice("web:tiktok:".length),
        kind: "comment",
        text: row.text,
        ref: postId,
        at: row.at,
      });
  return { people, next };
}

async function tiktokComment(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  const post = inputId(job.payload.objectPostId ?? job.payload.postId, /^\d{1,30}$/);
  const owner = /^web:tiktok:([\w.]{2,24})$/.exec(ctx.account.platformId)?.[1];
  const author = /^web:tiktok:([\w.]{2,24})$/.exec(job.payload.recipientId ?? "")?.[1] ?? owner;
  if (!owner || !author || job.payload.media.length || ctx.files.length) throw unsupported();
  if (job.kind === "reply") inputId(job.payload.threadId, /^\d{1,30}$/);
  return guarded(ctx, async () => {
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
  });
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
    // Inbox drafts are API-only; the browser recipe publishes directly.
    tiktokMode(options) !== "direct" ||
    !tiktokPrivacy[options.privacy] ||
    options.consent !== true ||
    !Number.isFinite(options.durationSeconds) ||
    options.durationSeconds <= 0 ||
    ctx.files.length !== 1 ||
    ctx.files[0].kind !== "video" ||
    job.payload.media.length !== 1
  )
    throw unsupported();
  return guarded(ctx, async () => {
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
  });
}

export const tiktokBrowserRecipe: BrowserRecipe = {
  platform: "tiktok",
  loginUrl: `${TT}/tiktokstudio/upload`,
  operations: ["publish", "media", "comments.read", "comment", "reply", "poll", "audience.collect"],
  identity: tiktokIdentity,
  creatorInfo: tiktokCreatorInfo,
  send: (ctx, job) =>
    job.kind === "publish"
      ? tiktokUpload(ctx, job)
      : ["comment", "reply"].includes(job.kind)
        ? tiktokComment(ctx, job)
        : Promise.reject(unsupported()),
  poll: tiktokPoll,
};
