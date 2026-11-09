import type { SocialJob, SocialOperation } from "../../src/features/social/model/social";
import {
  SocialPlatformError,
  type SocialInbound,
  type SocialSendResult,
} from "../../src/integrations/social/adapter";
import type { BrowserRecipeContext, BrowserPollResult } from "./social-browser-recipe";
import {
  numeric,
  object,
  values,
  at,
  mark,
  click,
  capture,
  readResponse,
  validateText,
  validateFiles,
  type Value,
} from "./social-browser-meta-shared";

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
    // Unrecognized layouts stay unsupported; a well-formed group thread is skipped instead of hiding the whole inbox.
    // shortcut: group threads are not read; upgrade when group inbox parsing is verified against a live layout.
    if (!thread) {
      if (isInstagramGroupThread(entry, actor)) continue;
      throw new SocialPlatformError("unsupported");
    }
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

function isInstagramGroupThread(value: unknown, actor: string): boolean {
  return (
    object(value) &&
    numeric(String(value.thread_id ?? "")) &&
    Array.isArray(value.users) &&
    Array.isArray(value.items) &&
    value.users.filter((entry: Value) => String(entry.pk ?? "") !== actor).length > 1
  );
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

export async function instagramPublish(context: BrowserRecipeContext, job: SocialJob) {
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

export async function instagramComment(context: BrowserRecipeContext, job: SocialJob) {
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

export async function instagramMessage(context: BrowserRecipeContext, job: SocialJob) {
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

export async function instagramPoll(
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

export const instagramOperations: SocialOperation[] = [
  "publish",
  "media",
  "comment",
  "reply",
  "comments.read",
  "inbox.read",
  "message.reply",
  "poll",
];
