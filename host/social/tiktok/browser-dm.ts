import type { SocialJob } from "../../../src/features/social/model/social";
import type { SocialInbound, SocialSendResult } from "../../../src/integrations/social/adapter";
import { needsHumanError } from "../browser/challenge";
import type { BrowserPollResult, BrowserRecipeContext } from "../social-browser-recipe";
import { denied, unknown, unsupported } from "../social-browser-publishing-shared";
import {
  guardTikTokEngagement,
  readTikTokSurface,
  requireTikTokBrowser,
  TIKTOK_CONTACT,
  TIKTOK_DOM,
  TIKTOK_WEB,
  tiktokEngagementControl,
} from "./browser-engagement";

const MESSAGES_URL = `${TIKTOK_WEB}/messages`;
const messageThreadId = /^tiktok:(\d{1,30})$/;
const inboxDom = String.raw`
  ${TIKTOK_DOM}
  if (!/^\/messages\/?$/.test(location.pathname)) return;
  const list = one('[data-e2e="message-list"],[data-e2e="chat-list"]');
  if (!list || list.getAttribute('aria-busy') === 'true') return;
  const conversations = all('[data-conversation-id]', list);
  const recipient = row => one('a[data-e2e="message-peer"][href]', row);
  const peerOf = row => handle(recipient(row)?.getAttribute('href'));
`;

/** Read only identified inbound previews. Opening chats can affect native read receipts. */
export async function tiktokMessages(ctx: BrowserRecipeContext): Promise<BrowserPollResult> {
  const owner = requireTikTokBrowser(ctx);
  await ctx.page.goto(MESSAGES_URL);
  await guardMessages(ctx);
  // shortcut: inbox previews only until TikTok web thread history has live selector evidence.
  const snapshot = await readTikTokSurface<{ events: SocialInbound[]; complete: boolean }>(
    ctx,
    String.raw`(() => {
    ${inboxDom}
    if (!conversations.length) return one('[data-e2e="no-messages"]', list) ? {events: [], complete: true} : undefined;
    const recent = conversations.slice(0, 50).map(row => {
      const author = peerOf(row), thread = row.getAttribute('data-conversation-id');
      const preview = one('[data-e2e="message-preview"][data-message-id]', row);
      const message = preview?.getAttribute('data-message-id'), direction = preview?.getAttribute('data-direction');
      const when = at(one('time[datetime]', row)), body = text(preview);
      if (!author || author === ${JSON.stringify(owner)} || !id(thread) || !id(message) || !['incoming', 'outgoing'].includes(direction)) return;
      if (direction === 'outgoing') return null;
      if (!body || !Number.isFinite(when) || when <= 0) return;
      return { eventId: 'tiktok:dm:' + thread + ':' + message, threadId: 'tiktok:' + thread, contactId: 'web:tiktok:' + author,
        contactName: text(recipient(row)) || author, kind: 'message', text: body, at: when };
    });
    if (recent.every(value => value === undefined)) return;
    return { events: recent.filter(Boolean), complete: false };
  })()`,
  );
  await guardMessages(ctx);
  return {
    events: [...new Map(snapshot.events.map((event) => [event.eventId, event])).values()],
    coverage: [{ channel: "messages", status: snapshot.complete ? "read" : "partial" }],
  };
}

async function guardMessages(ctx: BrowserRecipeContext): Promise<void> {
  const restricted = await ctx.page.evaluate<boolean>(String.raw`(() => {
    ${TIKTOK_DOM}
    return all('[data-e2e="message-restricted"],[data-e2e="message-request-pending"],[data-e2e="message-privacy-warning"]').length > 0 ||
      all('[role="alert"],[role="status"]').some(el => /^(?:You (?:can.t|cannot) (?:send (?:a message|messages)|message this user)|Message request (?:pending|sent)|Bu kullanıcıya mesaj gönderemezsin|Mesaj isteği beklemede)[.!]?$/i.test(text(el)));
  })()`);
  if (restricted) throw needsHumanError({ kind: "verification", url: MESSAGES_URL });
  await guardTikTokEngagement(ctx);
}

function existingThread(peer: string, thread?: string) {
  return String.raw`(() => {
    ${inboxDom}
    if (!conversations.length && !one('[data-e2e="no-messages"]', list)) return;
    const matches = conversations.filter(row => peerOf(row) === ${JSON.stringify(peer)} &&
      (${JSON.stringify(thread ?? null)} === null || row.getAttribute('data-conversation-id') === ${JSON.stringify(thread ?? null)}));
    if (!matches.length) return 'missing';
    if (matches.length !== 1 || !id(matches[0].getAttribute('data-conversation-id'))) return;
    const open = one('button[data-e2e="conversation-open"],a[data-e2e="conversation-open"]', matches[0]);
    return mark(open, 'dm-open') ? 'ready' : undefined;
  })()`;
}

async function openThread(ctx: BrowserRecipeContext, peer: string, thread?: string) {
  await ctx.page.goto(MESSAGES_URL);
  await guardMessages(ctx);
  const target = await readTikTokSurface<"ready" | "missing">(ctx, existingThread(peer, thread));
  if (target === "ready") {
    await guardMessages(ctx);
    await ctx.page.click(tiktokEngagementControl("dm-open"));
    return;
  }
  if (thread) throw denied();
  await ctx.page.goto(`${TIKTOK_WEB}/@${peer}`);
  await guardMessages(ctx);
  await readTikTokSurface<boolean>(
    ctx,
    String.raw`(() => {
    ${TIKTOK_DOM}
    if (handle(location.href) !== ${JSON.stringify(peer)}) return;
    const profile = one('[data-e2e="user-page"] main,main[data-e2e="user-page"],[data-e2e="user-profile"]');
    if (!profile) return;
    const button = one('button[data-e2e="message-button"],a[data-e2e="message-button"]', profile);
    return mark(button, 'dm-new');
  })()`,
  );
  await guardMessages(ctx);
  await ctx.page.click(tiktokEngagementControl("dm-new"));
}

// shortcut: send acknowledgements require a bound DOM message ID and a second read after navigation.
function threadDom(peer: string, thread?: string) {
  return String.raw`
    ${TIKTOK_DOM}
    if (!/^\/messages\/?$/.test(location.pathname) && handle(location.href) !== ${JSON.stringify(peer)}) return;
    const panel = one('[data-e2e="chat-conversation"]');
    if (!panel || panel.getAttribute('aria-busy') === 'true') return;
    const recipient = one('a[data-e2e="chat-peer"][href]', panel);
    const conversationId = panel.getAttribute('data-conversation-id');
    if (handle(recipient?.getAttribute('href')) !== ${JSON.stringify(peer)} ||
        (${JSON.stringify(thread ?? null)} !== null && conversationId !== ${JSON.stringify(thread ?? null)})) return;
    const history = one('[data-e2e="chat-history"]', panel);
    if (!history || history.getAttribute('aria-busy') === 'true') return;
    const outgoing = all('[data-message-id][data-direction="outgoing"][data-status="sent"]', history);
  `;
}

function messageEvidence(
  peer: string,
  thread: string | undefined,
  body: string,
  existing: string[],
  exact?: string,
) {
  return String.raw`(() => {
    ${threadDom(peer, thread)}
    if (!id(conversationId)) return;
    const previous = ${JSON.stringify(existing)}, exact = ${JSON.stringify(exact ?? null)};
    const candidates = outgoing.filter(el => {
      const message = el.getAttribute('data-message-id');
      return id(message) && !previous.includes(message) && (exact === null || exact === message) &&
        text(one('[data-e2e="chat-message-text"]', el)) === ${JSON.stringify(body)};
    });
    if (candidates.length !== 1) return;
    return { id: candidates[0].getAttribute('data-message-id'), thread: conversationId };
  })()`;
}

/** Recipient and conversation are verified on the site before filling and again before submission. */
export async function tiktokDirectMessage(
  ctx: BrowserRecipeContext,
  job: SocialJob,
  authorize = ctx.beforeSubmit,
): Promise<SocialSendResult> {
  const owner = requireTikTokBrowser(ctx);
  const peer = TIKTOK_CONTACT.exec(job.payload.recipientId ?? "")?.[1];
  const thread = job.payload.threadId && messageThreadId.exec(job.payload.threadId)?.[1];
  if (!authorize || !peer || owner === peer || (job.payload.threadId && !thread)) throw denied();
  const body = job.payload.text.replaceAll("\r\n", "\n").trim();
  if (
    (job.kind !== "message" && job.kind !== "reply") ||
    job.payload.postId ||
    job.payload.objectPostId ||
    !body ||
    ctx.files.length ||
    job.payload.media.length ||
    job.payload.link
  )
    throw unsupported();
  await openThread(ctx, peer, thread);
  await guardMessages(ctx);
  const before = await readTikTokSurface<{ ids: string[]; draft: string; thread: string | null }>(
    ctx,
    String.raw`(() => {
    ${threadDom(peer, thread)}
    const editor = one('[data-e2e="chat-input"][contenteditable="true"]', panel);
    if ((conversationId !== null && !id(conversationId)) || !mark(editor, 'dm-editor')) return;
    const existing = all('[data-message-id]', history);
    if (existing.some(el => !id(el.getAttribute('data-message-id')))) return;
    return { ids: existing.map(el => el.getAttribute('data-message-id')), draft: text(editor), thread: conversationId };
  })()`,
  );
  if (before.draft) throw denied();
  await guardMessages(ctx);
  await ctx.page.fill(tiktokEngagementControl("dm-editor"), body);
  const submit = String.raw`(() => {
    ${threadDom(peer, before.thread ?? undefined)}
    if (text(one('[data-e2e="chat-input"][contenteditable="true"]', panel)) !== ${JSON.stringify(body)}) return;
    return mark(one('button[data-e2e="chat-send"]', panel), 'dm-send');
  })()`;
  try {
    await readTikTokSurface<boolean>(ctx, submit);
  } catch (error) {
    await guardMessages(ctx);
    throw error;
  }
  await authorize();
  await guardMessages(ctx);
  if (!(await ctx.page.evaluate<boolean>(submit))) throw denied();
  try {
    ctx.markSubmitted?.();
    await ctx.page.click(tiktokEngagementControl("dm-send"));
    const receipt = await readTikTokSurface<{ id: string; thread: string }>(
      ctx,
      messageEvidence(peer, before.thread ?? undefined, body, before.ids),
    );
    await openThread(ctx, peer, receipt.thread);
    await readTikTokSurface(ctx, messageEvidence(peer, receipt.thread, body, [], receipt.id));
    return { platformId: `tiktok:dm:${receipt.thread}:${receipt.id}` };
  } catch {
    throw unknown();
  }
}
