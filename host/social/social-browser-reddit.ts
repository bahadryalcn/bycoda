import {
  click,
  control,
  denied,
  fill,
  inputId,
  json,
  OPEN_CONTROL_QUERY,
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
 * Reddit exposes the subreddit and comment hierarchy on public permalinks. The signed-in composer
 * and its write response still require live acceptance with an owner-controlled account.
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
    value.data?.createProfilePost?.post?.id,
    value.data?.createComment?.comment?.id,
  ];
  for (const item of direct)
    if (typeof item === "string" && new RegExp(`^${prefix}_[a-z0-9]{1,30}$`).test(item))
      ids.add(item);
  // A refused write answers with errors and no id.
  if (
    value.json?.errors?.length ||
    value.data?.createPost?.ok === false ||
    value.data?.createProfilePost?.ok === false
  )
    return undefined;
  return ids.size === 1 ? [...ids][0] : undefined;
}
const REDDIT_WRITE = /\/(?:svc\/shreddit\/graphql|api\/(?:submit|comment))$/;

/** Reddit's live top-level comment response preserves HTML attribute casing. */
function redditCommentReceipt(raw: string): string | undefined {
  const jsonId = redditCreatedId(raw, "t1");
  if (jsonId) return jsonId;
  if (!/^\s*<faceplate-loader name="CreateComment_[\w-]+"/.test(raw)) return;
  const ids = new Set(
    [
      ...raw.matchAll(
        /<shreddit-comment\s+(?:[^>]*?\s)?thing[Ii][Dd]="(t1_[a-z0-9]{1,30})"(?=\s|>)/g,
      ),
    ].map((match) => match[1]),
  );
  return ids.size === 1 ? [...ids][0] : undefined;
}

const TITLE = 'textarea[name="title"],input[name="title"]';
const BODY = '[contenteditable="true"][name="body"],textarea[name="body"]';
const LINK = 'input[name="link"],input[name="url"]';
const POST_SUBMIT =
  'button#inner-post-submit-button,button#submit-post-button,button[slot="submit-button"]';
const FLAIR_REQUIRED = '[flair-required],[data-flair-required="true"]';
const FLAIR_OPEN = '[data-testid="flair-picker-button"],r-post-flair-picker button';
const FLAIR_APPLY =
  '[role="dialog"] button[type="submit"],[role="dialog"] button[slot="primary-button"]';

function withRedditTarget(ctx: BrowserRecipeContext, target: string): BrowserRecipeContext {
  return {
    ...ctx,
    controlRoot: "html",
    verifyIdentity: async () => {
      await ctx.verifyIdentity();
      if (!(await ctx.page.evaluate<boolean>(target))) throw denied();
    },
  };
}

function postEvidence(
  id: string,
  owner: string,
  subreddit: string,
  title: string,
  text: string,
  link?: string,
  profile?: string,
) {
  return String.raw`(() => {
    if (location.origin !== ${json(R)}) return false;
    const norm = ${norm};
    const posts = [...document.querySelectorAll('shreddit-post')].filter(el => el.getAttribute('id') === ${json(id)});
    if (posts.length !== 1) return false;
    const post = posts[0];
    if (post.getAttribute('author-id') !== ${json(owner)} ||
        ${
          profile
            ? `!location.pathname.toLowerCase().startsWith(${json(`/user/${profile.toLowerCase()}/comments/${base36(id)}/`)})`
            : `post.getAttribute('subreddit-name')?.toLowerCase() !== ${json(subreddit.toLowerCase())}`
        } ||
        norm(post.getAttribute('post-title')) !== norm(${json(title)})) return false;
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
  const path = `/r/${submission.subreddit}/submit`;
  await ctx.page.goto(`${R}${path}/?type=${submission.kind === "link" ? "LINK" : "TEXT"}`);
  await ctx.verifyIdentity();
  const member = /^u_/i.test(submission.subreddit) ? await redditIdentity(ctx.page) : undefined;
  const profile =
    member?.platformId === ctx.account.platformId &&
    `u_${member.name.toLowerCase()}` === submission.subreddit.toLowerCase()
      ? member.name
      : undefined;
  const targets = [path.toLowerCase()];
  if (profile) targets.push(`/user/${profile.toLowerCase()}/submit`);
  const checked = withRedditTarget(
    ctx,
    String.raw`location.origin === ${json(R)} &&
      ${json(targets)}.includes(location.pathname.replace(/\/$/, '').toLowerCase())`,
  );
  await checked.verifyIdentity();
  const required = await ctx.page.evaluate<boolean>(
    `!!document.querySelector(${json(FLAIR_REQUIRED)})`,
  );
  // A required flair that the job does not name is refused before anything is typed or submitted.
  if (required && !submission.flairId) throw unsupported();
  await fill(checked, TITLE, "post-title", submission.title);
  if (link) await fill(checked, LINK, "post-link", link);
  else if (submission.text) await fill(checked, BODY, "post-body", submission.text);
  if (submission.flairId) {
    await click(checked, FLAIR_OPEN, "flair-open");
    await click(
      checked,
      `[role="dialog"] input[type="radio"][value=${json(submission.flairId)}]`,
      "flair-choice",
    );
    await click(checked, FLAIR_APPLY, "flair-apply");
  }
  // A disabled submit control (for example a missing flair) stops here, before the click.
  // Reddit may leave the composer as soon as it accepts the post.
  let dispatched = false;
  const id = await submitResponse(
    {
      ...checked,
      verifyIdentity: () => (dispatched ? ctx : checked).verifyIdentity(),
      markSubmitted: () => {
        dispatched = true;
        ctx.markSubmitted?.();
      },
    },
    REDDIT_WRITE,
    (raw) => redditCreatedId(raw, "t3"),
    POST_SUBMIT,
    "publish",
  );
  const url = `${R}/comments/${base36(id)}/`;
  try {
    await ctx.page.goto(url);
    const persisted = await ctx.waitFor<boolean>(
      postEvidence(
        id,
        owner,
        submission.subreddit,
        submission.title,
        submission.text,
        link,
        profile,
      ),
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
const COMMENT_ROOT = "[data-bycoda-rd-composer]";
const COMMENT_EXPAND = "textarea#innerTextArea";
const COMMENT_EDITOR = '[contenteditable="true"],textarea:not(#innerTextArea)';
const COMMENT_SUBMIT =
  'button#comment-composer-submit-button,button[type="submit"],button[slot="submit-button"]';
const REPLY_LABELS = ["Reply", "Yanıtla"];

type CommentRow = {
  id: string;
  author: string;
  authorName: string;
  post: string | null;
  parent: string | null;
  text: string;
};
/** Own persisted comments by thing ID. Only the comment's own text is read, never its nested replies. */
const COMMENTS_SNAPSHOT = String.raw`(() => [...document.querySelectorAll(${json(COMMENT_ROW)})].map(el => {
  const body = [...el.querySelectorAll('[slot="comment"]')].find(node => node.closest('shreddit-comment') === el);
  return { id: el.getAttribute('thingid'), author: el.getAttribute('author-id') || '',
    authorName: el.getAttribute('author') || '',
    post: el.getAttribute('postid'), parent: el.getAttribute('parentid'), text: body ? body.textContent : '' };
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
  const checked = withRedditTarget(
    ctx,
    String.raw`location.origin === ${json(R)} &&
      /^(?:\/(?:r|user)\/[A-Za-z0-9_-]+)?\/comments\/${base36(post)}(?:\/|$)/.test(location.pathname) &&
      document.querySelectorAll('shreddit-post[id="${post}"]').length === 1`,
  );
  await ctx.page.goto(reply ? `${page}comment/${base36(target)}/` : page);
  await checked.verifyIdentity();
  const member = await redditIdentity(ctx.page);
  if (member?.platformId !== ctx.account.platformId) throw denied();
  if (reply) {
    const marked = await ctx.waitFor<boolean>(
      String.raw`(() => {
        const rows = [...document.querySelectorAll(${json(COMMENT_ROW)})].filter(el => el.getAttribute('thingid') === ${json(target)});
        if (rows.length !== 1 || rows[0].getAttribute('postid') !== ${json(post)}) return false;
        const buttons = [...rows[0].querySelectorAll('button')].filter(b => b.closest('shreddit-comment') === rows[0] && !b.disabled && b.getClientRects().length &&
          ${json(REPLY_LABELS)}.includes((b.getAttribute('aria-label') || b.textContent || '').trim()));
        if (buttons.length !== 1) return false;
        document.querySelectorAll('[data-bycoda-rd-reply]').forEach(el => el.removeAttribute('data-bycoda-rd-reply'));
        buttons[0].setAttribute('data-bycoda-rd-reply', 'true'); return true;
      })()`,
      20_000,
    );
    if (!marked) throw denied();
    await click(checked, '[data-bycoda-rd-reply="true"]', "reply");
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
  const composer = { ...checked, controlRoot: COMMENT_ROOT };
  const collapsed = await ctx.page.evaluate<boolean>(String.raw`(() => {
    const root = document.querySelector(${json(COMMENT_ROOT)});
    return !!root && ${OPEN_CONTROL_QUERY}(root, ${json(COMMENT_EXPAND)}).some(el => el.getClientRects().length && !el.hidden);
  })()`);
  if (collapsed) await click(composer, COMMENT_EXPAND, "comment-expand");
  await fill(composer, COMMENT_EDITOR, "comment-text", text);
  const before = (await ctx.page.evaluate<CommentRow[]>(COMMENTS_SNAPSHOT)).map((row) => row.id);
  const submit = await control(composer, COMMENT_SUBMIT, "comment-submit");
  const responsePath = new RegExp(
    `${REDDIT_WRITE.source}|^/svc/shreddit/(?:${post}|${target})/create-comment$`,
  );
  const watcher = ctx.page.watchResponse(responsePath, (raw) => !!redditCommentReceipt(raw));
  let submitted = false;
  try {
    await checked.verifyIdentity();
    submitted = true;
    ctx.markSubmitted?.();
    await ctx.page.click(submit);
    const raw = await watcher.body(30_000);
    const id = raw && redditCommentReceipt(raw);
    if (!id || before.includes(id)) throw unknown();
    // Reload the created comment: the optimistic composer echo is not delivery evidence.
    await ctx.page.goto(`${page}comment/${base36(id)}/`);
    const persisted = String.raw`(() => {
      const rows = ${COMMENTS_SNAPSHOT}.filter(row => row.id === ${json(id)});
      return rows.length === 1 ? rows[0] : undefined;
    })()`;
    const row = await ctx.waitFor<CommentRow>(persisted, 30_000);
    await checked.verifyIdentity();
    const squash = (value: string) => value.replace(/[\s*_#`>[\]()~|\\!-]+/g, " ").trim();
    if (
      !row ||
      (row.author
        ? row.author !== owner
        : row.authorName.toLowerCase() !== member.name.toLowerCase()) ||
      row.post !== post ||
      (reply ? row.parent !== target : row.parent !== null && row.parent !== post) ||
      squash(row.text) !== squash(text)
    )
      throw unknown();
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
  sessionUrl: `${R}/`,
  operations: ["publish", "comments.read", "comment", "reply", "poll", "delete"],
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
