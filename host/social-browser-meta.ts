import type { SocialJob, SocialOperation } from "../src/features/social/model/social";
import {
  SocialPlatformError,
  type SocialInbound,
  type SocialSendResult,
} from "../src/integrations/social/adapter";
import type { BrowserPage } from "./social-browser";
import type {
  BrowserIdentity,
  BrowserPollResult,
  BrowserRecipe,
  BrowserRecipeContext,
} from "./social-browser-recipe";

type Value = Record<string, any>;
const numeric = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,30}$/.test(value);
const object = (value: unknown): value is Value =>
  !!value && typeof value === "object" && !Array.isArray(value);
const ownText = (job: SocialJob) => [job.payload.text, job.payload.link].filter(Boolean).join("\n");

/** Meta prefixes some ordinary browser responses with an anti-XSSI guard. */
function values(raw: string, read = false): Value[] {
  if (typeof raw !== "string" || raw.length > 8 * 1024 * 1024)
    throw new SocialPlatformError(read ? "unsupported" : "unknown");
  const body = raw.replace(/^\s*for\s*\(;;\);\s*/, "").trim();
  const result: Value[] = [];
  try {
    const value = JSON.parse(body);
    if (object(value)) result.push(value);
  } catch {
    for (const line of body.split("\n").slice(0, 100)) {
      try {
        const value = JSON.parse(line);
        if (object(value)) result.push(value);
      } catch {
        // A streamed response must contain a complete recognized JSON record below.
      }
    }
  }
  if (!result.length) throw new SocialPlatformError(read ? "unsupported" : "unknown");
  for (const value of result) {
    const errors = Array.isArray(value.errors) ? value.errors : [];
    if (
      !read &&
      (errors.length || value.status === "fail" || value.error) &&
      (value.data || value.media || value.comment || value.payload)
    )
      throw new SocialPlatformError("unknown");
    if (errors.some((entry: Value) => [190, 102, 1357004].includes(Number(entry.code))))
      throw new SocialPlatformError("expired");
    if (errors.some((entry: Value) => [4, 17, 32, 613].includes(Number(entry.code))))
      throw new SocialPlatformError("rate_limit", Date.now() + 60_000);
    if (errors.length || value.status === "fail" || value.error)
      throw new SocialPlatformError("rejected");
  }
  return result;
}

function at(raw: unknown, now: number): number | undefined {
  let value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return;
  if (value > 100_000_000_000_000) value /= 1000;
  else if (value < 100_000_000_000) value *= 1000;
  return value <= now + 5 * 60_000 ? Math.trunc(value) : undefined;
}

function instagramPost(raw: unknown): { code: string; id?: string; url: string } {
  if (typeof raw !== "string") throw new SocialPlatformError("unsupported");
  const stored = /^ig:([A-Za-z0-9_-]{1,64}):(\d{1,30})$/.exec(raw);
  if (stored)
    return { code: stored[1], id: stored[2], url: `https://www.instagram.com/p/${stored[1]}/` };
  try {
    const url = new URL(raw);
    const path = /^\/(?:p|reel)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(url.pathname);
    if (
      url.origin === "https://www.instagram.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      path
    )
      return { code: path[1], url: `https://www.instagram.com/p/${path[1]}/` };
  } catch {}
  throw new SocialPlatformError("unsupported");
}

function facebookPost(raw: unknown): { id: string; url: string } {
  if (typeof raw !== "string") throw new SocialPlatformError("unsupported");
  try {
    const url = new URL(raw);
    if (url.origin !== "https://www.facebook.com" || url.username || url.password || url.hash)
      throw new Error();
    if (url.pathname === "/permalink.php") {
      const id = url.searchParams.get("story_fbid"),
        actor = url.searchParams.get("id");
      if (id && /^[A-Za-z0-9_]{1,160}$/.test(id) && numeric(actor))
        return { id, url: `https://www.facebook.com/permalink.php?story_fbid=${id}&id=${actor}` };
    }
    const post = /^\/([A-Za-z0-9.]{1,100})\/posts\/([A-Za-z0-9_]{1,160})\/?$/.exec(url.pathname);
    if (post && !url.search)
      return { id: post[2], url: `https://www.facebook.com/${post[1]}/posts/${post[2]}/` };
  } catch {}
  throw new SocialPlatformError("unsupported");
}

/** A success body must identify this actor and exact caption, not just status=ok. */
export function parseInstagramBrowserPublished(
  raw: string,
  actor: string,
  text: string,
  mediaKinds?: readonly ("image" | "video")[],
): SocialSendResult {
  const value = values(raw)[0],
    media = value.media;
  const id = String(media?.pk ?? ""),
    code = media?.code;
  if (
    value.status !== "ok" ||
    !numeric(id) ||
    typeof code !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(code) ||
    String(media?.user?.pk ?? "") !== actor ||
    String(media?.caption?.text ?? "") !== text
  )
    throw new SocialPlatformError("unknown");
  if (mediaKinds) {
    const actual =
      media.media_type === 8 && Array.isArray(media.carousel_media)
        ? media.carousel_media
        : [media];
    if (
      actual.length !== mediaKinds.length ||
      actual.some(
        (entry: Value, index: number) =>
          entry.media_type !== (mediaKinds[index] === "image" ? 1 : 2),
      )
    )
      throw new SocialPlatformError("unknown");
  }
  return { platformId: `ig:${code}:${id}`, url: `https://www.instagram.com/p/${code}/` };
}

export function parseInstagramBrowserCommented(
  raw: string,
  actor: string,
  text: string,
  parent?: string,
): SocialSendResult {
  const value = values(raw)[0],
    comment = value.comment;
  const id = String(comment?.pk ?? comment?.id ?? "");
  if (
    value.status !== "ok" ||
    !numeric(id) ||
    comment?.text !== text ||
    String(comment?.user?.pk ?? comment?.user_id ?? "") !== actor ||
    (parent ? String(comment?.parent_comment_id ?? "") !== parent : !!comment?.parent_comment_id)
  )
    throw new SocialPlatformError("unknown");
  return { platformId: id };
}

type InstagramThread = { threadId: string; contactId: string; contactName: string; items: Value[] };
function instagramThread(value: unknown, actor: string): InstagramThread | undefined {
  if (
    !object(value) ||
    !numeric(String(value.thread_id ?? "")) ||
    !Array.isArray(value.users) ||
    !Array.isArray(value.items)
  )
    return;
  const users = value.users.filter((entry: Value) => String(entry.pk ?? "") !== actor);
  if (users.length !== 1 || !numeric(String(users[0]?.pk ?? ""))) return;
  return {
    threadId: String(value.thread_id),
    contactId: String(users[0].pk),
    contactName: String(users[0].username ?? users[0].pk).slice(0, 200),
    items: value.items.slice(0, 100),
  };
}

export function parseInstagramBrowserInbox(
  raw: string,
  actor: string,
  now = Date.now(),
): SocialInbound[] {
  const value = values(raw, true)[0];
  if (value.status !== "ok" || !object(value.inbox) || !Array.isArray(value.inbox.threads))
    throw new SocialPlatformError("unsupported");
  if (value.viewer_id !== undefined && String(value.viewer_id) !== actor)
    throw new SocialPlatformError("denied");
  const events = new Map<string, SocialInbound>();
  for (const entry of value.inbox.threads.slice(0, 50)) {
    const thread = instagramThread(entry, actor);
    // Group/encrypted layouts cannot be reported as an empty, successfully read inbox.
    if (!thread) throw new SocialPlatformError("unsupported");
    for (const item of thread.items) {
      const id = String(item.item_id ?? ""),
        time = at(item.timestamp, now);
      if (
        !/^\d{1,80}$/.test(id) ||
        String(item.user_id ?? "") !== thread.contactId ||
        item.item_type !== "text" ||
        typeof item.text !== "string" ||
        item.text.length > 10_000 ||
        !time
      )
        continue;
      events.set(id, {
        eventId: `ig:message:${id}`,
        threadId: thread.threadId,
        contactId: thread.contactId,
        contactName: thread.contactName,
        text: item.text,
        kind: "message",
        at: time,
        replyAllowed: true,
      });
    }
  }
  return [...events.values()].sort((a, b) => a.at - b.at).slice(-100);
}

function instagramComments(
  raw: string,
  actor: string,
  postId: string,
  now: number,
): SocialInbound[] {
  const value = values(raw, true)[0];
  if (value.status !== "ok" || !Array.isArray(value.comments))
    throw new SocialPlatformError("unsupported");
  return value.comments.slice(0, 100).flatMap((entry: Value) => {
    const id = String(entry.pk ?? ""),
      sender = String(entry.user?.pk ?? ""),
      time = at(entry.created_at, now);
    if (
      !numeric(id) ||
      !numeric(sender) ||
      sender === actor ||
      !time ||
      typeof entry.text !== "string" ||
      entry.text.length > 10_000
    )
      return [];
    return [
      {
        eventId: `ig:comment:${id}`,
        threadId: id,
        postId,
        contactId: sender,
        contactName: String(entry.user?.username ?? sender).slice(0, 200),
        text: entry.text,
        kind: "comment" as const,
        at: time,
        replyAllowed: true,
      },
    ];
  });
}

export function parseFacebookBrowserPublished(
  raw: string,
  actor: string,
  text: string,
  mediaKinds: readonly ("image" | "video")[] = [],
): SocialSendResult {
  for (const value of values(raw)) {
    const story = value.data?.story_create?.story;
    if (!object(story)) continue;
    const actors = story.actors;
    if (
      !Array.isArray(actors) ||
      actors.length !== 1 ||
      String(actors[0]?.id ?? "") !== actor ||
      story.message?.text !== text
    )
      throw new SocialPlatformError("unknown");
    let post: ReturnType<typeof facebookPost>;
    try {
      post = facebookPost(story.url ?? story.wwwURL);
    } catch {
      throw new SocialPlatformError("unknown");
    }
    const id = String(story.legacy_fbid ?? story.post_id ?? "");
    if (!id || (id !== post.id && id !== `${actor}_${post.id}`))
      throw new SocialPlatformError("unknown");
    if (mediaKinds.length) {
      const attachments = story.attachments;
      const actual =
        Array.isArray(attachments) &&
        attachments.length === 1 &&
        Array.isArray(attachments[0]?.subattachments?.nodes)
          ? attachments[0].subattachments.nodes
          : attachments;
      if (
        !Array.isArray(actual) ||
        actual.length !== mediaKinds.length ||
        actual.some(
          (entry: Value, index: number) =>
            !entry.media?.id ||
            entry.media.__typename !== (mediaKinds[index] === "image" ? "Photo" : "Video"),
        )
      )
        throw new SocialPlatformError("unknown");
    }
    return { platformId: post.url, url: post.url };
  }
  throw new SocialPlatformError("unknown");
}

function feedbackPost(id: unknown): string | undefined {
  if (typeof id !== "string" || id.length > 500) return;
  try {
    return /^feedback:([A-Za-z0-9_]{1,160})$/.exec(Buffer.from(id, "base64").toString("utf8"))?.[1];
  } catch {
    return;
  }
}

export function parseFacebookBrowserCommented(
  raw: string,
  actor: string,
  text: string,
  postId: string,
  parent?: string,
): SocialSendResult {
  const target = facebookPost(postId);
  for (const value of values(raw)) {
    const comment = value.data?.comment_create?.comment;
    if (!object(comment)) continue;
    const id = String(comment.legacy_fbid ?? "");
    if (
      !numeric(id) ||
      comment.author?.id !== actor ||
      comment.body?.text !== text ||
      feedbackPost(comment.feedback?.id) !== target.id ||
      (parent
        ? String(comment.parent_comment?.legacy_fbid ?? "") !== parent
        : !!comment.parent_comment)
    )
      throw new SocialPlatformError("unknown");
    return { platformId: id };
  }
  throw new SocialPlatformError("unknown");
}

/** Legacy Messenger acknowledges sender, exact text, recipient and thread together. */
export function parseFacebookBrowserMessageSent(
  raw: string,
  actor: string,
  recipient: string,
  thread: string,
  text: string,
): SocialSendResult {
  const entries = values(raw).flatMap((value) =>
    Array.isArray(value.payload?.actions) ? value.payload.actions : [],
  );
  for (const entry of entries) {
    if (
      typeof entry.message_id === "string" &&
      /^mid\.[A-Za-z0-9_$.-]{1,180}$/.test(entry.message_id) &&
      entry.author === `fbid:${actor}` &&
      String(entry.other_user_fbid ?? "") === recipient &&
      String(entry.thread_fbid ?? "") === thread &&
      entry.body === text
    )
      return { platformId: entry.message_id };
  }
  throw new SocialPlatformError("unknown");
}

function facebookThreads(raw: string, actor: string, now: number): SocialInbound[] {
  const records = values(raw, true),
    events = new Map<string, SocialInbound>();
  let recognized = false;
  for (const value of records) {
    const inbox = value.data?.viewer?.message_threads;
    if (!object(inbox) || !Array.isArray(inbox.nodes)) continue;
    recognized = true;
    if (String(value.data.viewer.id ?? "") !== actor) throw new SocialPlatformError("denied");
    for (const thread of inbox.nodes.slice(0, 50)) {
      const recipient = String(thread.thread_key?.other_user_id ?? ""),
        id = String(thread.thread_key?.thread_fbid ?? "");
      if (!numeric(recipient) || !numeric(id) || !Array.isArray(thread.messages?.nodes))
        throw new SocialPlatformError("unsupported");
      for (const entry of thread.messages.nodes.slice(0, 100)) {
        const sender = String(entry.message_sender?.messaging_actor?.id ?? ""),
          time = at(entry.timestamp_precise, now);
        if (
          sender !== recipient ||
          sender === actor ||
          !time ||
          typeof entry.message_id !== "string" ||
          !/^mid\.[A-Za-z0-9_$.-]{1,180}$/.test(entry.message_id) ||
          typeof entry.message?.text !== "string" ||
          entry.message.text.length > 10_000
        )
          continue;
        events.set(entry.message_id, {
          eventId: entry.message_id,
          threadId: `fb:${id}:${recipient}`,
          contactId: recipient,
          contactName: String(thread.name ?? recipient).slice(0, 200),
          text: entry.message.text,
          kind: "message",
          at: time,
          replyAllowed: true,
        });
      }
    }
  }
  if (!recognized) throw new SocialPlatformError("unsupported");
  return [...events.values()].sort((a, b) => a.at - b.at).slice(-100);
}

function facebookFeedback(value: Value): Value | undefined {
  const feedback = value.data?.node?.feedback ?? value.data?.feedback;
  return object(feedback) ? feedback : undefined;
}

export function parseFacebookBrowserComments(
  raw: string,
  actor: string,
  postId: string,
  now = Date.now(),
): SocialInbound[] {
  const target = facebookPost(postId),
    events = new Map<string, SocialInbound>();
  let recognized = false;
  for (const value of values(raw, true)) {
    const feedback = facebookFeedback(value),
      id = feedbackPost(feedback?.id);
    if (!feedback || !Array.isArray(feedback.display_comments?.edges)) continue;
    if (id !== target.id && id !== `${actor}_${target.id}`) throw new SocialPlatformError("denied");
    recognized = true;
    for (const edge of feedback.display_comments.edges.slice(0, 100)) {
      const entry = edge?.node,
        comment = String(entry?.legacy_fbid ?? ""),
        sender = String(entry?.author?.id ?? "");
      const time = at(entry?.created_time, now);
      if (
        !numeric(comment) ||
        !numeric(sender) ||
        sender === actor ||
        !time ||
        typeof entry?.body?.text !== "string" ||
        entry.body.text.length > 10_000
      )
        continue;
      events.set(comment, {
        eventId: `fb:comment:${comment}`,
        threadId: comment,
        postId: target.url,
        contactId: sender,
        contactName: String(entry.author.name ?? sender).slice(0, 200),
        text: entry.body.text,
        kind: "comment",
        at: time,
        replyAllowed: entry.can_viewer_reply !== false,
      });
    }
  }
  if (!recognized) throw new SocialPlatformError("unsupported");
  return [...events.values()].sort((a, b) => a.at - b.at).slice(-100);
}

async function identity(
  page: BrowserPage,
  platform: "instagram" | "facebook",
): Promise<BrowserIdentity | undefined> {
  const cookies = await page.cookies([
    platform === "instagram" ? "https://www.instagram.com" : "https://www.facebook.com",
  ]);
  const single = (name: string) => {
    const found = cookies.filter((entry) => entry.name === name);
    return found.length === 1 ? found[0].value : undefined;
  };
  const current = await page.evaluate<{
    origin: string;
    path: string;
    authenticated: boolean;
    name?: string;
  }>(`(() => {
    const instagram = ${platform === "instagram"};
    const authenticated = instagram
      ? !!document.querySelector('a[href="/direct/inbox/"],a[href="/accounts/edit/"]')
      : !!document.querySelector('[role="banner"] [aria-label="Account"],[role="banner"] [aria-label="Account, your profile"],[role="banner"] [aria-label="Your profile"],[role="banner"] [aria-label="Hesabın"],[role="banner"] [aria-label="Profilin"]');
    return { origin: location.origin, path: location.pathname, authenticated };
  })()`);
  const origin =
    platform === "instagram" ? "https://www.instagram.com" : "https://www.facebook.com";
  if (
    current.origin !== origin ||
    !current.authenticated ||
    /\/(?:accounts\/login|accounts\/signup|challenge|checkpoint|login|recover)(?:\/|$)/.test(
      current.path,
    )
  )
    return;
  if (platform === "instagram") {
    const id = single("ds_user_id");
    if (!numeric(id) || !single("sessionid")) return;
    // This authenticated navigation/session evidence does not distinguish a personal account from a professional one.
    return { platformId: id, name: `Instagram ${id}` };
  }
  const user = single("c_user"),
    selected = single("i_user");
  if (!numeric(user) || !single("xs") || (selected !== undefined && !numeric(selected))) return;
  const actor = selected ?? user;
  return {
    platformId: actor,
    name: `Facebook ${actor}`,
    accountType: selected && selected !== user ? "page" : "member",
  };
}

/** Marks one visible semantic control, never the first of several matching controls. */
async function mark(
  context: BrowserRecipeContext,
  selector: string,
  labels?: readonly string[],
  timeout = 15_000,
): Promise<string> {
  const name = "data-bycoda-meta-control";
  const matched = await context.waitFor<boolean>(
    `(() => {
    const labels = ${JSON.stringify(labels ?? [])};
    const elements = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(el =>
      (el.getClientRects().length || (el.tagName === 'INPUT' && el.type === 'file')) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
      (!labels.length || labels.includes((el.getAttribute('aria-label') || el.textContent || '').trim())));
    if (elements.length !== 1) return false;
    document.querySelectorAll('[${name}]').forEach(el => el.removeAttribute('${name}'));
    elements[0].setAttribute('${name}', 'true'); return true;
  })()`,
    timeout,
  );
  if (!matched) throw new SocialPlatformError("unsupported");
  return `[${name}="true"]`;
}

async function click(context: BrowserRecipeContext, selector: string, labels?: readonly string[]) {
  await context.page.click(await mark(context, selector, labels));
}

async function capture(
  context: BrowserRecipeContext,
  path: RegExp,
  action: () => Promise<void>,
  parse: (raw: string) => SocialSendResult,
  acceptBody?: (raw: string) => boolean,
): Promise<SocialSendResult> {
  await context.verifyIdentity();
  const watcher = context.page.watchResponse(path, acceptBody);
  try {
    try {
      context.markSubmitted?.();
      await action();
    } catch {
      throw new SocialPlatformError("unknown");
    }
    const body = await watcher.body(45_000);
    if (!body) throw new SocialPlatformError("unknown");
    let result: SocialSendResult;
    try {
      result = parse(body);
    } catch (error) {
      if (
        error instanceof SocialPlatformError &&
        ["rate_limit", "expired", "rejected", "denied"].includes(error.code)
      )
        throw error;
      throw new SocialPlatformError("unknown");
    }
    try {
      await context.verifyIdentity();
    } catch {
      throw new SocialPlatformError("unknown");
    }
    return result;
  } finally {
    watcher.stop();
  }
}

async function readResponse(
  context: BrowserRecipeContext,
  url: string,
  path: RegExp,
  acceptBody?: (raw: string) => boolean,
): Promise<string> {
  const watcher = context.page.watchResponse(path, acceptBody);
  try {
    await context.page.goto(url);
    await context.verifyIdentity();
    const raw = await watcher.body(30_000);
    if (!raw) throw new SocialPlatformError("unsupported");
    await context.verifyIdentity();
    return raw;
  } finally {
    watcher.stop();
  }
}

function containsData(raw: string, key: "story_create" | "comment_create" | "viewer"): boolean {
  try {
    return values(raw, true).some((value) => object(value.data?.[key]));
  } catch {
    return false;
  }
}

function validateText(job: SocialJob) {
  const text = ownText(job);
  if (text.length > 30_000 || text.includes("\0") || (!text.trim() && !job.payload.media.length))
    throw new SocialPlatformError("rejected");
  return text;
}

function validateFiles(context: BrowserRecipeContext, job: SocialJob, required = false) {
  if (
    (required && !context.files.length) ||
    context.files.length !== job.payload.media.length ||
    context.files.length > 10 ||
    context.files.some(
      (entry, index) =>
        !entry.path ||
        entry.path.includes("\0") ||
        entry.kind === "document" ||
        entry.kind !== job.payload.media[index]?.kind,
    ) ||
    (context.files.some((entry) => entry.kind === "video") && context.files.length !== 1) ||
    job.payload.media.some((entry) => !entry.uploadId || !!entry.url)
  )
    throw new SocialPlatformError("unsupported");
}

async function instagramPublish(context: BrowserRecipeContext, job: SocialJob) {
  const text = validateText(job);
  validateFiles(context, job, true);
  await context.page.goto("https://www.instagram.com/");
  await context.verifyIdentity();
  // Instagram's desktop Create control is an accessible navigation link; the upload is then confined to its dialog.
  const create = await context.waitFor<boolean>(
    `(() => {
    const icons = [...document.querySelectorAll('svg[aria-label="New post"],svg[aria-label="Yeni gönderi"]')];
    const controls = [...new Set(icons.map(el => el.closest('a,button,[role="button"]')).filter(el => el && el.getClientRects().length))];
    if (controls.length !== 1) return false;
    controls[0].setAttribute('data-bycoda-meta-create','true'); return true;
  })()`,
    20_000,
  );
  if (!create) throw new SocialPlatformError("unsupported");
  await context.page.click('[data-bycoda-meta-create="true"]');
  const upload = await mark(context, '[role="dialog"] input[type="file"]');
  await context.verifyIdentity();
  await context.page.setFiles(
    upload,
    context.files.map((entry) => entry.path),
  );
  await click(context, '[role="dialog"] button,[role="dialog"] [role="button"]', ["Next", "İleri"]);
  const phase = await context.waitFor<{ caption: boolean; filters: boolean }>(
    `(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    const caption = !!dialog.querySelector('[contenteditable="true"][role="textbox"],textarea[aria-label="Write a caption..."],textarea[aria-label="Bir açıklama yaz..."]');
    const filters = [...dialog.querySelectorAll('button,[role="tab"],[role="button"]')].some(el =>
      el.getClientRects().length && ['Filters','Adjustments','Filtreler','Ayarlar'].includes((el.getAttribute('aria-label') || el.textContent || '').trim()));
    return caption || filters ? { caption, filters } : false;
  })()`,
    30_000,
  );
  if (!phase) throw new SocialPlatformError("unsupported");
  if (!phase.caption && phase.filters)
    await click(context, '[role="dialog"] button,[role="dialog"] [role="button"]', [
      "Next",
      "İleri",
    ]);
  else if (!phase.caption) throw new SocialPlatformError("unsupported");
  const editor = await mark(
    context,
    '[role="dialog"] [contenteditable="true"][role="textbox"],[role="dialog"] textarea[aria-label="Write a caption..."],[role="dialog"] textarea[aria-label="Bir açıklama yaz..."]',
  );
  await context.page.fill(editor, text);
  const submit = await mark(context, '[role="dialog"] button,[role="dialog"] [role="button"]', [
    "Share",
    "Paylaş",
  ]);
  return capture(
    context,
    /\/api\/v1\/media\/(?:configure|configure_sidecar|configure_to_clips)\/?(?:\?|$)/,
    () => context.page.click(submit),
    (raw) =>
      parseInstagramBrowserPublished(
        raw,
        context.account.platformId,
        text,
        context.files.map((entry) => {
          if (entry.kind === "document") throw new SocialPlatformError("unsupported");
          return entry.kind;
        }),
      ),
  );
}

async function instagramComment(context: BrowserRecipeContext, job: SocialJob) {
  const text = validateText(job),
    post = instagramPost(job.payload.postId);
  if (job.payload.media.length || !post.id) throw new SocialPlatformError("unsupported");
  const parent = job.kind === "reply" ? job.payload.threadId : undefined;
  if (parent && !numeric(parent)) throw new SocialPlatformError("unsupported");
  await context.page.goto(post.url);
  await context.verifyIdentity();
  if (parent) {
    const selected = await context.waitFor<boolean>(
      `(() => {
      const link = document.querySelector('a[href*="/c/${parent}/"]');
      const row = link?.closest('li');
      const buttons = [...(row?.querySelectorAll('button,[role="button"]') || [])].filter(el => ['Reply','Yanıtla'].includes(el.textContent.trim()) && el.getClientRects().length);
      if (buttons.length !== 1) return false;
      buttons[0].setAttribute('data-bycoda-meta-reply','true'); return true;
    })()`,
      15_000,
    );
    if (!selected) throw new SocialPlatformError("unsupported");
    await context.page.click('[data-bycoda-meta-reply="true"]');
  }
  const editor = await mark(
    context,
    'main textarea[aria-label="Add a comment…"],main textarea[aria-label="Add a comment..."],main textarea[aria-label="Yorum ekle…"],main textarea[aria-label="Yorum ekle..."]',
  );
  await context.page.fill(editor, text);
  const submit = await mark(context, 'main button,main [role="button"]', [
    "Post",
    "Paylaş",
    "Gönder",
  ]);
  return capture(
    context,
    new RegExp(`/api/v1/web/comments/${post.id}/add/(?:\\?|$)`),
    () => context.page.click(submit),
    (raw) => parseInstagramBrowserCommented(raw, context.account.platformId, text, parent),
  );
}

async function instagramMessage(context: BrowserRecipeContext, job: SocialJob) {
  const text = validateText(job),
    recipient = job.payload.recipientId,
    threadId = job.payload.threadId;
  if (
    !numeric(recipient) ||
    !numeric(threadId) ||
    recipient === context.account.platformId ||
    job.payload.media.length
  )
    throw new SocialPlatformError("unsupported");
  const url = `https://www.instagram.com/direct/t/${threadId}/`;
  const threadPath = new RegExp(`/api/v1/direct_v2/threads/${threadId}/(?:\\?|$)`);
  const before = values(await readResponse(context, url, threadPath), true)[0];
  if (
    before.status !== "ok" ||
    (before.viewer_id !== undefined && String(before.viewer_id) !== context.account.platformId)
  )
    throw new SocialPlatformError("denied");
  const thread = instagramThread(before.thread, context.account.platformId);
  if (!thread || thread.threadId !== threadId || thread.contactId !== recipient)
    throw new SocialPlatformError("denied");
  const editor = await mark(
    context,
    'main [contenteditable="true"][role="textbox"],main textarea[placeholder="Message..."],main textarea[placeholder="Mesaj..."]',
  );
  await context.page.fill(editor, text);
  const submit = await mark(context, 'main button,main [role="button"]', ["Send", "Gönder"]);
  let itemId = "";
  await capture(
    context,
    /\/api\/v1\/direct_v2\/threads\/broadcast\/text\/(?:\?|$)/,
    () => context.page.click(submit),
    (raw) => {
      const value = values(raw)[0],
        id = String(value.payload?.item_id ?? "");
      if (
        value.status !== "ok" ||
        !/^\d{1,80}$/.test(id) ||
        String(value.payload?.thread_id ?? "") !== threadId
      )
        throw new SocialPlatformError("unknown");
      itemId = id;
      return { platformId: id };
    },
  );
  // Reopen and read the persisted thread; a send response alone does not echo/verify the exact text or sender.
  try {
    const after = values(await readResponse(context, url, threadPath), true)[0];
    const persisted =
      after.status === "ok" ? instagramThread(after.thread, context.account.platformId) : undefined;
    const item = persisted?.items.find((entry) => String(entry.item_id ?? "") === itemId);
    if (
      !persisted ||
      persisted.threadId !== threadId ||
      persisted.contactId !== recipient ||
      String(item?.user_id ?? "") !== context.account.platformId ||
      item?.item_type !== "text" ||
      item?.text !== text
    )
      throw new SocialPlatformError("unknown");
    return { platformId: itemId };
  } catch {
    throw new SocialPlatformError("unknown");
  }
}

async function instagramPoll(
  context: BrowserRecipeContext,
  posts: string[],
  cursor?: string,
): Promise<BrowserPollResult> {
  const events: SocialInbound[] = [],
    coverage: NonNullable<BrowserPollResult["coverage"]> = [];
  try {
    const raw = await readResponse(
      context,
      "https://www.instagram.com/direct/inbox/",
      /\/api\/v1\/direct_v2\/inbox\/(?:\?|$)/,
    );
    events.push(...parseInstagramBrowserInbox(raw, context.account.platformId, context.now()));
    coverage.push({ channel: "messages", status: "read" });
  } catch (error) {
    if (error instanceof SocialPlatformError && ["expired", "denied"].includes(error.code))
      throw error;
    coverage.push({ channel: "messages", status: "unavailable", reason: "response_unavailable" });
  }
  const valid = posts
    .flatMap((raw) => {
      try {
        return [{ raw, post: instagramPost(raw) }];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.post.id);
  const offset = cursor && /^\d{1,6}$/.test(cursor) ? Number(cursor) : 0;
  let commentsRead = false;
  for (let i = 0; i < Math.min(2, valid.length); i++) {
    const selected = valid[(offset + i) % valid.length];
    try {
      const raw = await readResponse(
        context,
        selected.post.url,
        new RegExp(`/api/v1/media/${selected.post.id}/comments/(?:\\?|$)`),
      );
      events.push(
        ...instagramComments(raw, context.account.platformId, selected.raw, context.now()),
      );
      commentsRead = true;
    } catch (error) {
      if (error instanceof SocialPlatformError && ["expired", "denied"].includes(error.code))
        throw error;
    }
  }
  coverage.push({
    channel: "comments",
    status: commentsRead ? "read" : "unavailable",
    ...(commentsRead ? {} : { reason: "response_unavailable" as const }),
  });
  if (!coverage.some((entry) => entry.status === "read"))
    throw new SocialPlatformError("unsupported");
  return {
    events: [...new Map(events.map((entry) => [entry.eventId, entry])).values()].slice(-200),
    coverage,
    cursor: String(valid.length ? (offset + 2) % valid.length : 0),
  };
}

async function facebookPublish(context: BrowserRecipeContext, job: SocialJob) {
  const text = validateText(job);
  validateFiles(context, job);
  await context.page.goto("https://www.facebook.com/");
  await context.verifyIdentity();
  const composer = await context.waitFor<boolean>(
    `(() => {
    const controls = [...document.querySelectorAll('[role="button"]')].filter(el => el.getClientRects().length && /^(What's on your mind|Ne düşünüyorsun)/.test((el.getAttribute('aria-label') || el.textContent || '').trim()));
    if (controls.length !== 1) return false;
    controls[0].setAttribute('data-bycoda-meta-composer','true'); return true;
  })()`,
    20_000,
  );
  if (!composer) throw new SocialPlatformError("unsupported");
  await context.page.click('[data-bycoda-meta-composer="true"]');
  const editor = await mark(context, '[role="dialog"] [role="textbox"][contenteditable="true"]');
  await context.page.fill(editor, text);
  if (context.files.length) {
    const upload = await mark(
      context,
      `[role="dialog"] input[type="file"][accept*="${context.files[0].kind}"]`,
    );
    await context.verifyIdentity();
    await context.page.setFiles(
      upload,
      context.files.map((entry) => entry.path),
    );
  }
  const submit = await mark(context, '[role="dialog"] [role="button"],[role="dialog"] button', [
    "Post",
    "Paylaş",
    "Gönderi paylaş",
    "Gönder",
  ]);
  return capture(
    context,
    /\/api\/graphql\/(?:\?|$)/,
    () => context.page.click(submit),
    (raw) =>
      parseFacebookBrowserPublished(
        raw,
        context.account.platformId,
        text,
        context.files.map((entry) => {
          if (entry.kind === "document") throw new SocialPlatformError("unsupported");
          return entry.kind;
        }),
      ),
    (raw) => containsData(raw, "story_create"),
  );
}

async function facebookComment(context: BrowserRecipeContext, job: SocialJob) {
  const text = validateText(job),
    post = facebookPost(job.payload.postId);
  const parent = job.kind === "reply" ? job.payload.threadId : undefined;
  if (job.payload.media.length || (parent && !numeric(parent)))
    throw new SocialPlatformError("unsupported");
  await context.page.goto(post.url);
  await context.verifyIdentity();
  if (parent) {
    const ready = await context.waitFor<boolean>(
      `(() => {
      const anchors = [...document.querySelectorAll('a[href]')].filter(el => {
        try { return new URL(el.href).searchParams.get('comment_id') === ${JSON.stringify(parent)}; } catch { return false; }
      });
      const rows = [...new Set(anchors.map(el => el.closest('[role="article"]')).filter(Boolean))];
      if (rows.length !== 1) return false;
      const controls = [...rows[0].querySelectorAll('[role="button"],button')].filter(el => el.getClientRects().length && ['Reply','Yanıtla'].includes(el.textContent.trim()));
      if (controls.length !== 1) return false;
      controls[0].setAttribute('data-bycoda-meta-reply','true'); return true;
    })()`,
      20_000,
    );
    if (!ready) throw new SocialPlatformError("unsupported");
    await context.page.click('[data-bycoda-meta-reply="true"]');
  }
  const editor = await mark(
    context,
    '[role="main"] [role="textbox"][contenteditable="true"][aria-label^="Write a comment"],[role="main"] [role="textbox"][contenteditable="true"][aria-label^="Write a reply"],[role="main"] [role="textbox"][contenteditable="true"][aria-label^="Yorum yaz"],[role="main"] [role="textbox"][contenteditable="true"][aria-label^="Yanıt yaz"]',
  );
  await context.page.fill(editor, text);
  const submit = await mark(context, '[role="main"] [role="button"],[role="main"] button', [
    "Comment",
    "Yorum yap",
    "Reply",
    "Yanıtla",
  ]);
  return capture(
    context,
    /\/api\/graphql\/(?:\?|$)/,
    () => context.page.click(submit),
    (raw) => parseFacebookBrowserCommented(raw, context.account.platformId, text, post.url, parent),
    (raw) => containsData(raw, "comment_create"),
  );
}

async function facebookMessage(context: BrowserRecipeContext, job: SocialJob) {
  const text = validateText(job),
    recipient = job.payload.recipientId;
  const bound = /^fb:(\d{1,30}):(\d{1,30})$/.exec(job.payload.threadId ?? "");
  if (
    !numeric(recipient) ||
    !bound ||
    bound[2] !== recipient ||
    recipient === context.account.platformId ||
    job.payload.media.length
  )
    throw new SocialPlatformError("unsupported");
  const raw = await readResponse(
    context,
    `https://www.facebook.com/messages/t/${recipient}/`,
    /\/ajax\/mercury\/thread_info\.php(?:\?|$)/,
  );
  const info = values(raw, true)[0].payload?.threads;
  if (
    !Array.isArray(info) ||
    !info.some(
      (entry: Value) =>
        String(entry.thread_fbid ?? "") === bound[1] &&
        Array.isArray(entry.participants) &&
        entry.participants.length === 2 &&
        entry.participants.includes(`fbid:${context.account.platformId}`) &&
        entry.participants.includes(`fbid:${recipient}`),
    )
  )
    throw new SocialPlatformError("denied");
  const editor = await mark(
    context,
    '[role="main"] [role="textbox"][contenteditable="true"][aria-label="Message"],[role="main"] [role="textbox"][contenteditable="true"][aria-label="Mesaj"],[role="main"] [role="textbox"][contenteditable="true"][aria-label="Aa"]',
  );
  await context.page.fill(editor, text);
  const submit = await mark(context, '[role="main"] [role="button"],[role="main"] button', [
    "Send",
    "Gönder",
    "Press Enter to send",
    "Göndermek için Enter tuşuna bas",
  ]);
  return capture(
    context,
    /\/ajax\/mercury\/send_messages\.php(?:\?|$)/,
    () => context.page.click(submit),
    (body) =>
      parseFacebookBrowserMessageSent(body, context.account.platformId, recipient, bound[1], text),
  );
}

async function facebookPoll(
  context: BrowserRecipeContext,
  posts: string[],
  cursor?: string,
): Promise<BrowserPollResult> {
  const events: SocialInbound[] = [],
    coverage: NonNullable<BrowserPollResult["coverage"]> = [];
  try {
    const raw = await readResponse(
      context,
      "https://www.facebook.com/messages/",
      /\/api\/graphql\/(?:\?|$)/,
      (body) => {
        try {
          return values(body, true).some((value) => object(value.data?.viewer?.message_threads));
        } catch {
          return false;
        }
      },
    );
    events.push(...facebookThreads(raw, context.account.platformId, context.now()));
    coverage.push({ channel: "messages", status: "read" });
  } catch (error) {
    if (error instanceof SocialPlatformError && ["expired", "denied"].includes(error.code))
      throw error;
    coverage.push({ channel: "messages", status: "unavailable", reason: "response_unavailable" });
  }
  const valid = posts.flatMap((raw) => {
    try {
      return [facebookPost(raw)];
    } catch {
      return [];
    }
  });
  const offset = cursor && /^\d{1,6}$/.test(cursor) ? Number(cursor) : 0;
  let commentsRead = false;
  for (let index = 0; index < Math.min(2, valid.length); index++) {
    const target = valid[(offset + index) % valid.length];
    try {
      const raw = await readResponse(context, target.url, /\/api\/graphql\/(?:\?|$)/, (body) => {
        try {
          return values(body, true).some((value) => {
            const id = feedbackPost(facebookFeedback(value)?.id);
            return id === target.id || id === `${context.account.platformId}_${target.id}`;
          });
        } catch {
          return false;
        }
      });
      events.push(
        ...parseFacebookBrowserComments(raw, context.account.platformId, target.url, context.now()),
      );
      commentsRead = true;
    } catch (error) {
      if (error instanceof SocialPlatformError && ["expired", "denied"].includes(error.code))
        throw error;
    }
  }
  coverage.push({
    channel: "comments",
    status: commentsRead ? "read" : "unavailable",
    ...(commentsRead ? {} : { reason: "response_unavailable" as const }),
  });
  if (!coverage.some((entry) => entry.status === "read"))
    throw new SocialPlatformError("unsupported");
  return {
    events: [...new Map(events.map((entry) => [entry.eventId, entry])).values()].slice(-200),
    coverage,
    cursor: String(valid.length ? (offset + 2) % valid.length : 0),
  };
}

const instagramOperations: SocialOperation[] = [
  "publish",
  "media",
  "comment",
  "reply",
  "comments.read",
  "inbox.read",
  "message.reply",
  "poll",
];
const facebookOperations: SocialOperation[] = [
  "publish",
  "media",
  "comment",
  "reply",
  "comments.read",
  "inbox.read",
  "message.reply",
  "poll",
];

export const metaBrowserRecipes: BrowserRecipe[] = [
  {
    platform: "instagram",
    loginUrl: "https://www.instagram.com/accounts/login/",
    operations: instagramOperations,
    identity: (page) => identity(page, "instagram"),
    send: (context, job) =>
      job.kind === "publish"
        ? instagramPublish(context, job)
        : job.kind === "message" || !job.payload.postId
          ? instagramMessage(context, job)
          : instagramComment(context, job),
    poll: instagramPoll,
  },
  {
    platform: "facebook",
    loginUrl: "https://www.facebook.com/login/",
    operations: facebookOperations,
    identity: (page) => identity(page, "facebook"),
    send: (context, job) =>
      job.kind === "publish"
        ? facebookPublish(context, job)
        : job.kind === "message" || !job.payload.postId
          ? facebookMessage(context, job)
          : facebookComment(context, job),
    poll: facebookPoll,
  },
];
