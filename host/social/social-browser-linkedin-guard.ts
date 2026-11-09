import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import { UnexpectedScreen, type ScreenSummary } from "./browser-layers/types";
import type { BrowserPage } from "./social-browser";
import type { BrowserRecipeContext } from "./social-browser-recipe";

/** Text-only page summary: no field values, no query string, no cookies. */
const SUMMARY = String.raw`(() => {
  const visible = el => !!el.getClientRects().length && !el.hidden;
  const label = el => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const take = (selector, map) => [...document.querySelectorAll(selector)].filter(visible).slice(0, 20).map(map).filter(Boolean);
  return {
    url: location.origin + location.pathname,
    title: String(document.title || '').slice(0, 200),
    buttons: take('button,[role="button"]', label),
    fields: take('input,textarea,select', el => (el.getAttribute('aria-label') || el.getAttribute('name') || el.tagName || '').slice(0, 80)),
    headings: take('h1,h2,[role="heading"]', label),
    errors: take('[role="alert"],.artdeco-inline-feedback__message', label),
  };
})()`;

const EMPTY_SUMMARY: ScreenSummary = {
  url: "",
  title: "",
  buttons: [],
  fields: [],
  headings: [],
  errors: [],
};

export async function linkedInScreenSummary(page: BrowserPage): Promise<ScreenSummary> {
  return await page
    .evaluate<ScreenSummary | undefined>(SUMMARY)
    .then((value) => value ?? EMPTY_SUMMARY)
    .catch(() => EMPTY_SUMMARY);
}

/**
 * Runs one LinkedIn recipe step. A required control that is missing on an unexpected page is
 * handed to the layered driver as UnexpectedScreen. Captcha and verification pages become
 * NEEDS_HUMAN. Nothing is clicked or typed here. Errors after the final submit are left
 * untouched: the recipe already reports them as uncertain.
 */
export async function guardLinkedInScreen<T>(
  ctx: BrowserRecipeContext,
  run: (guarded: BrowserRecipeContext) => Promise<T>,
): Promise<T> {
  let submitted = false;
  const guarded: BrowserRecipeContext = {
    ...ctx,
    markSubmitted: () => {
      submitted = true;
      ctx.markSubmitted?.();
    },
  };
  try {
    return await run(guarded);
  } catch (error) {
    if (submitted || !(error instanceof SocialPlatformError) || error.code !== "unsupported")
      throw error;
    const hit = await detectChallenge(ctx.page).catch(() => null);
    if (hit && hit.kind !== "login") throw needsHumanError(hit);
    throw new UnexpectedScreen(await linkedInScreenSummary(ctx.page));
  }
}
