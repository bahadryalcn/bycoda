import { SocialPlatformError, type SocialInbound } from "../../src/integrations/social/adapter";
import { UnexpectedScreen, type ScreenSummary } from "./browser-layers/types";
import type { BrowserPage } from "./social-browser";
import type { BrowserPollResult, BrowserRecipeContext } from "./social-browser-recipe";

/**
 * Telegram Web (K) inbox reading. Selector branches duplicate the Telegram branch of
 * social-browser-messaging-shared.ts because that file is shared with WhatsApp. Keep both in step.
 */
export const TELEGRAM_WEB = "https://web.telegram.org/k/";
const ORIGIN = "https://web.telegram.org";
const MAX_CHATS_PER_POLL = 5;
const MAX_TRACKED_CHATS = 200;
const PEER = /^[1-9]\d{0,19}$/;

export type TelegramCursor = { after?: string; last: Record<string, number> };
type TargetList = { recognized: boolean; peers: string[] };
type ChatMessage = { id: string; peer: string; text: string; outgoing: boolean; at?: number };
type ChatState = { recognized: boolean; peer: string; name: string; messages: ChatMessage[] };

const VISIBLE = String.raw`
  const visible = e => !!e && e.isConnected && e.getClientRects().length > 0 &&
    !e.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const text = e => (e?.innerText ?? e?.textContent ?? '').replace(/\r\n/g, '\n');
`;

/** Chat list: direct chats only. Positive IDs are users; negative IDs are groups and channels. */
const TARGETS = String.raw`(() => { ${VISIBLE}
  if (location.origin !== '${ORIGIN}') return undefined;
  const root = all('#column-left .chatlist, #column-left .chatlist-container')[0];
  if (!root) return undefined;
  const rows = all('.chatlist-chat[data-peer-id]', root).map(e => e.getAttribute('data-peer-id') || '');
  const peers = [...new Set(rows.filter(v => /^[1-9]\d{0,19}$/.test(v)))].slice(0, 200);
  const empty = !rows.length && !!root.querySelector('.chatlist-empty, .dialogs-empty');
  return rows.length || empty ? { recognized: true, peers } : undefined;
})()`;

/** One open direct chat. Returns undefined for any layout it does not recognize. */
const CHAT = String.raw`(() => { ${VISIBLE}
  if (location.origin !== '${ORIGIN}') return undefined;
  const roots = all('#column-center .chat.tabs-tab.active, #column-center .chat:not(.hide):not(.is-hidden)');
  if (roots.length !== 1) return undefined;
  const root = roots[0];
  const bubbles = all('.bubble[data-mid][data-peer-id]', root).slice(-100);
  const headers = all('.chat-info-container [data-peer-id], .chat-info [data-peer-id]', root);
  const peers = [...new Set([...headers, ...bubbles].map(e => e.getAttribute('data-peer-id')).filter(v => /^[1-9]\d{0,19}$/.test(v || '')))];
  if (peers.length !== 1 || !all('.bubbles, .bubbles-inner', root).length) return undefined;
  const peer = peers[0];
  const messages = bubbles.map(row => {
    const raw = row.getAttribute('data-mid') || '';
    const body = row.querySelector('.message');
    const copy = body ? body.cloneNode(true) : null;
    if (copy) copy.querySelectorAll('.time, .time-inner, .reply, .reply-content, .name, .forwarded-title, .reply-markup, button, .reactions').forEach(e => e.remove());
    const timestamp = Number(row.getAttribute('data-timestamp')) * 1000;
    return { id: /^[1-9]\d{0,19}$/.test(raw) ? peer + ':' + raw : '', peer, text: text(copy), outgoing: row.classList.contains('is-out'),
      at: Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : undefined };
  });
  const empty = !messages.length && !!root.querySelector('.bubbles-empty-placeholder, .chat-empty, .empty-chat');
  if (!messages.length && !empty) return undefined;
  return { recognized: true, peer, name: text(root.querySelector('.chat-info .peer-title, .chat-info-container .peer-title')).trim().slice(0, 200), messages };
})()`;

/** Text-only summary for the decision layer: no field values, no query string, no cookies. */
const SUMMARY = String.raw`(() => ({
  url: location.origin + location.pathname,
  title: (document.title || '').slice(0, 120),
  buttons: [...document.querySelectorAll('button')].slice(0, 30).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean),
  fields: [],
  headings: [...document.querySelectorAll('h1, h2, h3')].slice(0, 10).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean),
  errors: []
}))()`;

export const chatUrl = (peer: string): string => `${TELEGRAM_WEB}#${encodeURIComponent(peer)}`;

/**
 * Cursor: the last chat visited (identity, not position) and the highest message ID read per chat.
 * Legacy positional cursors from the shared recipe restart tracking once. Other shapes are refused.
 */
export function readCursor(cursor?: string): TelegramCursor {
  if (cursor === undefined) return { last: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    throw new SocialPlatformError("rejected");
  }
  const value = parsed as { v?: unknown; next?: unknown; after?: unknown; last?: unknown } | null;
  if (
    value?.v === 1 &&
    Number.isSafeInteger(value.next) &&
    (value.next as number) >= 0 &&
    (value.next as number) <= 50
  )
    return { last: {} };
  if (
    value === null ||
    value.v !== 2 ||
    typeof value.last !== "object" ||
    value.last === null ||
    Array.isArray(value.last)
  )
    throw new SocialPlatformError("rejected");
  const entries = Object.entries(value.last as Record<string, unknown>);
  if (
    entries.length > MAX_TRACKED_CHATS ||
    entries.some(
      ([peer, mid]) => !PEER.test(peer) || !Number.isSafeInteger(mid) || (mid as number) < 0,
    )
  )
    throw new SocialPlatformError("rejected");
  if (value.after !== undefined && (typeof value.after !== "string" || !PEER.test(value.after)))
    throw new SocialPlatformError("rejected");
  return {
    ...(typeof value.after === "string" ? { after: value.after } : {}),
    last: Object.fromEntries(entries) as Record<string, number>,
  };
}

export function writeCursor(state: TelegramCursor): string {
  const last = Object.fromEntries(
    Object.entries(state.last)
      .filter(([peer]) => PEER.test(peer))
      .slice(-MAX_TRACKED_CHATS),
  );
  return JSON.stringify({ v: 2, ...(state.after ? { after: state.after } : {}), last });
}

function messageNumber(id: string, peer: string): number | undefined {
  const prefix = `${peer}:`;
  if (!id.startsWith(prefix)) return undefined;
  const raw = id.slice(prefix.length);
  const value = Number(raw);
  return /^[1-9]\d{0,15}$/.test(raw) && Number.isSafeInteger(value) ? value : undefined;
}

/** Adds incoming messages newer than the saved high-water mark. Skips single messages, never the whole poll. */
function readChat(
  chat: ChatState,
  state: TelegramCursor,
  last: Record<string, number>,
  events: SocialInbound[],
  now: number,
): void {
  const previous = state.last[chat.peer];
  let high = last[chat.peer] ?? -1;
  for (const message of chat.messages) {
    const mid = messageNumber(message.id, chat.peer);
    if (mid === undefined) continue;
    high = Math.max(high, mid);
    if (message.outgoing || !message.text.trim()) continue;
    if (previous !== undefined && mid <= previous) continue;
    // A missing or future timestamp skips this message only (B08).
    if (!message.at || message.at > now + 60_000 || message.text.length > 16_000) continue;
    events.push({
      eventId: `telegram:${message.id}`,
      threadId: chat.peer,
      contactId: chat.peer,
      contactName: chat.name || chat.peer,
      kind: "message",
      text: message.text,
      at: message.at,
    });
  }
  if (high >= 0) last[chat.peer] = high;
}

export async function screenSummary(page: BrowserPage): Promise<ScreenSummary> {
  const summary = await page.evaluate<ScreenSummary | undefined>(SUMMARY).catch(() => undefined);
  return summary ?? { url: "", title: "", buttons: [], fields: [], headings: [], errors: [] };
}

/**
 * Reads direct chats in a rotating order that starts after the last chat visited, so reordering the
 * chat list does not skip or repeat chats. Groups and channels are not visited. An unrecognized chat is
 * skipped; an unrecognized chat list raises UnexpectedScreen for the layered driver.
 */
export async function telegramPoll(
  context: BrowserRecipeContext,
  cursor?: string,
): Promise<BrowserPollResult> {
  const state = readCursor(cursor);
  await context.page.goto(TELEGRAM_WEB);
  await context.verifyIdentity();
  const targets = await context.waitFor<TargetList>(TARGETS, 30_000);
  if (!targets?.recognized) throw new UnexpectedScreen(await screenSummary(context.page));
  const peers = targets.peers;
  const last: Record<string, number> = { ...state.last };
  const events: SocialInbound[] = [];
  let visited: string | undefined;
  if (peers.length) {
    const known = state.after !== undefined ? peers.indexOf(state.after) : -1;
    const first = known >= 0 ? (known + 1) % peers.length : 0;
    const count = Math.min(MAX_CHATS_PER_POLL, peers.length);
    for (let index = 0; index < count; index++) {
      const peer = peers[(first + index) % peers.length]!;
      visited = peer;
      await context.page.goto(chatUrl(peer));
      const chat = await context.waitFor<ChatState>(CHAT, 15_000);
      if (!chat?.recognized || chat.peer !== peer) continue;
      await context.verifyIdentity();
      readChat(chat, state, last, events, context.now());
    }
  }
  await context.verifyIdentity();
  return {
    events,
    cursor: writeCursor({ after: visited, last }),
    coverage: [{ channel: "messages", status: "read" }],
  };
}
