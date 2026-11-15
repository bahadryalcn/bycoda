import {
  click,
  control,
  denied,
  fill,
  inputId,
  json,
  readJson,
  submitResponse,
  unknown,
  unsupported,
} from "./social-browser-publishing-shared";
import type { SocialJob, SocialMonitorChannel } from "../../src/features/social/model/social";
import {
  type SocialInbound,
  SocialPlatformError,
  type SocialSendResult,
} from "../../src/integrations/social/adapter";
import {
  redditPayload,
  validateSubmission,
} from "../../src/integrations/social/adapters/reddit-rules";
import type {
  BrowserIdentity,
  BrowserPollResult,
  BrowserRecipe,
  BrowserRecipeContext,
} from "./social-browser-recipe";
import type { BrowserPage } from "./social-browser";
import { detectChallenge, needsHumanError } from "./browser/challenge";

/**
 * Reddit member recipe: text and link posts to one subreddit, comments, replies and an inbox poll.
 * Private messages and chat are not part of it (Reddit chat is a separate system).
 *
 * Live Reddit blocks headless automation ("blocked by network security") for a logged-out profile, so no
 * page structure was recorded. Everything that touches an unverified page element carries a
 * `// shortcut: unverified live` note; the safety rules (identity before and after, markSubmitted before the
 * irreversible click, outcome only from a recognized response plus a persisted readback) do not depend on it.
 */
const R = "https://www.reddit.com";
const TEXT_CAP = 40_000;

/**
 * The signed-in member comes from Reddit's own `/api/me.json` with the page session, so identity does not
 * depend on page markup. The id is namespaced (`web:reddit:t2_<id>`) so it never equals an API account id.
 */
const REDDIT_ME = String.raw`(async () => {
  if (location.origin !== ${json(R)} || /^\/(login|register|account|solution)(\/|$)/.test(location.pathname)) return;
  const response = await fetch('/api/me.json', { credentials: 'include', headers: { accept: 'application/json' } });
  if (!response.ok) return;
  let body; try { body = await response.json(); } catch { return; }
  const data = body && body.data;
  if (!data || typeof data.name !== 'string' || !/^[A-Za-z0-9_-]{3,20}$/.test(data.name) || data.is_suspended === true) return;
  const id = String(data.id || '').replace(/^t2_/, '');
  if (!/^[a-z0-9]{3,12}$/.test(id)) return;
  return { platformId: 'web:reddit:t2_' + id, name: data.name };
})()`;

async function redditIdentity(page: BrowserPage): Promise<BrowserIdentity | undefined> {
  return await page.evaluate<BrowserIdentity | undefined>(REDDIT_ME).catch(() => undefined);
}

/** A login, captcha or checkpoint page becomes NEEDS_HUMAN; nothing on it is touched. */
async function guard<T>(ctx: BrowserRecipeContext, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof SocialPlatformError) || error.code !== "unsupported") throw error;
    const hit = await detectChallenge(ctx.page).catch(() => null);
    if (hit) throw needsHumanError(hit);
    throw error;
  }
}

const ownId = (platformId: string) =>
  inputId(platformId, /^web:reddit:t2_[a-z0-9]{3,12}$/).slice("web:reddit:".length);
const base36 = (fullname: string) => fullname.slice(3);
const norm = String.raw`s => String(s || '').replace(/[\s*_#\x60>\[\]()~|\\!-]+/g, ' ').trim()`;

/** The recognized create response only names the new thing; it is a candidate, never delivery evidence. */
export function redditCreatedId(raw: string, prefix: "t1" | "t3"): string | undefined {
  const value = readJson(raw);
  if (!value) return undefined;
  const ids = new Set<string>();
  const direct = [
    value.json?.data?.name, // legacy /api/submit
    value.json?.data?.things?.[0]?.data?.name, // legacy /api/comment
    value.data?.createPost?.post?.id,
    value.data?.createComment?.comment?.id,
  ];
  for (const item of direct)
    if (typeof item === "string" && new RegExp(`^${prefix}_[a-z0-9]{1,30}$`).test(item))
      ids.add(item);
  // A refused write answers with errors and no id.
  if (value.json?.errors?.length || value.data?.createPost?.ok === false) return undefined;
  return ids.size === 1 ? [...ids][0] : undefined;
}
// shortcut: unverified live — verify with the owner's first Reddit session (request path and body shape).
const REDDIT_WRITE = /\/(?:svc\/shreddit\/graphql|api\/(?:submit|comment))$/;

// shortcut: unverified live — verify with the owner's first Reddit session (composer selectors).
const TITLE = 'textarea[name="title"],input[name="title"]';
const BODY = '[contenteditable="true"][name="body"],textarea[name="body"]';
const LINK = 'input[name="link"],input[name="url"]';
const POST_SUBMIT = 'button#submit-post-button,button[slot="submit-button"]';
const FLAIR_REQUIRED = '[flair-required],[data-flair-required="true"]';
const FLAIR_OPEN = '[data-testid="flair-picker-button"],r-post-flair-picker button';
const FLAIR_APPLY =
  '[role="dialog"] button[type="submit"],[role="dialog"] button[slot="primary-button"]';

function postEvidence(id: string, owner: string, title: string, text: string, link?: string) {
  return String.raw`(() => {
    const norm = ${norm};
    const posts = [...document.querySelectorAll('shreddit-post')].filter(el => el.getAttribute('id') === ${json(id)});
    if (posts.length !== 1) return false;
    const post = posts[0];
    if (post.getAttribute('author-id') !== ${json(owner)} || norm(post.getAttribute('post-title')) !== norm(${json(title)})) return false;
    ${
      link
        ? String.raw`try { return new URL(post.getAttribute('content-href') || '').href === new URL(${json(link)}).href; } catch { return false; }`
        : String.raw`const body = post.querySelector('[slot="text-body"]');
    return norm(body && body.textContent) === norm(${json(text)});`
    }
  })()`;
}

async function redditPost(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  if (ctx.files.length) throw unsupported();
  const submission = validateSubmission(job, redditPayload(job));
  if (!submission.title) throw unsupported();
  const owner = ownId(ctx.account.platformId);
  const link = submission.kind === "link" ? submission.link : undefined;
  await ctx.page.goto(
    `${R}/r/${submission.subreddit}/submit/?type=${submission.kind === "link" ? "LINK" : "TEXT"}`,
  );
  await ctx.verifyIdentity();
  const required = await ctx.page.evaluate<boolean>(
    `!!document.querySelector(${json(FLAIR_REQUIRED)})`,
  );
  // A required flair that the job does not name is refused before anything is typed or submitted.
  if (required && !submission.flairId) throw unsupported();
  await fill(ctx, TITLE, "post-title", submission.title);
  if (link) await fill(ctx, LINK, "post-link", link);
  else if (submission.text) await fill(ctx, BODY, "post-body", submission.text);
  if (submission.flairId) {
    await click(ctx, FLAIR_OPEN, "flair-open");
    await click(
      ctx,
      `[role="dialog"] input[type="radio"][value=${json(submission.flairId)}]`,
      "flair-choice",
    );
    await click(ctx, FLAIR_APPLY, "flair-apply");
  }
  // A disabled submit control (for example a missing flair) stops here, before the click.
  const id = await submitResponse(
    ctx,
    REDDIT_WRITE,
    (raw) => redditCreatedId(raw, "t3"),
    POST_SUBMIT,
    "publish",
  );
  const url = `${R}/comments/${base36(id)}/`;
  try {
    await ctx.page.goto(url);
    const persisted = await ctx.waitFor<boolean>(
      postEvidence(id, owner, submission.title, submission.text, link),
      30_000,
    );
    if (!persisted) throw unknown();
    await ctx.verifyIdentity();
    return { platformId: id, url };
  } catch {
    throw unknown();
  }
}

const COMMENT_ROW = 'shreddit-comment[thingid^="t1_"]';
// shortcut: unverified live — verify with the owner's first Reddit session (comment composer markup).
const COMMENT_EDITOR =
  '[data-bycoda-rd-composer] [contenteditable="true"],[data-bycoda-rd-composer] textarea';
const COMMENT_SUBMIT =
  '[data-bycoda-rd-composer] button[type="submit"],[data-bycoda-rd-composer] button[slot="submit-button"]';
const REPLY_LABELS = ["Reply", "Yanıtla"];

type CommentRow = { id: string; author: string; text: string };
/** Own persisted comments by thing ID. Only the comment's own text is read, never its nested replies. */
const COMMENTS_SNAPSHOT = String.raw`(() => [...document.querySelectorAll(${json(COMMENT_ROW)})].map(el => {
  const body = el.querySelector(':scope > [slot="comment"]');
  return { id: el.getAttribute('thingid'), author: el.getAttribute('author-id') || '', text: body ? body.textContent : '' };
}))()`;

async function redditComment(ctx: BrowserRecipeContext, job: SocialJob): Promise<SocialSendResult> {
  const text = job.payload.text.trim();
  if (job.payload.media.length || ctx.files.length || !text || text.length > TEXT_CAP)
    throw unsupported();
  const owner = ownId(ctx.account.platformId);
  const reply = job.kind === "reply";
  const target = inputId(job.payload.postId, reply ? /^t1_[a-z0-9]{1,30}$/ : /^t3_[a-z0-9]{1,30}$/);
  // A reply needs its post to open the thread; inbound comment events carry it as the thread ID.
  const post = reply
    ? inputId(job.payload.objectPostId ?? job.payload.threadId, /^t3_[a-z0-9]{1,30}$/)
    : target;
  const page = `${R}/comments/${base36(post)}/`;
  await ctx.page.goto(reply ? `${page}comment/${base36(target)}/` : page);
  await ctx.verifyIdentity();
  if (reply) {
    const marked = await ctx.waitFor<boolean>(
      String.raw`(() => {
        const rows = [...document.querySelectorAll(${json(COMMENT_ROW)})].filter(el => el.getAttribute('thingid') === ${json(target)});
        if (rows.length !== 1) return false;
        const buttons = [...rows[0].querySelectorAll('button')].filter(b => b.closest('shreddit-comment') === rows[0] && !b.disabled &&
          ${json(REPLY_LABELS)}.includes((b.getAttribute('aria-label') || b.textContent || '').trim()));
        if (buttons.length !== 1) return false;
        buttons[0].setAttribute('data-bycoda-rd-reply', 'true'); return true;
      })()`,
      20_000,
    );
    if (!marked) throw denied();
    await click(ctx, '[data-bycoda-rd-reply="true"]', "reply");
  }
  // The reply box opens inside its comment; the post's own box is the only host outside every comment.
  const host = await ctx.waitFor<boolean>(
    String.raw`(() => {
      const mine = [...document.querySelectorAll('comment-composer-host')].filter(el => ${reply}
        ? el.closest('shreddit-comment')?.getAttribute('thingid') === ${json(target)} : !el.closest('shreddit-comment'));
      if (mine.length !== 1) return false;
      document.querySelectorAll('[data-bycoda-rd-composer]').forEach(el => el.removeAttribute('data-bycoda-rd-composer'));
      mine[0].setAttribute('data-bycoda-rd-composer', 'true'); return true;
    })()`,
    20_000,
  );
  if (!host) throw unsupported();
  await fill(ctx, COMMENT_EDITOR, "comment-text", text);
  const before = (await ctx.page.evaluate<CommentRow[]>(COMMENTS_SNAPSHOT)).map((row) => row.id);
  const watcher = ctx.page.watchResponse(REDDIT_WRITE, (raw) => !!redditCreatedId(raw, "t1"));
  const submit = await control(ctx, COMMENT_SUBMIT, "comment-submit");
  let submitted = false;
  try {
    await ctx.verifyIdentity();
    submitted = true;
    ctx.markSubmitted?.();
    await ctx.page.click(submit);
    const raw = await watcher.body(30_000);
    const id = raw && redditCreatedId(raw, "t1");
    if (!id || before.includes(id)) throw unknown();
    // Reload the created comment: the optimistic composer echo is not delivery evidence.
    await ctx.page.goto(`${page}comment/${base36(id)}/`);
    const rows = await ctx.waitFor<CommentRow[]>(COMMENTS_SNAPSHOT, 30_000);
    await ctx.verifyIdentity();
    const squash = (value: string) => value.replace(/[\s*_#`>[\]()~|\\!-]+/g, " ").trim();
    const match = rows?.filter(
      (row) => row.id === id && row.author === owner && squash(row.text) === squash(text),
    );
    if (match?.length !== 1) throw unknown();
    return { platformId: id, url: `${page}comment/${base36(id)}/` };
  } catch (error) {
    if (submitted) throw unknown();
    throw error;
  } finally {
    watcher.stop();
  }
}

type InboxItem = {
  kind: string;
  name: string;
  author: string;
  body: string;
  at: number;
  link: string;
  type: string;
};
/** Same-origin inbox listing (comment replies, post replies, username mentions) read with the page session. */
// shortcut: unverified live — verify with the owner's first Reddit session (cookie-session JSON listing).
const inboxPage = (after?: string) => String.raw`(async () => {
  const response = await fetch('/message/inbox.json?raw_json=1&limit=100${after ? `&after=${after}` : ""}', { credentials: 'include', headers: { accept: 'application/json' } });
  if (!response.ok) return;
  let body; try { body = await response.json(); } catch { return; }
  const list = body && body.data;
  if (!list || !Array.isArray(list.children)) return;
  return { after: typeof list.after === 'string' ? list.after : '', items: list.children.map(child => { const d = (child && child.data) || {};
    return { kind: String(child && child.kind), name: String(d.name || ''), author: String(d.author || ''), body: String(d.body || ''),
      at: Number(d.created_utc) * 1000, link: String(d.link_id || ''), type: String(d.type || String(d.subject || '').replace(/\s+/g, '_')) }; }) };
})()`;

const INBOX_PAGES = 3;

async function redditPoll(
  ctx: BrowserRecipeContext,
  _posts: string[],
  cursor?: string,
): Promise<BrowserPollResult> {
  return guard(ctx, async () => {
    const since = /^\d{10,}$/.test(cursor ?? "") ? Number(cursor) : 0;
    await ctx.page.goto(`${R}/message/inbox/`);
    await ctx.verifyIdentity();
    const me = await redditIdentity(ctx.page);
    if (!me) throw unsupported();
    const items: InboxItem[] = [];
    let after = "";
    let exhausted = false;
    for (let index = 0; index < INBOX_PAGES; index++) {
      const result = await ctx.page.evaluate<{ after: string; items: InboxItem[] } | undefined>(
        inboxPage(after || undefined),
      );
      if (!result) throw unsupported();
      items.push(...result.items);
      after = result.after;
      // The listing is newest first: an item at or before the cursor means everything newer was read.
      if (!after || result.items.some((item) => item.at <= since)) {
        exhausted = true;
        break;
      }
    }
    await ctx.verifyIdentity();
    const events: SocialInbound[] = [];
    const seen = new Set<string>();
    const channels = new Set<"comments" | "mentions">();
    for (const item of items) {
      // Private messages (t4) belong to Reddit's separate chat system and are not read here.
      if (
        item.kind !== "t1" ||
        !/^t1_[a-z0-9]{1,30}$/.test(item.name) ||
        !item.author ||
        item.author === "[deleted]" ||
        item.author.toLowerCase() === me.name.toLowerCase() ||
        !item.body ||
        !Number.isFinite(item.at) ||
        item.at <= since ||
        seen.has(item.name)
      )
        continue;
      seen.add(item.name);
      channels.add(item.type === "username_mention" ? "mentions" : "comments");
      events.push({
        eventId: item.name,
        threadId: /^t3_[a-z0-9]{1,30}$/.test(item.link) ? item.link : item.name,
        postId: item.name,
        contactId: item.author,
        contactName: item.author,
        text: item.body,
        kind: "comment",
        at: item.at,
      });
    }
    const newest = items.reduce((max, item) => (item.at > max ? item.at : max), since);
    const status: SocialMonitorChannel["status"] = exhausted ? "read" : "partial";
    return {
      events: events.slice(0, 300),
      // An unfinished window keeps the old cursor so the older items are read again, never skipped.
      cursor: String(exhausted ? newest : since),
      coverage: [
        { channel: "comments", status },
        { channel: "mentions", status },
      ],
    };
  });
}

export const redditBrowserRecipe: BrowserRecipe = {
  platform: "reddit",
  loginUrl: `${R}/login/`,
  operations: ["publish", "comments.read", "comment", "reply", "poll"],
  identity: redditIdentity,
  send: (ctx, job) =>
    guard(ctx, () =>
      job.kind === "publish"
        ? redditPost(ctx, job)
        : job.kind === "comment" || job.kind === "reply"
          ? redditComment(ctx, job)
          : Promise.reject(unsupported()),
    ),
  poll: redditPoll,
};
