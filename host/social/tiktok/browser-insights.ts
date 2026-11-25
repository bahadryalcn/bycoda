import { json } from "../social-browser-publishing-shared";
import type { BrowserRecipeContext } from "../social-browser-recipe";
import {
  creatorExpression,
  openTikTokCreatorPage,
  readTikTokCreatorPage,
} from "./browser-creator-page";

const analyticsMetrics = {
  postViews: ["Post views", "Video views", "Gönderi görüntülemeleri", "Video görüntülemeleri"],
  profileViews: ["Profile views", "Profil görüntülemeleri"],
  likes: ["Likes", "Beğeniler"],
  comments: ["Comments", "Yorumlar"],
  shares: ["Shares", "Paylaşımlar"],
  totalFollowers: ["Total followers", "Toplam takipçiler"],
  netFollowers: ["Net followers", "Net takipçiler"],
};

const earningsMetrics = {
  estimatedRewards: ["Estimated rewards", "Tahmini ödüller"],
  monthlyEarnings: ["Monthly earnings", "Aylık kazanç"],
  balance: ["Rewards balance", "Ödül bakiyesi"],
  liveGifts: ["LIVE Gifts", "CANLI Yayın Hediyeleri"],
  diamonds: ["Diamonds", "Elmaslar"],
};

export type TikTokStudioMetric<Key extends string> = {
  key: Key;
  /** Provider-rendered value, preserving decimal and currency notation. */
  displayValue: string;
};
export type TikTokStudioAnalytics = {
  source: "studio";
  period?: string;
  metrics: TikTokStudioMetric<keyof typeof analyticsMetrics>[];
};
export type TikTokStudioEarnings = {
  source: "studio";
  status: "available" | "unavailable";
  period?: string;
  metrics: TikTokStudioMetric<keyof typeof earningsMetrics>[];
};

const ANALYTICS = "/tiktokstudio/analytics";
const MONETIZATION = "/tiktokstudio/monetization";

function studioMetrics(path: string, names: Record<string, readonly string[]>, earnings: boolean) {
  return creatorExpression(
    path,
    String.raw`
    const root = one(document, 'main,[role="main"]');
    if (!root) return;
    const titles = ${json(earnings ? ["Monetization", "Creator Rewards Program", "Para kazanma", "İçerik Üreticisi Ödülleri Programı"] : ["Analytics", "Analizler"])};
    if (!all(root, 'h1,h2,[role="heading"]').some(el => titles.includes(label(el)))) return;
    const entries = ${json(names)};
    const metrics = [];
    for (const [key, labels] of Object.entries(entries)) {
      const rows = all(root, '[data-e2e="metric-card"],dl').filter(el => {
        const title = one(el, '[data-e2e="metric-label"],dt');
        return title && labels.includes(label(title));
      });
      if (rows.length !== 1) continue;
      const value = one(rows[0], '[data-e2e="metric-value"],dd');
      if (!value) continue;
      const displayValue = label(value);
      if (!/^-?(?:[A-Z]{3}\s*|\p{Sc}\s*)?\d[\d.,\s]{0,24}(?:[KMB]|\s*\p{Sc}|\s*[A-Z]{3})?$/u.test(displayValue)) continue;
      metrics.push({key,displayValue});
    }
    const period = one(root, '[data-e2e="analytics-period"],[data-e2e="rewards-period"]');
    const periodText = period ? label(period).slice(0,80) : undefined;
    if (!metrics.length && !${earnings}) return;
    return {source:'studio',period:periodText,metrics${earnings ? ",status:metrics.length ? 'available' : 'unavailable'" : ""}};
  `,
  );
}

export async function readTikTokAnalytics(
  ctx: BrowserRecipeContext,
): Promise<TikTokStudioAnalytics> {
  await openTikTokCreatorPage(ctx, ANALYTICS);
  return readTikTokCreatorPage(ctx, studioMetrics(ANALYTICS, analyticsMetrics, false));
}

export async function readTikTokEarnings(ctx: BrowserRecipeContext): Promise<TikTokStudioEarnings> {
  await openTikTokCreatorPage(ctx, MONETIZATION);
  return readTikTokCreatorPage(ctx, studioMetrics(MONETIZATION, earningsMetrics, true));
}
