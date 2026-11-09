import { SocialPlatformError, type SocialInbound } from "../../src/integrations/social/adapter";
import { UnexpectedScreen, type ScreenSummary } from "./browser-layers/types";
import type { BrowserPage } from "./social-browser";
import type { BrowserPollResult, BrowserRecipeContext } from "./social-browser-recipe";

/**
 * WhatsApp Web personal inbox reading. The selector branches duplicate the WhatsApp poll branch of
 * social-browser-messaging-shared.ts, which is shared with Telegram; this file owns the WhatsApp copy (B08).
 * Sending stays in the shared code.
 */
export const WHATSAPP_WEB = "https://web.whatsapp.com/";
const ORIGIN = "https://web.whatsapp.com";
const MAX_CHATS_PER_POLL = 5;
const MAX_CHAT_POSITIONS = 50;
const MAX_MESSAGE_TEXT = 16_000;
const CLOCK_SKEW_MS = 60_000;

type TargetList = { recognized: boolean; selectors: string[] };
type ChatMessage = { id: string; text: string; outgoing: boolean; at?: number };
/** `group` is a determinate skip; `recognized: false` without `group` is an unknown direct chat. */
type ChatState = {
  recognized: boolean;
  group?: boolean;
  peer?: string;
  name?: string;
  messages: ChatMessage[];
};

const VISIBLE = String.raw`
  const visible = e => !!e && e.isConnected && e.getClientRects().length > 0 &&
    !e.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const text = e => (e?.innerText ?? e?.textContent ?? '').replace(/\r\n/g, '\n');
  const phone = value => {
    if (typeof value !== 'string' || !/^\+?[\d\s().-]{5,32}$/.test(value.trim())) return '';
    const digits = value.replace(/\D/g, '');
    return /^\d{5,20}$/.test(digits) ? digits : '';
  };
`;

/** Chat list rows as positional selectors. Groups are rows like any other; the chat check decides. */
const TARGETS = String.raw`(() => { ${VISIBLE}
  if (location.origin !== '${ORIGIN}') return undefined;
  const root = all('#pane-side')[0];
  if (!root) return undefined;
  const rows = all('[role="row"], [role="listitem"]', root).filter(e => !e.parentElement?.closest('[role="row"], [role="listitem"]'));
  const path = e => { const parts = []; let node = e; while (node && node !== root) {
    const p = node.parentElement; if (!p) return ''; parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + ([...p.children].indexOf(node) + 1) + ')'); node = p;
  } return node === root ? '#pane-side > ' + parts.join(' > ') : ''; };
  const selectors = rows.slice(0, ${MAX_CHAT_POSITIONS}).map(path).filter(Boolean);
  const empty = !selectors.length && /^(?:No chats|No conversations|Henüz sohbet yok|Sohbet yok)$/im.test(text(root));
  return selectors.length || empty ? { recognized: true, selectors } : undefined;
})()`;

/**
 * One open chat. Returns undefined while the chat is still loading or its layout is unknown (the caller's
 * wait then times out). A group returns a determinate skip; a direct chat returns its incoming messages.
 */
const CHAT = String.raw`(() => { ${VISIBLE}
  if (location.origin !== '${ORIGIN}') return undefined;
  const roots = all('#main');
  if (roots.length !== 1) return undefined;
  const root = roots[0];
  const rowsAll = all('[data-id]', root);
  if (rowsAll.some(row => /@g\.us/.test(row.getAttribute('data-id') || ''))) return { recognized: false, group: true, messages: [] };
  const rows = rowsAll.filter(row => /^(?:true|false)_\d{5,20}@(?:c\.us|s\.whatsapp\.net)_[A-Za-z0-9]+$/.test(row.getAttribute('data-id') || '')).slice(-100);
  const peers = [...new Set(rows.map(row => row.getAttribute('data-id').split('_')[1].split('@')[0]))];
  const headerNumber = [...root.querySelectorAll('header [title], header [dir="auto"]')].map(e => phone(e.getAttribute('title') || text(e))).filter(Boolean);
  if (!peers.length) peers.push(...new Set(headerNumber));
  const empty = !rows.length && !!root.querySelector('[data-testid="chat-empty"], [data-testid="conversation-empty"]');
  if (peers.length !== 1) return rows.length || empty ? { recognized: false, messages: [] } : undefined;
  const peer = peers[0];
  const timestamp = row => {
    const iso = row.querySelector('time[datetime]')?.getAttribute('datetime');
    if (iso && Number.isFinite(Date.parse(iso))) return Date.parse(iso);
    const pre = row.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
    const m = /^\[(\d{1,2}):(\d{2})(?:\s*(AM|PM))?,\s*(\d{1,2})[/.](\d{1,2})[/.](\d{4})\]/i.exec(pre);
    if (!m) return undefined;
    const lang = document.documentElement.lang.toLowerCase();
    if (!/^(?:en(?:-us)?|tr(?:-tr)?|de(?:-de)?|fr(?:-fr)?|es(?:-es)?)$/.test(lang)) return undefined;
    const monthFirst = /^en(?:-us)?$/.test(lang);
    let hour = Number(m[1]); if (m[3]) hour = hour % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0);
    const month = Number(m[monthFirst ? 4 : 5]), day = Number(m[monthFirst ? 5 : 4]);
    const date = new Date(Number(m[6]), month - 1, day, hour, Number(m[2]));
    if (date.getFullYear() !== Number(m[6]) || date.getMonth() !== month - 1 || date.getDate() !== day || hour > 23 || Number(m[2]) > 59) return undefined;
    return date.getTime();
  };
  const messages = rows.map(row => ({ id: row.getAttribute('data-id'),
    text: text(row.querySelector('[data-testid="msg-text"], .selectable-text.copyable-text')),
    outgoing: row.getAttribute('data-id').startsWith('true_'), at: timestamp(row) }));
  if (!messages.length && !empty) return undefined;
  return { recognized: true, peer, name: text(root.querySelector('header [title]')).trim().slice(0, 200), messages };
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

/** Cursor: the next chat position to visit. Positions advance on every visit, skipped chats included. */
export function readCursor(cursor?: string): number {
  if (cursor === undefined) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    throw new SocialPlatformError("rejected");
  }
  const value = parsed as { v?: unknown; next?: unknown } | null;
  const next = value?.next;
  if (
    value?.v !== 1 ||
    !Number.isSafeInteger(next) ||
    (next as number) < 0 ||
    (next as number) > MAX_CHAT_POSITIONS
  )
    throw new SocialPlatformError("rejected");
  return next as number;
}

export function writeCursor(next: number): string {
  return JSON.stringify({ v: 1, next });
}

export async function screenSummary(page: BrowserPage): Promise<ScreenSummary> {
  const summary = await page.evaluate<ScreenSummary | undefined>(SUMMARY).catch(() => undefined);
  return summary ?? { url: "", title: "", buttons: [], fields: [], headings: [], errors: [] };
}

/** Adds incoming messages with a usable timestamp. A missing or future timestamp skips that message only (B08). */
function readChat(peer: string, chat: ChatState, now: number, events: SocialInbound[]): void {
  for (const message of chat.messages) {
    if (!message.id || message.outgoing || !message.text.trim()) continue;
    if (!message.at || message.at > now + CLOCK_SKEW_MS || message.text.length > MAX_MESSAGE_TEXT)
      continue;
    events.push({
      eventId: `whatsapp:${message.id}`,
      threadId: peer,
      contactId: peer,
      contactName: chat.name || peer,
      kind: "message",
      text: message.text,
      at: message.at,
    });
  }
}

/**
 * Reads up to five chat positions starting at the saved cursor. Groups are skipped without failing the poll,
 * and the cursor always advances (B08). Only when every visited direct chat is unrecognized is the layout
 * treated as changed and handed to the layered driver as UnexpectedScreen.
 */
export async function whatsappPoll(
  context: BrowserRecipeContext,
  cursor?: string,
): Promise<BrowserPollResult> {
  const start = readCursor(cursor);
  await context.page.goto(WHATSAPP_WEB);
  await context.verifyIdentity();
  const targets = await context.waitFor<TargetList>(TARGETS, 30_000);
  if (!targets?.recognized) throw new UnexpectedScreen(await screenSummary(context.page));
  const list = targets.selectors;
  const count = Math.min(MAX_CHATS_PER_POLL, list.length);
  const events: SocialInbound[] = [];
  let attempted = 0;
  let unrecognized = 0;
  for (let index = 0; index < count; index++) {
    await context.page.click(list[(start + index) % list.length]!);
    const chat = await context.waitFor<ChatState>(CHAT, 15_000);
    if (chat?.group) continue;
    attempted++;
    const peer = chat?.recognized ? chat.peer : undefined;
    if (!chat || !peer) {
      unrecognized++;
      continue;
    }
    await context.verifyIdentity();
    readChat(peer, chat, context.now(), events);
  }
  if (attempted > 0 && unrecognized === attempted)
    throw new UnexpectedScreen(await screenSummary(context.page));
  await context.verifyIdentity();
  return {
    events,
    cursor: writeCursor(list.length ? (start + count) % list.length : 0),
    coverage: [{ channel: "messages", status: "read" }],
  };
}
