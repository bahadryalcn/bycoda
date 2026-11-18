import type { InstagramEarnings } from "../../src/features/social/model/socialBrowser";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import {
  checkInstagramOwner,
  INSTAGRAM_ORIGIN,
  instagramControls,
  openInstagramOwnerProfile,
  ownerProfileProof,
} from "./social-browser-instagram-owner";
import type { BrowserRecipeContext } from "./social-browser-recipe";

const earningsLabels = {
  total: ["Total earnings", "Toplam kazanç"],
  estimated: ["Estimated earnings", "Tahmini kazanç"],
  available: ["Available for payout", "Ödemeye hazır"],
  pending: ["Pending payout", "Bekleyen ödeme"],
  last: ["Last payout", "Son ödeme"],
};
const dashboardPath = String.raw`^/(?:professional_dashboard|accounts/(?:insights|monetization|payouts))(?:/[a-z_0-9-]+){0,4}/?$`;

function dashboardProbe(body: string): string {
  return `(() => {
    ${instagramControls}
    if (location.origin !== ${JSON.stringify(INSTAGRAM_ORIGIN)} ||
        !new RegExp(${JSON.stringify(dashboardPath)}, 'i').test(location.pathname)) return;
    const areas = matches(document, 'main,[role="main"]');
    if (areas.length !== 1 || matches(document, '[role="dialog"]').length) return;
    const area = areas[0];
    ${body}
  })()`;
}

function ownDashboardLink(labels: string[]): string {
  return `
    const links = named(area, 'a[href]', ${JSON.stringify(labels)});
    const urls = new Set(links.flatMap(link => {
      const url = new URL(link.href);
      if (url.origin !== location.origin || url.username || url.password || url.search || url.hash ||
          !new RegExp(${JSON.stringify(dashboardPath)}, 'i').test(url.pathname)) return [];
      return [url.href];
    }));
    if (urls.size === 1) return [...urls][0];
  `;
}

const earningsProbe = dashboardProbe(`
  const heading = matches(area, 'h1,h2,h3,[role="heading"]').some(el =>
    ['Monetization', 'Payouts', 'Earnings', 'Para kazanma', 'Ödemeler', 'Kazançlar'].includes(label(el)));
  if (!heading) return;
  const currency = '(?:[A-Z]{3}|US[$]|CA[$]|AU[$]|R[$]|[$€£¥￥₺₹₩])';
  const number = '(?:[0-9]{1,3}(?:[ ,.]?[0-9]{3}){0,4}|[0-9]{1,15})(?:[.,][0-9]{1,3})?';
  const money = new RegExp('^(?:' + currency + ' ?' + number + '|' + number + ' ?' + currency + ')$', 'u');
  const values = [];
  for (const [kind, labels] of Object.entries(${JSON.stringify(earningsLabels)})) {
    const amountNodes = new Set();
    for (const item of matches(area, 'dt,th,h2,h3,h4,[role="heading"],[role="rowheader"],p,span')) {
      if (!labels.includes(clean(item.textContent))) continue;
      if (item.tagName === 'DT' && item.nextElementSibling?.tagName === 'DD') amountNodes.add(item.nextElementSibling);
      else if (item.matches('th,[role="rowheader"]')) {
        const row = item.closest('tr,[role="row"]');
        if (!row) continue;
        for (const cell of matches(row, 'td,[role="cell"],[role="gridcell"]')) amountNodes.add(cell);
      } else if (item.nextElementSibling && item.parentElement?.childElementCount === 2) amountNodes.add(item.nextElementSibling);
    }
    const amounts = new Set([...amountNodes].filter(visible).map(node => clean(node.textContent)).filter(value => money.test(value)));
    if (amounts.size > 1) return;
    if (amounts.size === 1) values.push({ kind, amount: [...amounts][0] });
  }
  if (values.length) return values;
`);

/** Reads named monetary summaries only. Payout account data and payment controls stay in Instagram. */
export async function readInstagramEarnings(
  context: BrowserRecipeContext,
): Promise<InstagramEarnings> {
  const profile = await openInstagramOwnerProfile(context);
  const dashboard = await context.waitFor<string>(
    `(() => {
    ${instagramControls}
    if (location.origin !== ${JSON.stringify(INSTAGRAM_ORIGIN)} ||
        location.pathname.toLowerCase() !== ${JSON.stringify(profile.toLowerCase())} ||
        !(${ownerProfileProof})) return;
    const area = document.querySelector('main');
    if (!area) return;
    ${ownDashboardLink(["Professional dashboard", "Profesyonel pano", "Profesyonel kontrol paneli"])}
  })()`,
    10_000,
  );
  await checkInstagramOwner(context);
  if (!dashboard) throw new SocialPlatformError("unsupported");
  await context.page.goto(dashboard);
  await checkInstagramOwner(context);
  const payout = await context.waitFor<string>(
    dashboardProbe(
      ownDashboardLink([
        "Monetization",
        "Payouts",
        "Earnings",
        "Para kazanma",
        "Ödemeler",
        "Kazançlar",
      ]),
    ),
    4_000,
  );
  await checkInstagramOwner(context);
  if (payout && payout !== dashboard) {
    await context.page.goto(payout);
    await checkInstagramOwner(context);
  }
  const values = await context.waitFor<InstagramEarnings["values"]>(earningsProbe, 10_000);
  await checkInstagramOwner(context);
  if (!values) throw new SocialPlatformError("unsupported");
  return { values, observedAt: context.now() };
}
