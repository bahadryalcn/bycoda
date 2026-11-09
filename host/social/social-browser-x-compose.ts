import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import { SocialPlatformError, type SocialSendResult } from "../../src/integrations/social/adapter";
import { X_POST_WEIGHT_LIMIT } from "../../src/integrations/social/adapters/x";
import { xPostWeight } from "../../src/integrations/social/publishingFormats";
import { xMediaFormat, xMediaIssue } from "../../src/integrations/social/xMedia";
import { challengeError } from "./browser/challenge";
import { writeFileAtomic } from "../storage/atomic-write";
import type { BrowserPage } from "./social-browser";
import { parseXBrowserMessageSent } from "./social-browser-inbound";
import {
  EDITOR,
  FILE_INPUT,
  LOGIN_PATH,
  parseCreateTweet,
  xUnexpectedScreen,
  xUserId,
  type XBrowserDeps,
} from "./social-browser-x-page";

/**
 * X web publishing and legacy DM sending. Gates are the recipe's own checks (owner identity,
 * numeric conversation, acknowledged submit); stored API scopes are not consulted.
 */
async function sendMessage(
  deps: XBrowserDeps,
  page: BrowserPage,
  account: SocialAccount,
  job: SocialJob,
  beforeSubmit?: () => Promise<void>,
): Promise<SocialSendResult> {
  const recipient = job.payload.recipientId;
  if (
    !recipient ||
    !/^\d{1,25}$/.test(recipient) ||
    recipient === account.platformId ||
    job.payload.media.length ||
    job.payload.postId
  )
    throw new SocialPlatformError("unsupported");
  const text = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
  if (!text.trim()) throw new SocialPlatformError("rejected");
  await deps.identity(page, account);
  await page.goto(`https://x.com/messages/compose?recipient_id=${recipient}`);
  const editor = '[data-testid="dmComposerTextInput"]';
  const ready = await deps.until<string>(
    page,
    `${LOGIN_PATH}.test(location.pathname) ? "login" : document.querySelector(${JSON.stringify(editor)}) ? "ready" : ""`,
    30_000,
  );
  if (ready === "login") throw new SocialPlatformError("expired");
  // A missing composer is a challenge (NEEDS_HUMAN) or an unexpected screen for the next layer.
  if (ready !== "ready")
    throw (await challengeError(page, deps.directory)) ?? (await xUnexpectedScreen(page));
  await deps.identity(page, account);
  // A composer alone is insufficient: pin the actual numeric conversation participants.
  const conversation = await page.evaluate<string>("location.pathname");
  const ids = /^\/messages\/(\d{1,25})-(\d{1,25})\/?$/.exec(conversation);
  if (!ids || !ids.slice(1).includes(recipient) || !ids.slice(1).includes(account.platformId))
    throw new SocialPlatformError("denied");
  await page.click(editor);
  await page.insertText(text);
  const button = '[data-testid="dmComposerSendButton"]';
  const enabled = await deps.until<boolean>(
    page,
    `!!document.querySelector(${JSON.stringify(`${button}:not([disabled]):not([aria-disabled="true"])`)})`,
    10_000,
  );
  if (!enabled) throw new SocialPlatformError("rejected");
  await deps.identity(page, account);
  await beforeSubmit?.();
  const capture = page.watchResponse(/\/dm\/new2?\.json$/);
  await deps.limiter.record(account.id);
  try {
    try {
      await page.click(button);
    } catch {
      throw new SocialPlatformError("unknown");
    }
    const body = await capture.body(30_000);
    if (!body) throw new SocialPlatformError("unknown");
    return parseXBrowserMessageSent(body, account.platformId, recipient, text, deps.now());
  } finally {
    capture.stop();
  }
}
export async function publishX(
  deps: XBrowserDeps,
  account: SocialAccount,
  job: SocialJob,
  media: (id: string) => Promise<Uint8Array>,
  beforeSubmit?: () => Promise<void>,
): Promise<SocialSendResult> {
  const postId = job.payload.postId;
  const message = job.kind === "message" || (job.kind === "reply" && !postId);
  if (
    message &&
    (!job.payload.recipientId ||
      !/^\d{1,25}$/.test(job.payload.recipientId) ||
      job.payload.media.length)
  )
    throw new SocialPlatformError("unsupported");
  if (postId && !/^\d{1,25}$/.test(postId)) throw new SocialPlatformError("rejected");
  const text = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
  // Over-length text is refused before any pacing slot, upload or browser launch.
  if (xPostWeight(text) > X_POST_WEIGHT_LIMIT) throw new SocialPlatformError("rejected");
  if (!deps.launcher) throw new SocialPlatformError("unsupported");
  await deps.limiter.reserve(account.id);
  if (xMediaIssue(job.payload.media, message)) throw new SocialPlatformError("unsupported");
  const staging = join(deps.directory, "x-browser-uploads", randomUUID());
  try {
    const files: string[] = [];
    for (const [index, item] of job.payload.media.entries()) {
      const bytes = await media(item.uploadId!);
      const format = xMediaFormat(bytes);
      if ((item.kind === "video") !== (format === "mp4")) throw new SocialPlatformError("rejected");
      await mkdir(staging, { recursive: true });
      const file = join(staging, `${index}.${format}`);
      await writeFileAtomic(file, bytes);
      files.push(file);
    }
    const session = await deps.launcher(deps.profile(account.id), deps.background);
    try {
      if (message) return await sendMessage(deps, session.page, account, job, beforeSubmit);
      return await compose(deps, session.page, account, postId, text, files, beforeSubmit);
    } finally {
      await session.close().catch(() => undefined);
    }
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
async function compose(
  deps: XBrowserDeps,
  page: BrowserPage,
  account: SocialAccount,
  postId: string | undefined,
  text: string,
  files: string[],
  beforeSubmit?: () => Promise<void>,
): Promise<SocialSendResult> {
  const button = postId ? '[data-testid="tweetButtonInline"]' : '[data-testid="tweetButton"]';
  await page.goto(postId ? `https://x.com/i/status/${postId}` : "https://x.com/compose/post");
  const state = await deps.until<string>(
    page,
    `${LOGIN_PATH}.test(location.pathname) ? "login" : document.querySelector(${JSON.stringify(EDITOR)}) ? "ready" : ""`,
    45_000,
  );
  if (state === "login") throw new SocialPlatformError("expired");
  if (state !== "ready")
    throw (await challengeError(page, deps.directory)) ?? (await xUnexpectedScreen(page));
  const id = xUserId(await page.cookies());
  if (!id) throw new SocialPlatformError("expired");
  // Never post from whichever account happens to be logged in to the profile.
  if (id !== account.platformId) throw new SocialPlatformError("denied");
  await page.click(EDITOR);
  if (text) await page.insertText(text);
  if (files.length) {
    await page.setFiles(FILE_INPUT, files);
    const attached = await deps.until<boolean>(
      page,
      files[0].endsWith(".mp4")
        ? `!!document.querySelector('[data-testid="attachments"] video, [data-testid="attachments"] [data-testid="videoPlayer"]') && !document.querySelector('[data-testid="attachments"] [role="progressbar"]')`
        : `document.querySelectorAll('[data-testid="attachments"] img').length >= ${files.length}`,
      120_000,
    );
    if (!attached) throw new SocialPlatformError("rejected");
  }
  const enabled = await deps.until<boolean>(
    page,
    `!!document.querySelector(${JSON.stringify(`${button}:not([aria-disabled="true"]):not(:disabled)`)})`,
    20_000,
  );
  if (!enabled) throw new SocialPlatformError("rejected");
  await deps.identity(page, account);
  await beforeSubmit?.();
  const response = page.watchResponse(/\/(CreateTweet|CreateNoteTweet)$/);
  await deps.limiter.record(account.id);
  try {
    await page.click(button);
  } catch {
    response.stop();
    throw new SocialPlatformError("unknown");
  }
  const body = await response.body(45_000);
  if (body === undefined) throw new SocialPlatformError("unknown");
  return parseCreateTweet(body, deps.now());
}
