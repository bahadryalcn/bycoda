import type { SocialJob, SocialOperation } from "../../src/features/social/model/social";
import {
  SocialPlatformError,
  type SocialInbound,
  type SocialSendResult,
} from "../../src/integrations/social/adapter";
import type {
  BrowserRecipeContext,
  BrowserPollResult,
  BrowserRecipe,
} from "./social-browser-recipe";
import {
  numeric,
  object,
  values,
  at,
  identity,
  mark,
  capture,
  readResponse,
  containsData,
  validateText,
  validateFiles,
  type Value,
} from "./social-browser-meta-shared";
import {
  instagramComment,
  instagramMessage,
  instagramOperations,
  instagramPoll,
  instagramPublish,
  parseInstagramBrowserCommented,
  parseInstagramBrowserInbox,
  parseInstagramBrowserPublished,
} from "./social-browser-instagram";
export {
  parseInstagramBrowserCommented,
  parseInstagramBrowserInbox,
  parseInstagramBrowserPublished,
};

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
