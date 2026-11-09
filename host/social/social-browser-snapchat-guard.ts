import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError, type ChallengeHit } from "./browser/challenge";
import { summarizeScreen } from "./browser-layers/screen-summary";
import { UnexpectedScreen, type ScreenSummary } from "./browser-layers/types";
import type { BrowserPage } from "./social-browser";

const EMPTY_SUMMARY: ScreenSummary = {
  url: "",
  title: "",
  buttons: [],
  fields: [],
  headings: [],
  errors: [],
};
const SNAP_ORIGINS = [
  "https://web.snapchat.com",
  "https://www.snapchat.com",
  "https://my.snapchat.com",
  "https://profile.snapchat.com",
  "https://accounts.snapchat.com",
];

/**
 * Read-only probe for Snapchat two-step and suspicious-login screens. It reads visible heading and
 * dialog text plus the location. It never clicks, types or submits.
 * shortcut: the phrases are not verified against live Snapchat pages; extend them from recorded fixtures.
 */
const PROBE = String.raw`(() => {
  const visible = el => !!el && !el.hidden && el.getClientRects().length > 0;
  // Headings and dialogs only: message bodies in chats must never count as a challenge.
  const texts = [...document.querySelectorAll('h1,h2,h3,[role="heading"],[role="dialog"]')]
    .filter(visible)
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(text => text.length > 0 && text.length <= 300);
  return {
    origin: location.origin,
    path: location.pathname,
    verification: texts.some(text => /two-factor|two-step|enter the code|verification code|iki adımlı doğrulama|doğrulama kodu/i.test(text)),
    suspicious: texts.some(text => /unusual activity|suspicious|olağan dışı|şüpheli/i.test(text)),
  };
})()`;

type Probe = { origin: string; path: string; verification: boolean; suspicious: boolean };

/** A Snapchat verification or suspicious-login screen. Login pages are not challenges here. */
export async function snapchatChallenge(page: BrowserPage): Promise<ChallengeHit | null> {
  const probe = await page.evaluate<Probe | undefined>(PROBE).catch(() => undefined);
  if (!probe || !SNAP_ORIGINS.includes(probe.origin)) return null;
  const url = `${probe.origin}${probe.path}`;
  if (probe.suspicious) return { kind: "suspicious_login", url };
  if (probe.verification) return { kind: "verification", url };
  return null;
}

/**
 * The error for a missing required element: a recognized challenge becomes NEEDS_HUMAN (no
 * interaction); any other page is handed to the layered driver as UnexpectedScreen.
 */
export async function unexpectedSnapchatScreen(page: BrowserPage): Promise<Error> {
  const hit = (await detectChallenge(page).catch(() => null)) ?? (await snapchatChallenge(page));
  if (hit && hit.kind !== "login") return needsHumanError(hit);
  const snapshot = await summarizeScreen(page).catch(() => undefined);
  return new UnexpectedScreen(snapshot?.summary ?? EMPTY_SUMMARY);
}

/**
 * Runs a DOM step whose element lookup may fail (shared helpers throw `unsupported` when a unique
 * control is missing). Call only before any external submit: after a submit, errors are uncertain.
 */
export async function guardSnapchatStep<T>(page: BrowserPage, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof SocialPlatformError && error.code === "unsupported")
      throw await unexpectedSnapchatScreen(page);
    throw error;
  }
}
