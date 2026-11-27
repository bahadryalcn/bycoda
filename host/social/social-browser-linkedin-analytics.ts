import { SocialPlatformError } from "../../src/integrations/social/adapter";
import type { LinkedInAnalyticsResult } from "../../src/integrations/social/adapters/linkedin-analytics";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const LINKEDIN_ORIGIN = "https://www.linkedin.com";

// Only the member’s private counts are collected. Visitor lists are never read.
function profileAnalyticsProbe(path: string): string {
  return String.raw`(() => {
    if (location.origin !== ${JSON.stringify(LINKEDIN_ORIGIN)} || location.pathname.replace(/\/$/, '') !== ${JSON.stringify(path)}) return;
    const visible = el => !!el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]');
    const normalize = text => (text || '').replace(/\s+/g, ' ').trim();
    const headings = [...document.querySelectorAll('main h2, main h3, main [role="heading"]')]
      .filter(el => visible(el) && /^(Analytics|Analizler)$/i.test(normalize(el.textContent)));
    if (headings.length !== 1) return;
    const section = headings[0].closest('section');
    if (!section) return;
    const labels = [
      ['profileViews', /^(?:profile views?|profil görüntülemesi)$/i],
      ['searchAppearances', /^(?:search appearances?|arama görünümü|aramalarda görünme)$/i],
      ['profileAppearances', /^(?:profile appearances?|profil görünümü)$/i],
    ];
    const metricValues = new Map();
    for (const el of section.querySelectorAll('a, p, span, [role="listitem"], li')) {
      if (!visible(el)) continue;
      for (const text of [el.getAttribute('aria-label'), el.innerText]) {
        const match = /^([0-9]+(?:[,. ][0-9]{3})*) (.+)$/.exec(normalize(text));
        if (!match || !/^(?:\d+|\d{1,3}([,. ])\d{3}(?:\1\d{3})*)$/.test(match[1])) continue;
        const label = labels.find(([, pattern]) => pattern.test(match[2]));
        if (!label) continue;
        const value = Number(match[1].replace(/[,. ]/g, ''));
        if (!Number.isSafeInteger(value)) return;
        if (metricValues.has(label[0]) && metricValues.get(label[0]) !== value) return;
        metricValues.set(label[0], value);
      }
    }
    return metricValues.size ? Object.fromEntries(metricValues) : undefined;
  })()`;
}

/** Profile views and appearances use the signed-in browser UI where no public API covers them. */
export async function readLinkedInBrowserProfileAnalytics(
  ctx: BrowserRecipeContext,
): Promise<LinkedInAnalyticsResult> {
  const { account, page } = ctx;
  const slug = /^web:linkedin:in:([a-z\d][a-z\d-]{0,99})$/.exec(account.platformId)?.[1];
  if (account.platform !== "linkedin" || account.accountType !== "member" || !slug)
    throw new SocialPlatformError("unsupported");
  const path = `/in/${slug}`;
  await page.goto(`${LINKEDIN_ORIGIN}${path}/`);
  const initialChallenge = await detectChallenge(page);
  if (initialChallenge) throw needsHumanError(initialChallenge);
  await ctx.verifyIdentity();
  const metrics = await ctx.waitFor<LinkedInAnalyticsResult["metrics"]>(
    profileAnalyticsProbe(path),
    5_000,
  );
  const finalChallenge = await detectChallenge(page);
  if (finalChallenge) throw needsHumanError(finalChallenge);
  if (!metrics)
    throw new SocialPlatformError("needs_human", undefined, {
      reasonCode: "linkedin.analytics.screen",
    });
  await ctx.verifyIdentity();
  return { source: "browser", metrics };
}
