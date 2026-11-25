import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { facebookLiveId } from "../../src/integrations/social/adapters/facebook-live";
import { setTimeout as sleep } from "node:timers/promises";
import { detectChallenge, needsHumanError } from "./browser/challenge";
import type { BrowserPage } from "./social-browser";

type Program = "stars" | "in_stream_ads" | "bonuses" | "content_monetization";
type ProgramStatus = "active" | "eligible" | "ineligible" | "invited" | "unavailable";
export type FacebookDashboardMonetization = {
  source: "business_suite";
  programs: { program: Program; status?: ProgramStatus; earnings?: string }[];
};

/** Reads an exact Page's Meta Business Suite overview. Returns allow-listed data only. */
export async function readFacebookMonetization(
  page: BrowserPage,
  pageId: string,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<FacebookDashboardMonetization> {
  const id = facebookLiveId(pageId);
  await page.goto(`https://business.facebook.com/latest/monetization?asset_id=${id}`);
  const read = String.raw`(() => {
    const pageId = ${JSON.stringify(id)};
    const locationUrl = new URL(location.href);
    if (locationUrl.origin !== 'https://business.facebook.com' ||
        !/^\/latest\/monetization\/?$/.test(locationUrl.pathname) ||
        locationUrl.searchParams.getAll('asset_id').length !== 1 ||
        locationUrl.searchParams.get('asset_id') !== pageId) return null;
    const visible = el => !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !!el.getClientRects().length;
    const label = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
    const headings = [...document.querySelectorAll('main h1,main h2,main [role="heading"],[role="main"] [role="heading"]')].filter(visible);
    if (!headings.some(el => /^(Moneti[sz]ation|Para kazanma)$/i.test(label(el)))) return null;
    if (headings.some(el => /^(Tax information|Payout (account|settings|setup)|Vergi bilgileri|Ödeme ayarları)$/i.test(label(el)))) return null;
    const selected = [...document.querySelectorAll('a[aria-current="page"][href],a[aria-selected="true"][href],[aria-selected="true"][data-page-id]')].filter(visible);
    if (!selected.some(el => {
      if (el.getAttribute('data-page-id') === pageId) return true;
      const href = el.getAttribute('href');
      if (!href) return false;
      const url = new URL(href, locationUrl.href);
      return url.origin === locationUrl.origin && url.searchParams.getAll('asset_id').length === 1 && url.searchParams.get('asset_id') === pageId;
    })) return null;
    const statuses = [
      ['active', /^(Active|Aktif|Etkin)$/i],
      ['eligible', /^(Eligible|Uygun)$/i],
      ['ineligible', /^(Ineligible|Not eligible|Uygun değil)$/i],
      ['invited', /^(Invited|Davet edildi)$/i],
      ['unavailable', /^(Unavailable|Not available|Kullanılamıyor)$/i],
    ];
    const programs = [
      ['stars', /^(Stars|Yıldızlar)$/i],
      ['in_stream_ads', /^(In-stream ads|Yayın içi reklamlar)$/i],
      ['bonuses', /^(Bonuses|Performance bonus|Bonuslar|Performans bonusu)$/i],
      ['content_monetization', /^(Content monetization|İçerikten para kazanma)$/i],
    ];
    const result = [];
    for (const [program, pattern] of programs) {
      const titles = headings.filter(el => pattern.test(label(el)));
      if (titles.length !== 1) continue;
      const card = titles[0].closest('article,li,section,[role="row"],[role="region"],[role="listitem"]');
      if (!card || programs.filter(([, p]) => headings.some(el => card.contains(el) && p.test(label(el)))).length !== 1) continue;
      const labels = [...card.querySelectorAll('span,p,dd,[role="status"]')].filter(visible).map(label);
      const matching = statuses.filter(([, status]) => labels.some(value => status.test(value)));
      const earnings = [...new Set(labels.map(value => value.match(/^(?:Estimated earnings|Earnings|Tahmini kazanç|Kazanç)\s*:?\s*((?:[$€£₺]|USD |EUR |GBP |TRY )[0-9][0-9., ]{0,20}|[0-9][0-9., ]{0,20} (?:USD|EUR|GBP|TRY))$/i)?.[1]?.trim()).filter(Boolean))];
      result.push({ program, ...(matching.length === 1 ? { status: matching[0][0] } : {}), ...(earnings.length === 1 ? { earnings: earnings[0] } : {}) });
    }
    return result;
  })()`;
  for (let attempt = 0; attempt < 12; attempt++) {
    const challenge = await detectChallenge(page);
    if (challenge) throw needsHumanError(challenge);
    const result = await page.evaluate<FacebookDashboardMonetization["programs"] | null>(read);
    if (result?.length) return { source: "business_suite", programs: result };
    if (!result && attempt === 11) throw new SocialPlatformError("denied");
    if (attempt < 11) await wait(500);
  }
  return { source: "business_suite", programs: [] };
}
