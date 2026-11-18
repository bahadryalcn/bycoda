import {
  verifyYouTubeBrowser,
  youtubeBrowserChannel,
  youtubeBrowserScreenError,
  youtubeStudioOrigin,
} from "./browser/youtube-recipe-guards";
import { json } from "./social-browser-publishing-shared";
import type { BrowserRecipeContext } from "./social-browser-recipe";

export type YouTubeEarnStatus = "eligible" | "ineligible" | "active" | "pending";

/** Reads the categorical state only; Studio payout amounts and account details stay on the page. */
export async function youtubeBrowserEarnings(ctx: BrowserRecipeContext): Promise<{ status: YouTubeEarnStatus; url: string }> {
  const path = `/channel/${youtubeBrowserChannel(ctx)}/monetization`;
  const url = `${youtubeStudioOrigin}${path}`;
  await ctx.page.goto(url);
  await verifyYouTubeBrowser(ctx);
  const status = await ctx.waitFor<YouTubeEarnStatus>(String.raw`(() => {
    if(location.origin!==${json(youtubeStudioOrigin)}||location.pathname!==${json(path)})return;
    const visible=el=>!!el&&!el.hidden&&el.getClientRects().length;
    const roots=[...document.querySelectorAll('ytcp-monetization-page')].filter(visible);
    if(roots.length!==1)return;
    const root=roots[0];
    const text=(el)=>(el.getAttribute('aria-label')||el.textContent||'').trim().toLowerCase();
    const match=(selector,labels)=>[...root.querySelectorAll(selector)].filter(el=>visible(el)&&labels.includes(text(el))).length===1;
    if(match('#partner-status',['you’re a youtube partner','you are a youtube partner','youtube iş ortağısınız']))return 'active';
    if(match('#review-status',['in progress','devam ediyor']))return 'pending';
    if(match('#apply-button',['apply now','hemen başvur']))return 'eligible';
    if(match('#notify-button',['get notified','bildirim al']))return 'ineligible';
  })()`, 20_000);
  if (!status) throw await youtubeBrowserScreenError(ctx);
  await verifyYouTubeBrowser(ctx);
  return { status, url };
}
