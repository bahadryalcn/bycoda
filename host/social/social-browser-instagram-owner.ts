import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import type { BrowserRecipeContext } from "./social-browser-recipe";

export const INSTAGRAM_ORIGIN = "https://www.instagram.com";
export const ownerProfileProof = `[...document.querySelectorAll('main a[href="/accounts/edit/"]')].some(visible)`;

export async function checkInstagramOwner(context: BrowserRecipeContext) {
  const challenge = await detectChallenge(context.page);
  if (challenge) throw needsHumanError(challenge);
  await context.verifyIdentity();
}

/** Canonical controls shared by Instagram's owner-only profile and dashboard workflows. */
export const instagramControls = String.raw`
  const visible = el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !!el.getClientRects().length;
  const matches = (root, selector) => [...root.querySelectorAll(selector)].filter(visible);
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const label = el => clean(el.getAttribute('aria-label') || el.querySelector('svg[aria-label]')?.getAttribute('aria-label') || el.textContent);
  const named = (root, selector, labels) => matches(root, selector).filter(el =>
    !el.disabled && el.getAttribute('aria-disabled') !== 'true' && labels.includes(label(el)));
`;

/** The signed-in navigation supplies the profile path. The Edit profile link proves the route is editable by this actor. */
export async function openInstagramOwnerProfile(context: BrowserRecipeContext): Promise<string> {
  await context.page.goto(`${INSTAGRAM_ORIGIN}/`);
  await checkInstagramOwner(context);
  const path = await context.waitFor<string>(
    `(() => {
    ${instagramControls}
    if (location.origin !== ${JSON.stringify(INSTAGRAM_ORIGIN)} || location.pathname !== '/') return;
    const links = named(document, 'nav a[href],[role="navigation"] a[href]', ['Profile', 'Profil']);
    const paths = new Set(links.map(link => {
      const url = new URL(link.href);
      if (url.origin === location.origin && !url.username && !url.password && !url.search && !url.hash &&
          /^\\/[A-Za-z0-9_][A-Za-z0-9._]{0,29}\\/$/.test(url.pathname)) return url.pathname;
    }).filter(Boolean));
    if (paths.size === 1) return [...paths][0];
  })()`,
    10_000,
  );
  await checkInstagramOwner(context);
  if (!path) throw new SocialPlatformError("unsupported");
  await context.page.goto(`${INSTAGRAM_ORIGIN}${path}`);
  await requireInstagramOwnerProfile(context, path);
  return path;
}

export async function requireInstagramOwnerProfile(context: BrowserRecipeContext, path: string) {
  const owned = await context.waitFor<boolean>(
    `(() => {
    ${instagramControls}
    return location.origin === ${JSON.stringify(INSTAGRAM_ORIGIN)} &&
      location.pathname.toLowerCase() === ${JSON.stringify(path.toLowerCase())} &&
      ${ownerProfileProof};
  })()`,
    10_000,
  );
  await checkInstagramOwner(context);
  if (!owned) throw new SocialPlatformError("denied");
}
