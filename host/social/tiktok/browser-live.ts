import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { denied, json, unknown, unsupported } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import {
  assertNoTikTokChallenge,
  creatorExpression,
  markedTikTokCreatorControl,
  openTikTokCreatorPage,
  ownerHandle,
  readTikTokCreatorPage,
  submitTikTokCreatorAction,
  TIKTOK_ORIGIN,
  TIKTOK_WEB_ID,
} from "./browser-creator-page";

const LIVE_ORIGIN = "https://livecenter.tiktok.com";
const PRODUCER_PATH = "/producer";
export const TIKTOK_LIVE_PRODUCER_URL = `${LIVE_ORIGIN}${PRODUCER_PATH}`;
export type TikTokLiveCredential = { serverUrl: string; streamKey: string };

function liveExpression(owner: string, body: string) {
  return creatorExpression(
    PRODUCER_PATH,
    String.raw`
    const profile = one(document, 'header a[data-e2e="nav-profile"],header a[data-e2e="live-account"]');
    if (!profile) return;
    const account = new URL(profile.getAttribute('href'), ${json(TIKTOK_ORIGIN)});
    if (account.origin !== ${json(TIKTOK_ORIGIN)} ||
        account.pathname.replace(/\/$/, '').toLowerCase() !== ${json(`/@${owner}`)}) return;
    ${body}
  `,
    LIVE_ORIGIN,
  );
}

async function openLive(ctx: BrowserRecipeContext) {
  const owner = ownerHandle(ctx);
  await openTikTokCreatorPage(ctx, `/@${owner}`);
  await ctx.page.goto(TIKTOK_LIVE_PRODUCER_URL);
  // Avoid the generic identity layer on a page that can display credentials.
  const live: BrowserRecipeContext = {
    ...ctx,
    verifyIdentity: async () => {
      if (!(await ctx.page.evaluate<boolean>(liveExpression(owner, "return true;"))))
        throw denied();
    },
  };
  try {
    const bound = await live.waitFor<boolean>(liveExpression(owner, "return true;"), 12_000);
    await assertNoTikTokChallenge(live);
    if (!bound) throw denied();
  } catch (error) {
    await ctx.page.goto(`${TIKTOK_ORIGIN}/@${owner}`).catch(() => undefined);
    throw error;
  }
  return { live, owner };
}

function validIngestServer(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "rtmp:" || url.protocol === "rtmps:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.hostname.endsWith(".tiktok.com") || url.hostname.endsWith(".tiktokcdn.com"))
    );
  } catch {
    return false;
  }
}

export async function saveTikTokLiveSetup(
  ctx: BrowserRecipeContext,
  persist: (credential: TikTokLiveCredential) => Promise<void>,
): Promise<{ eligible: true; credentialSaved: true }> {
  const { live, owner } = await openLive(ctx);
  try {
    const snapshot = await readTikTokCreatorPage<
      TikTokLiveCredential | "ineligible" | "setup_required"
    >(
      live,
      liveExpression(
        owner,
        String.raw`
        const root = one(document, '[data-e2e="live-rtmp-setup"]');
        if (one(document, '[data-e2e="live-ineligible"]')) return 'ineligible';
        if (!root) return;
        const server = one(root, 'input[readonly][aria-label="Server URL"],input[readonly][aria-label="Sunucu URL’si"]');
        const key = one(root, 'input[readonly][aria-label="Stream key"],input[readonly][aria-label="Yayın anahtarı"]');
        if (!server?.value || !key?.value) return 'setup_required';
        return {serverUrl:server.value,streamKey:key.value};`,
      ),
    );
    if (snapshot === "ineligible")
      throw new SocialPlatformError("unsupported", undefined, {
        reasonCode: "TIKTOK_LIVE_NOT_ELIGIBLE",
      });
    if (snapshot === "setup_required")
      throw new SocialPlatformError("needs_human", undefined, {
        reasonCode: "TIKTOK_LIVE_SETUP_REQUIRED",
      });
    if (
      typeof snapshot.serverUrl !== "string" ||
      typeof snapshot.streamKey !== "string" ||
      snapshot.serverUrl.length > 300 ||
      !validIngestServer(snapshot.serverUrl) ||
      !/^[!-~]{16,2048}$/.test(snapshot.streamKey)
    )
      throw unsupported();
    // The callback writes directly to the Host credential vault. Redact any vault error.
    try {
      await persist({ serverUrl: snapshot.serverUrl, streamKey: snapshot.streamKey });
    } catch {
      throw unknown();
    }
    return { eligible: true, credentialSaved: true };
  } finally {
    // Move off the sensitive page before handing the browser back to its owner.
    await ctx.page.goto(`${TIKTOK_ORIGIN}/@${owner}`).catch(() => undefined);
  }
}

export type TikTokLiveReply = { recipientId: string; commentId: string; text: string };

export async function replyTikTokLive(
  ctx: BrowserRecipeContext,
  input: TikTokLiveReply,
  beforeSubmit: () => Promise<void>,
): Promise<{ platformId: string }> {
  const recipient = TIKTOK_WEB_ID.exec(input.recipientId)?.[1];
  if (
    !recipient ||
    recipient === ownerHandle(ctx) ||
    !/^[0-9]{1,30}$/.test(input.commentId) ||
    typeof input.text !== "string" ||
    !input.text.trim() ||
    [...input.text].length > 150 ||
    /[\r\n\0]/.test(input.text) ||
    !beforeSubmit
  )
    throw denied();
  const { live, owner } = await openLive(ctx);
  try {
    return await postTikTokLiveReply(live, owner, recipient, input, beforeSubmit);
  } finally {
    await ctx.page.goto(`${TIKTOK_ORIGIN}/@${owner}`).catch(() => undefined);
  }
}

async function postTikTokLiveReply(
  live: BrowserRecipeContext,
  owner: string,
  recipient: string,
  input: TikTokLiveReply,
  beforeSubmit: () => Promise<void>,
) {
  const chat = (body: string) =>
    liveExpression(
      owner,
      String.raw`
    const chat = one(document, '[data-e2e="live-comment-panel"][data-live-status="active"]');
    if (!chat) return;
    const matches = all(chat, '[data-comment-id]').filter(row => row.getAttribute('data-comment-id') === ${json(input.commentId)});
    if (matches.length !== 1) return;
    const row = matches[0];
    const author = one(row, 'a[data-e2e="live-comment-author"]');
    const url = author && new URL(author.getAttribute('href'),${json(TIKTOK_ORIGIN)});
    if (!url || url.origin !== ${json(TIKTOK_ORIGIN)} ||
        url.pathname.replace(/\/$/, '').toLowerCase() !== ${json(`/@${recipient}`)}) return;
    ${body}
  `,
    );
  await readTikTokCreatorPage<boolean>(
    live,
    chat(`
    const buttons = all(row, 'button').filter(el => enabled(el) && ['Reply','Yanıtla'].includes(label(el)));
    if (buttons.length !== 1) return;
    return mark(buttons[0], 'live-reply');`),
  );
  await live.page.click(markedTikTokCreatorControl("live-reply"));
  const composer = (body: string) =>
    chat(`
    const root = one(chat, '[data-e2e="live-reply-composer"]');
    if (!root || root.getAttribute('data-reply-to') !== ${json(input.commentId)}) return;
    const editor = one(root, 'textarea,[contenteditable="true"][role="textbox"]');
    if (!editor || !enabled(editor)) return;
    ${body}
  `);
  await readTikTokCreatorPage<boolean>(
    live,
    composer(`
    if (String(editor.value ?? editor.textContent ?? '').trim()) return;
    return mark(editor, 'live-reply-text');`),
  );
  await live.page.fill(markedTikTokCreatorControl("live-reply-text"), input.text);
  const acknowledgement = String.raw`
    const replies = all(chat,'[data-reply-to][data-comment-id]').filter(el =>
      el.getAttribute('data-reply-to') === ${json(input.commentId)} &&
      el.getAttribute('data-author') === ${json(owner)} &&
      el.getAttribute('data-comment-id') !== ${json(input.commentId)} &&
      one(el,'[data-e2e="live-comment-text"]')?.textContent?.trim() === ${json(input.text.trim())});
    const ids = replies.map(el => el.getAttribute('data-comment-id')).filter(id => /^\d{1,30}$/.test(id));`;
  const previous = await readTikTokCreatorPage<string[]>(
    live,
    chat(`${acknowledgement} return ids;`),
  );
  return submitTikTokCreatorAction(
    live,
    composer(`
    if (String(editor.value ?? editor.textContent ?? '') !== ${json(input.text)}) return;
    const buttons = all(root, 'button').filter(el => enabled(el) && ['Send','Gönder'].includes(label(el)));
    if (buttons.length !== 1) return;
    return mark(buttons[0], 'live-reply-send');`),
    "live-reply-send",
    async () => {
      const platformId = await readTikTokCreatorPage<string>(
        live,
        chat(`
      ${acknowledgement}
      const fresh = [...new Set(ids.filter(id => !${json(previous)}.includes(id)))];
      return fresh.length === 1 ? fresh[0] : undefined;`),
      );
      return { platformId };
    },
    beforeSubmit,
  );
}
