import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { writeFileAtomic } from "../../storage/atomic-write";
import type { BrowserPage } from "../social-browser";

export type ChallengeKind = "captcha" | "verification" | "suspicious_login" | "login";
export type ChallengeHit = { kind: ChallengeKind; url: string };

/**
 * Read-only probe. It queries the DOM and location only; it never clicks, types, fills or submits.
 * Returned values are reduced to booleans so no page text, field value or query string leaves the page.
 */
const PROBE = String.raw`(() => {
  const visible = el => !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !!el.getClientRects().length;
  const text = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const captchaFrame = [...document.querySelectorAll('iframe')].some(el =>
    visible(el) && /captcha|arkoselabs|hcaptcha|recaptcha|turnstile/i.test(el.getAttribute('src') || ''));
  const humanText = [...document.querySelectorAll('[role="dialog"],h1,h2,h3,[role="heading"]')].some(el =>
    visible(el) && /^(Verify (?:you are|you're) human|Complete the security check|Security verification|Güvenlik doğrulaması|Robot değilim|Are you a robot\?)$/i.test(text(el)));
  const codeField = [...document.querySelectorAll('input')].some(el => visible(el) && (
    el.autocomplete === 'one-time-code' ||
    /^(verificationCode|verification-code|security_code|confirmation_code|otp|otp-code)$/i.test(el.name || '') ||
    /^(Verification code|Confirmation code|Security code|Doğrulama kodu)$/i.test(el.getAttribute('aria-label') || '') ||
    el.getAttribute('placeholder') === 'Enter 6-digit code'));
  return { path: location.pathname, origin: location.origin, captchaFrame, humanText, codeField };
})()`;

type Probe = {
  path: string;
  origin: string;
  captchaFrame: boolean;
  humanText: boolean;
  codeField: boolean;
};

/**
 * Recognizes captcha, verification-code, suspicious-login and logged-out pages.
 * Returns null for ordinary pages. The caller decides how to stop; recipes never interact with the hit.
 */
export async function detectChallenge(page: BrowserPage): Promise<ChallengeHit | null> {
  const probe = await page.evaluate<Probe | undefined>(PROBE);
  if (!probe) return null;
  const url = `${probe.origin}${probe.path}`;
  if (probe.captchaFrame || probe.humanText) return { kind: "captcha", url };
  if (probe.codeField) return { kind: "verification", url };
  if (/\/(?:checkpoint|challenge)(?:\/|$)/.test(probe.path))
    return { kind: "suspicious_login", url };
  if (/\/(?:login|signin|signup|authwall|recover|accounts\/login)(?:\/|$)/.test(probe.path))
    return { kind: "login", url };
  return null;
}

/** NEEDS_HUMAN error for a recognized challenge; the owner completes it in the browser window. */
export function needsHumanError(hit: ChallengeHit, screenshotId?: string): SocialPlatformError {
  return new SocialPlatformError("needs_human", undefined, { url: hit.url, screenshotId });
}

/**
 * Saves a JPEG of the current page under `<directory>/needs-human/<id>.jpg` when the adapter
 * supports screenshots. Returns the screenshot id, or undefined when capture is unavailable.
 */
export async function captureNeedsHumanScreenshot(
  page: BrowserPage,
  directory: string,
): Promise<string | undefined> {
  if (!page.screenshot) return undefined;
  const bytes = await page.screenshot().catch(() => undefined);
  if (!bytes?.length) return undefined;
  const id = randomUUID();
  await writeFileAtomic(join(directory, "needs-human", `${id}.jpg`), bytes, { mode: 0o600 });
  return id;
}

/** Converts a generic "identity missing" outcome into NEEDS_HUMAN when a challenge is visible. */
export async function challengeError(
  page: BrowserPage,
  directory: string,
): Promise<SocialPlatformError | undefined> {
  const hit = await escalatingChallenge(page);
  if (!hit) return undefined;
  const screenshotId = await captureNeedsHumanScreenshot(page, directory).catch(() => undefined);
  return needsHumanError(hit, screenshotId);
}

/**
 * A logged-out page keeps the existing "expired" outcome so the owner signs in again; captcha,
 * verification and checkpoint pages are owner-only and escalate to NEEDS_HUMAN.
 */
async function escalatingChallenge(page: BrowserPage): Promise<ChallengeHit | null> {
  const hit = await detectChallenge(page);
  return hit && hit.kind !== "login" ? hit : null;
}
