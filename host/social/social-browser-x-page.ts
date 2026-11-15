import type { SocialAccount } from "../../src/features/social/model/social";
import { SocialPlatformError, type SocialSendResult } from "../../src/integrations/social/adapter";
import type { BrowserSendLimiter } from "./browser/limiter";
import { challengeError } from "./browser/challenge";
import { UnexpectedScreen, type ScreenSummary } from "./browser-layers/types";
import type { BrowserLauncher, BrowserPage, BrowserSession } from "./social-browser";

export const EDITOR = '[data-testid="tweetTextarea_0"]';
export const FILE_INPUT = 'input[data-testid="fileInput"]';
export const LOGIN_PATH = /^\/(login|logout|i\/flow\/login|i\/flow\/signup)/;

/** Dependencies shared by the X browser operations. The session class supplies them. */
export type XBrowserDeps = {
  directory: string;
  background: boolean;
  launcher: BrowserLauncher | undefined;
  limiter: BrowserSendLimiter;
  now: () => number;
  profile(accountId: string): string;
  identity(page: BrowserPage, account: SocialAccount): Promise<void>;
  until<T>(page: BrowserPage, expression: string, timeoutMs: number): Promise<T | undefined>;
  readSession(accountId: string): Promise<BrowserSession>;
  releaseRead(accountId: string, session: BrowserSession, success: boolean): Promise<void>;
};

/** True on the encrypted XChat route (`/i/chat`), which replaced the legacy /messages inbox. */
export const CHAT_PATH_EXPRESSION = `(location.pathname === "/i/chat" || location.pathname.startsWith("/i/chat/"))`;

/**
 * Page expression that yields "pin" while the XChat shell asks for the key-recovery passcode. The
 * prompt lives in an open shadow root (testid pin-title), so a plain querySelector cannot see it.
 * Reading it never touches the prompt.
 */
export const CHAT_PIN_EXPRESSION = `(() => {
  if (location.pathname.startsWith("/i/chat/pin/")) return "pin";
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      const shadow = el.shadowRoot;
      if (shadow && (shadow.querySelector('[data-testid="pin-title"], [data-testid="pin-code-input-container"]') || walk(shadow))) return true;
    }
    return false;
  };
  return walk(document) ? "pin" : "";
})()`;

/** Reason an encrypted chat cannot be read or written: passcode prompt versus the shell itself. */
export async function xChatBlockReason(
  deps: Pick<XBrowserDeps, "until">,
  page: BrowserPage,
): Promise<"chat_setup_required" | "encrypted_chat_unsupported"> {
  // The shell mounts the passcode prompt after the route; wait briefly, then fall back to the generic reason.
  return (await deps.until<string>(page, CHAT_PIN_EXPRESSION, 8_000)) === "pin"
    ? "chat_setup_required"
    : "encrypted_chat_unsupported";
}

export function xUserId(cookies: { name: string; value: string }[]): string | undefined {
  if (!cookies.some((cookie) => cookie.name === "auth_token" && cookie.value)) return undefined;
  const twid = cookies.find((cookie) => cookie.name === "twid")?.value;
  if (!twid) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(twid).replaceAll('"', "");
  } catch {
    return undefined;
  }
  return /^u=(\d{1,25})$/.exec(decoded)?.[1];
}

/** Parses X web CreateTweet/CreateNoteTweet responses. Only an explicit error body proves no post was made. */
export function parseCreateTweet(raw: string, now = Date.now()): SocialSendResult {
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SocialPlatformError("unknown");
  }
  const id = (value?.data?.create_tweet ?? value?.data?.notetweet_create)?.tweet_results?.result
    ?.rest_id;
  if (typeof id === "string" && /^\d{1,25}$/.test(id))
    return { platformId: id, url: `https://x.com/i/status/${id}` };
  const codes: number[] = Array.isArray(value?.errors)
    ? value.errors.map((error: { code?: unknown }) => Number(error?.code))
    : [];
  if (codes.includes(88) || codes.includes(185) || codes.includes(344))
    throw new SocialPlatformError("rate_limit", now + 60 * 60_000);
  if ([32, 64, 89, 326].some((code) => codes.includes(code)))
    throw new SocialPlatformError("denied");
  if (codes.length) throw new SocialPlatformError("rejected");
  throw new SocialPlatformError("unknown");
}

/**
 * Verifies the logged-in X user. A captcha, verification or checkpoint page becomes NEEDS_HUMAN
 * (detected only, never interacted with); a logged-out page keeps the existing "expired" outcome.
 */
export async function xIdentity(
  page: BrowserPage,
  account: SocialAccount,
  directory: string,
): Promise<void> {
  const id = xUserId(await page.cookies());
  if (!id) throw (await challengeError(page, directory)) ?? new SocialPlatformError("expired");
  if (account.platform !== "x" || id !== account.platformId)
    throw new SocialPlatformError("denied");
}

const SUMMARY_SCRIPT = String.raw`(() => {
  const visible = el => !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !!el.getClientRects().length;
  const text = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const take = (selector, read) => [...document.querySelectorAll(selector)].filter(visible).map(read).filter(Boolean).slice(0, 10);
  return {
    url: location.origin + location.pathname,
    title: document.title.slice(0, 120),
    buttons: take('button,[role="button"]', text),
    fields: take('input,textarea,select', el => el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || ''),
    headings: take('h1,h2,h3,[role="heading"]', text),
    errors: take('[role="alert"]', text),
  };
})()`;

/**
 * Text-only description of the current page for the next layer. Reads labels and visible text
 * only: never field values, cookies or query strings.
 */
export async function xScreenSummary(page: BrowserPage): Promise<ScreenSummary> {
  const value = await page
    .evaluate<Record<string, unknown> | undefined>(SUMMARY_SCRIPT)
    .catch(() => undefined);
  const strings = (items: unknown): string[] =>
    Array.isArray(items)
      ? items.filter((item): item is string => typeof item === "string").slice(0, 10)
      : [];
  return {
    url: typeof value?.url === "string" ? value.url : "",
    title: typeof value?.title === "string" ? value.title : "",
    buttons: strings(value?.buttons),
    fields: strings(value?.fields),
    headings: strings(value?.headings),
    errors: strings(value?.errors),
  };
}

/**
 * A required X element is missing on a page that is neither a login nor a challenge. The caller
 * throws the result; the next layer receives the summary and no interaction happens here.
 */
export async function xUnexpectedScreen(page: BrowserPage): Promise<UnexpectedScreen> {
  return new UnexpectedScreen(await xScreenSummary(page));
}
