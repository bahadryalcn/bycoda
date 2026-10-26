import { setTimeout as sleep } from "node:timers/promises";
import type { SocialJob } from "../src/features/social/model/social";
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

type Platform = "whatsapp" | "telegram";
type RenderedMessage = {
  id: string;
  peer: string;
  text: string;
  outgoing: boolean;
  sent: boolean;
  media: boolean;
  at?: number;
};
type ChatSnapshot = {
  recognized: boolean;
  peer?: string;
  name?: string;
  messages: RenderedMessage[];
};
const routes = {
  whatsapp: "https://web.whatsapp.com/",
  telegram: "https://web.telegram.org/k/",
} as const;
const prelude = `
  const visible = e => !!e && e.isConnected && e.getClientRects().length > 0 &&
    !e.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  const text = e => (e?.innerText ?? e?.textContent ?? '').replace(/\\r\\n/g, '\\n');
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const phone = value => {
    if (typeof value !== 'string' || !/^\\+?[\\d\\s().-]{5,32}$/.test(value.trim())) return '';
    const digits = value.replace(/\\D/g, '');
    return /^\\d{5,20}$/.test(digits) ? digits : '';
  };
`;
const originGuard = (platform: Platform) =>
  `if (location.origin !== ${JSON.stringify(new URL(routes[platform]).origin)}) return undefined;`;
const visibleSelector = (selector: string) => `(() => { ${prelude}
  const matches = all(${JSON.stringify(selector)}); return matches.length === 1 ? ${JSON.stringify(selector)} : undefined;
})()`;

async function clickUnique(page: BrowserPage, selector: string): Promise<void> {
  if (!(await page.evaluate<string | undefined>(visibleSelector(selector))))
    throw new SocialPlatformError("unsupported");
  await page.click(selector);
}

async function settled<T>(page: BrowserPage, expression: string): Promise<T | undefined> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const value = await page.evaluate<T>(expression);
    if (value) return value;
    await sleep(100);
  }
  return undefined;
}

function identityScript(platform: Platform): string {
  return `(() => { ${prelude} ${originGuard(platform)}
    const roots = all(${JSON.stringify(platform === "telegram" ? "#column-left .settings-container" : '[data-testid="drawer-left"], [role="dialog"], section[aria-label="Profile"], section[aria-label="Profil"]')});
    for (const root of roots) {
      ${
        platform === "whatsapp"
          ? `
      const title = text(root.querySelector('header, h1, h2, [role="heading"]')).trim();
      if (!/^(?:Profile|Profil|Perfil|Profilo|Профиль|プロファイル)$/i.test(title)) continue;
      if (!/(?:Your phone number|Phone number|Telefon numaranız|Telefon numarası|Número de teléfono|Numéro de téléphone)/i.test(text(root))) continue;
      `
          : ""
      }
      const candidates = [...root.querySelectorAll(${JSON.stringify(platform === "telegram" ? 'a[href^="tel:"], .row-title' : 'a[href^="tel:"], input[type="tel"], [data-testid="phone-number"], [data-testid="profile-phone"]')})].filter(visible);
      ${
        platform === "whatsapp"
          ? `
      // A display name or About value resembling a phone number is not identity evidence.
      const labels = [...root.querySelectorAll('label, div, span')].filter(e => visible(e) && !e.children.length && /^(?:Your phone number|Phone number|Telefon numaranız|Telefon numarası|Número de teléfono|Numéro de téléphone)$/i.test(text(e).trim()));
      for (const label of labels) {
        const value = label.nextElementSibling;
        if (visible(value) && phone(text(value))) candidates.push(value);
      }
      `
          : ""
      }
      const values = candidates.map(el => phone(el.getAttribute('href')?.replace(/^tel:/, '') || el.value || text(el))).filter(Boolean);
      const unique = [...new Set(values)];
      if (unique.length !== 1) continue;
      const name = text(root.querySelector('.profile-name, [data-testid="profile-name"], [data-testid="pushname"]')).trim();
      return {platformId: 'web:${platform}:+' + unique[0], name: name.slice(0, 200) || '${platform} +' + unique[0], accountType: 'member'};
    }
    return undefined;
  })()`;
}

/** Own-profile UI only. No cookie, storage, application-store or authentication-state extraction. */
async function identity(
  platform: Platform,
  page: BrowserPage,
): Promise<BrowserIdentity | undefined> {
  const existing = await page.evaluate<BrowserIdentity | undefined>(identityScript(platform));
  if (existing) return existing;
  const main = await page.evaluate<boolean>(`(() => { ${prelude} ${originGuard(platform)}
    return !!all(${JSON.stringify(platform === "telegram" ? "#column-left .chatlist, #column-left .chatlist-container" : "#pane-side")}).length;
  })()`);
  if (!main) return undefined;
  let opened = false;
  try {
    if (platform === "telegram") {
      await clickUnique(page, "#column-left .sidebar-tools-button");
      await clickUnique(page, "#column-left .btn-menu-item:has(.tgico-settings)");
    } else {
      await clickUnique(
        page,
        '#app button[aria-label="Profile"], #app button[aria-label="Profil"], #app [data-testid="profile"]',
      );
    }
    opened = true;
    return await settled<BrowserIdentity>(page, identityScript(platform));
  } catch (error) {
    if (error instanceof SocialPlatformError) return undefined;
    throw error;
  } finally {
    if (opened) {
      await clickUnique(
        page,
        platform === "telegram"
          ? "#column-left .settings-container .sidebar-close-button"
          : '[data-testid="drawer-left"] [data-testid="back"], [role="dialog"] button[aria-label="Back"], section[aria-label="Profile"] button[aria-label="Back"], section[aria-label="Profil"] button[aria-label="Geri"]',
      ).catch(() => undefined);
    }
  }
}

function peerId(platform: Platform, input: unknown): string {
  const value = typeof input === "string" ? input : "";
  if (platform === "whatsapp") {
    const match = /^(?:web:whatsapp:)?\+?(\d{5,20})(?:@(?:c\.us|s\.whatsapp\.net))?$/.exec(value);
    if (match) return match[1];
  } else if (/^-?[1-9]\d{0,19}$/.test(value)) return value;
  throw new SocialPlatformError("rejected");
}

function chatUrl(platform: Platform, peer: string): string {
  return platform === "whatsapp"
    ? `${routes.whatsapp}send?phone=${encodeURIComponent(peer)}`
    : `${routes.telegram}#${encodeURIComponent(peer)}`;
}

function snapshotScript(platform: Platform): string {
  if (platform === "telegram")
    return `(() => { ${prelude} ${originGuard(platform)}
      const roots = all('#column-center .chat.tabs-tab.active, #column-center .chat:not(.hide):not(.is-hidden)');
      if (roots.length !== 1) return {recognized: false, messages: []};
      const root = roots[0], bubbles = all('.bubble[data-mid][data-peer-id]', root).slice(-100);
      const headers = all('.chat-info-container [data-peer-id], .chat-info [data-peer-id]', root);
      const peerValues = [...new Set([...headers.map(e => e.getAttribute('data-peer-id')), ...bubbles.map(e => e.getAttribute('data-peer-id'))].filter(v => /^-?[1-9]\\d{0,19}$/.test(v || '')))];
      if (peerValues.length !== 1 || !all('.bubbles, .bubbles-inner', root).length) return {recognized: false, messages: []};
      const peer = peerValues[0];
      const messages = bubbles.map(row => {
        const raw = row.getAttribute('data-mid') || '';
        const body = row.querySelector('.message');
        const copy = body?.cloneNode(true);
        copy?.querySelectorAll('.time, .time-inner, .reply, .reply-content, .name, .forwarded-title, .reply-markup, button, .reactions').forEach(e => e.remove());
        const timestamp = Number(row.getAttribute('data-timestamp')) * 1000;
        return {id: /^[1-9]\\d{0,19}$/.test(raw) ? peer + ':' + raw : '', peer, text: text(copy), outgoing: row.classList.contains('is-out'),
          sent: (row.classList.contains('is-sent') || row.classList.contains('is-read')) && !row.classList.contains('is-sending') && !row.classList.contains('is-error') && !row.classList.contains('is-outgoing'),
          media: !!row.querySelector('.attachment, .photo, .document, video, img.media-photo'),
          at: Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : undefined};
      });
      const empty = !messages.length && !!root.querySelector('.bubbles-empty-placeholder, .chat-empty, .empty-chat');
      return {recognized: !!messages.length || empty, peer, name: text(root.querySelector('.chat-info .peer-title, .chat-info-container .peer-title')).trim().slice(0, 200), messages};
    })()`;
  return `(() => { ${prelude} ${originGuard(platform)}
    const roots = all('#main');
    if (roots.length !== 1) return {recognized: false, messages: []};
    const root = roots[0];
    const rows = all('[data-id]', root).filter(row => /^(?:true|false)_\\d{5,20}@(?:c\\.us|s\\.whatsapp\\.net)_[A-Za-z0-9]+$/.test(row.getAttribute('data-id') || '')).slice(-100);
    const peers = [...new Set(rows.map(row => row.getAttribute('data-id').split('_')[1].split('@')[0]))];
    const headerNumber = [...root.querySelectorAll('header [title], header [dir="auto"]')].map(e => phone(e.getAttribute('title') || text(e))).filter(Boolean);
    if (!peers.length) peers.push(...new Set(headerNumber));
    if (peers.length !== 1) return {recognized: false, messages: []};
    const peer = peers[0];
    const timestamp = row => {
      const iso = row.querySelector('time[datetime]')?.getAttribute('datetime');
      if (iso && Number.isFinite(Date.parse(iso))) return Date.parse(iso);
      const pre = row.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
      const m = /^\\[(\\d{1,2}):(\\d{2})(?:\\s*(AM|PM))?,\\s*(\\d{1,2})[/.](\\d{1,2})[/.](\\d{4})\\]/i.exec(pre);
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
    const messages = rows.map(row => ({id: row.getAttribute('data-id'), peer,
      text: text(row.querySelector('[data-testid="msg-text"], .selectable-text.copyable-text')),
      outgoing: row.getAttribute('data-id').startsWith('true_'),
      sent: !!row.querySelector('[data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"]') && !row.querySelector('[data-icon="msg-time"], [data-icon="msg-error"]'),
      media: !!row.querySelector('[data-testid="image-thumb"], [data-testid="media-gallery-item"], img[role="button"], video'), at: timestamp(row)}));
    const empty = !messages.length && !!root.querySelector('[data-testid="chat-empty"], [data-testid="conversation-empty"]');
    return {recognized: !!messages.length || empty, peer, name: text(root.querySelector('header [title]')).trim().slice(0, 200), messages};
  })()`;
}

async function snapshot(
  context: BrowserRecipeContext,
  platform: Platform,
  expected?: string,
): Promise<ChatSnapshot> {
  const result = await context.page.evaluate<ChatSnapshot | undefined>(snapshotScript(platform));
  if (!result?.recognized || !result.peer) throw new SocialPlatformError("unsupported");
  if (expected && result.peer !== expected) throw new SocialPlatformError("denied");
  return result;
}

function ackScript(
  platform: Platform,
  peer: string,
  expectedText: string,
  before: readonly string[],
  media: boolean,
): string {
  return `(() => {
    const state = ${snapshotScript(platform)};
    if (!state?.recognized || state.peer !== ${JSON.stringify(peer)}) return undefined;
    const before = new Set(${JSON.stringify(before)});
    const found = state.messages.filter(m => m.id && !before.has(m.id) && m.outgoing && m.sent &&
      m.text.replace(/\\r\\n/g, '\\n').trim() === ${JSON.stringify(expectedText.trim())} && m.media === ${JSON.stringify(media)});
    return found.length === 1 ? found[0] : undefined;
  })()`;
}

function persistedScript(platform: Platform, peer: string, message: RenderedMessage): string {
  return `(() => {
    const state = ${snapshotScript(platform)};
    if (!state?.recognized || state.peer !== ${JSON.stringify(peer)}) return undefined;
    return state.messages.find(m => m.id === ${JSON.stringify(message.id)} && m.outgoing && m.sent &&
      m.text.replace(/\\r\\n/g, '\\n').trim() === ${JSON.stringify(message.text.trim())} && m.media === ${JSON.stringify(message.media)});
  })()`;
}

const editors = {
  whatsapp:
    '#main footer [contenteditable="true"][role="textbox"], #main footer [contenteditable="true"][data-tab="10"]',
  telegram:
    '#column-center .chat.active .input-message-input[contenteditable="true"], #column-center .chat.active .chat-input [contenteditable="true"][role="textbox"]',
};
const submitters = {
  whatsapp:
    '#main footer [data-testid="compose-btn-send"], #main footer [data-testid="send"], #main footer button[aria-label="Send"], #main footer button[aria-label="Gönder"]',
  telegram: "#column-center .chat.active .btn-send:not(.is-hidden):not([disabled])",
};

async function attach(
  context: BrowserRecipeContext,
  platform: Platform,
  text: string,
): Promise<{ submit: string; editor: string }> {
  const { page, files } = context;
  if (files.length !== 1) throw new SocialPlatformError("unsupported");
  await clickUnique(
    page,
    platform === "whatsapp"
      ? '#main footer button[aria-label="Attach"], #main footer button[aria-label="Ekle"], #main footer [data-testid="clip"]'
      : "#column-center .chat.active attach-menu-button, #column-center .chat.active .btn-attach",
  );
  if (platform === "telegram")
    await clickUnique(page, "#column-center .chat.active .btn-menu-item:has(.tgico-image)");
  const input =
    platform === "whatsapp"
      ? 'input[type="file"][accept*="image"]'
      : '#column-center .chat.active input[type="file"][accept*="image"]';
  const count = await page.evaluate<number>(
    `document.querySelectorAll(${JSON.stringify(input)}).length`,
  );
  if (count !== 1) throw new SocialPlatformError("unsupported");
  await page.setFiles(input, [files[0].path]);
  const preview =
    platform === "whatsapp"
      ? '[data-testid="media-editor"], [role="dialog"]:has(video), [role="dialog"]:has(img[role="button"])'
      : ".popup-send-photo";
  if (!(await context.waitFor(visibleSelector(preview), 20_000)))
    throw new SocialPlatformError("unsupported");
  const caption =
    platform === "whatsapp"
      ? '[data-testid="media-editor"] [contenteditable="true"], [role="dialog"] [contenteditable="true"][role="textbox"]'
      : '.popup-send-photo [contenteditable="true"]';
  if (!(await page.evaluate(visibleSelector(caption))))
    throw new SocialPlatformError("unsupported");
  const previous = await page.evaluate<string>(
    `(() => {${prelude} return text(document.querySelector(${JSON.stringify(caption)}));})()`,
  );
  if (previous.trim()) throw new SocialPlatformError("denied");
  if (text) await page.fill(caption, text);
  const submit =
    platform === "whatsapp"
      ? '[data-testid="media-editor"] [data-testid="send"], [role="dialog"] button[aria-label="Send"], [role="dialog"] button[aria-label="Gönder"]'
      : ".popup-send-photo .btn-primary.btn-color-primary";
  return { submit, editor: caption };
}

async function send(
  platform: Platform,
  context: BrowserRecipeContext,
  job: SocialJob,
): Promise<SocialSendResult> {
  if (
    !(job.kind === "message" || (job.kind === "reply" && !job.payload.postId)) ||
    !job.payload.recipientId
  )
    throw new SocialPlatformError("unsupported");
  const peer = peerId(platform, job.payload.threadId ?? job.payload.recipientId);
  if (peerId(platform, job.payload.recipientId) !== peer) throw new SocialPlatformError("denied");
  const body = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
  if (
    (!body.trim() && !context.files.length) ||
    body.length > 4096 ||
    context.files.length > 1 ||
    job.payload.media.length !== context.files.length ||
    context.files.some((file, index) => file.kind !== job.payload.media[index]?.kind)
  )
    throw new SocialPlatformError("rejected");
  await context.verifyIdentity();
  const previousPreview = await context.page.evaluate<boolean>(
    `(() => {${prelude} return !!all('[data-testid="media-editor"], .popup-send-photo').length;})()`,
  );
  if (previousPreview) throw new SocialPlatformError("denied");
  await context.page.goto(chatUrl(platform, peer));
  if (
    !(await context.waitFor(
      `(() => {const s = ${snapshotScript(platform)}; return s?.recognized && s.peer === ${JSON.stringify(peer)};})()`,
      30_000,
    ))
  )
    throw new SocialPlatformError("denied");
  await context.verifyIdentity();
  const initial = await snapshot(context, platform, peer);
  const editor = editors[platform];
  if (!(await context.page.evaluate(visibleSelector(editor))))
    throw new SocialPlatformError("unsupported");
  // Preserve an owner's unfinished composer instead of replacing it in the saved profile.
  const draft = await context.page.evaluate<string>(
    `(() => {${prelude} return text(document.querySelector(${JSON.stringify(editor)}));})()`,
  );
  if (draft.trim()) throw new SocialPlatformError("denied");
  let submit: string, preparedEditor: string;
  if (context.files.length)
    ({ submit, editor: preparedEditor } = await attach(context, platform, body));
  else {
    await context.page.fill(editor, body);
    submit = submitters[platform];
    preparedEditor = editor;
  }
  await context.verifyIdentity();
  await snapshot(context, platform, peer);
  if (!(await context.page.evaluate(visibleSelector(submit))))
    throw new SocialPlatformError("unsupported");
  const prepared = await context.page.evaluate<string>(
    `(() => {${prelude} return text(document.querySelector(${JSON.stringify(preparedEditor)}));})()`,
  );
  if (prepared.replaceAll("\r\n", "\n").trim() !== body.trim())
    throw new SocialPlatformError("denied");
  // Any exception from the click onwards is an uncertain delivery, even if the browser closes.
  try {
    context.markSubmitted?.();
    await context.page.click(submit);
    const acknowledged = await context.waitFor<RenderedMessage>(
      ackScript(
        platform,
        peer,
        body,
        initial.messages.map((m) => m.id),
        !!context.files.length,
      ),
      30_000,
    );
    if (!acknowledged) throw new SocialPlatformError("unknown");
    await context.verifyIdentity();
    await context.page.goto(chatUrl(platform, peer));
    if (!(await context.waitFor(persistedScript(platform, peer, acknowledged), 30_000)))
      throw new SocialPlatformError("unknown");
    await context.verifyIdentity();
    return {
      platformId: `${platform}:${acknowledged.id}`,
      ...(platform === "telegram" ? { url: chatUrl(platform, peer) } : {}),
    };
  } catch {
    throw new SocialPlatformError("unknown");
  }
}

function targetsScript(platform: Platform): string {
  return `(() => { ${prelude} ${originGuard(platform)}
    const root = all(${JSON.stringify(platform === "telegram" ? "#column-left .chatlist, #column-left .chatlist-container" : "#pane-side")})[0];
    if (!root) return undefined;
    ${
      platform === "telegram"
        ? `
      const peers = [...new Set(all('.chatlist-chat[data-peer-id]', root).map(e => e.getAttribute('data-peer-id')).filter(v => /^-?[1-9]\\d{0,19}$/.test(v || '')))];
      const empty = !peers.length && !!root.querySelector('.chatlist-empty, .dialogs-empty');
      return peers.length || empty ? {recognized: true, peers: peers.slice(0, 50)} : undefined;
    `
        : `
      const rows = all('[role="row"], [role="listitem"]', root).filter(e => !e.parentElement?.closest('[role="row"], [role="listitem"]'));
      const path = e => { const parts = []; while (e && e !== root) {
        const p = e.parentElement; if (!p) return ''; parts.unshift(e.tagName.toLowerCase() + ':nth-child(' + ([...p.children].indexOf(e) + 1) + ')'); e = p;
      } return e === root ? '#pane-side > ' + parts.join(' > ') : ''; };
      const selectors = rows.slice(0, 50).map(path).filter(Boolean);
      const empty = !selectors.length && /^(?:No chats|No conversations|Henüz sohbet yok|Sohbet yok)$/im.test(text(root));
      return selectors.length || empty ? {recognized: true, selectors} : undefined;
    `
    }
  })()`;
}

async function poll(
  platform: Platform,
  context: BrowserRecipeContext,
  cursor?: string,
): Promise<BrowserPollResult> {
  let next = 0;
  if (cursor) {
    try {
      const parsed = JSON.parse(cursor);
      if (
        parsed.v !== 1 ||
        !Number.isSafeInteger(parsed.next) ||
        parsed.next < 0 ||
        parsed.next > 50
      )
        throw new Error();
      next = parsed.next;
    } catch {
      throw new SocialPlatformError("rejected");
    }
  }
  await context.page.goto(routes[platform]);
  await context.verifyIdentity();
  const targets = await context.waitFor<{
    recognized: boolean;
    peers?: string[];
    selectors?: string[];
  }>(targetsScript(platform), 30_000);
  if (!targets?.recognized) throw new SocialPlatformError("unsupported");
  const list = targets.peers ?? targets.selectors ?? [];
  const events: SocialInbound[] = [];
  const seen = new Set<string>();
  const count = Math.min(5, list.length);
  for (let index = 0; index < count; index++) {
    const position = (next + index) % list.length;
    if (platform === "telegram")
      await context.page.goto(chatUrl(platform, peerId(platform, list[position])));
    else await context.page.click(list[position]);
    const ready = await context.waitFor<ChatSnapshot>(
      `(() => {const s = ${snapshotScript(platform)}; return s?.recognized ? s : undefined;})()`,
      15_000,
    );
    if (!ready?.peer) throw new SocialPlatformError("unsupported");
    if (platform === "telegram" && ready.peer !== list[position])
      throw new SocialPlatformError("denied");
    await context.verifyIdentity();
    const state = await snapshot(context, platform, ready.peer);
    for (const item of state.messages) {
      if (item.outgoing || !item.text.trim()) continue;
      if (!item.id || !item.at || item.at > context.now() + 60_000 || item.text.length > 16_000)
        throw new SocialPlatformError("unsupported");
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      events.push({
        eventId: `${platform}:${item.id}`,
        threadId: ready.peer,
        contactId: ready.peer,
        contactName: state.name || ready.peer,
        kind: "message",
        text: item.text,
        at: item.at,
      });
    }
  }
  await context.verifyIdentity();
  return {
    events,
    cursor: JSON.stringify({ v: 1, next: list.length ? (next + count) % list.length : 0 }),
    coverage: [{ channel: "messages", status: "read" }],
  };
}

/** Personal web-session messaging; independent of WhatsApp Business and Telegram Bot API credentials. */
export const messagingBrowserRecipes: BrowserRecipe[] = (["whatsapp", "telegram"] as const).map(
  (platform) => ({
    platform,
    loginUrl: routes[platform],
    operations: ["media", "inbox.read", "message.reply", "message.start", "poll"],
    identity: (page) => identity(platform, page),
    send: (context, job) => send(platform, context, job),
    poll: (context, _posts, cursor) => poll(platform, context, cursor),
  }),
);
